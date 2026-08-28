import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export { swarmPlanBudget } from '@builderhelm/protocol';

import { swarmPlanSchema } from '@builderhelm/protocol';

const execFileAsync = promisify(execFile);

export interface RepoSnapshot {
  readonly files: readonly string[];
  readonly truncated: boolean;
}

/**
 * Cheap repo map for the planner: tracked paths only, no file contents, so
 * decomposition costs a single small prompt instead of an exploration budget.
 */
export async function buildRepoSnapshot(
  folderPath: string,
  limit = 400,
): Promise<RepoSnapshot> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], {
      cwd: folderPath,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const all = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { files: all.slice(0, limit), truncated: all.length > limit };
  } catch {
    return { files: [], truncated: false };
  }
}

export interface PlannedTask {
  readonly title: string;
  readonly detail: string | null;
  readonly files: readonly string[];
  /** Indices into the returned array; always strictly earlier entries. */
  readonly dependsOn: readonly number[];
}

/**
 * Turns raw model output into a safe plan: caps task count, enforces exclusive
 * file ownership so two builders never edit one file, and keeps dependencies a
 * DAG by allowing edges to earlier tasks only.
 */
export function normalizeSwarmPlan(plan: unknown, maxTasks: number): PlannedTask[] {
  const parsed = swarmPlanSchema.parse(plan);
  const claimed = new Set<string>();
  const kept: {
    title: string;
    detail: string | null;
    files: string[];
    dependsOn: number[];
  }[] = [];
  const indexMap = new Map<number, number>();

  parsed.tasks.forEach((task, originalIndex) => {
    if (kept.length >= maxTasks) return;
    const files = task.files.filter((file) => !claimed.has(file));
    if (task.files.length > 0 && files.length === 0) return; // fully duplicated work
    for (const file of files) claimed.add(file);
    indexMap.set(originalIndex, kept.length);
    kept.push({
      title: task.title,
      detail: task.detail ?? null,
      files,
      dependsOn: [...new Set(task.dependsOn ?? [])]
        .map((dep) => indexMap.get(dep))
        .filter((dep): dep is number => dep !== undefined && dep < kept.length),
    });
  });

  if (kept.length === 0) {
    throw new Error('plan contained no runnable tasks after normalization');
  }
  return kept;
}

export interface SwarmPlanRequest {
  readonly mission: string;
  readonly snapshot: RepoSnapshot;
  readonly maxTasks: number;
  readonly roster: string;
}

export interface SwarmPlanner {
  plan(request: SwarmPlanRequest): Promise<PlannedTask[]>;
}

export function buildPlanPrompt(request: SwarmPlanRequest): string {
  const files = request.snapshot.files.join('\n');
  return [
    'You are the coordinator of a BuilderHelm swarm. Split the mission into',
    `at most ${request.maxTasks} independent tasks for parallel builders.`,
    '',
    `Roster: ${request.roster}`,
    'Builders implement. Scouts investigate. Reviewers review. Do not invent roles this roster does not have.',
    '',
    'Rules:',
    '- Every task names the exact files it owns. No two tasks may share a file.',
    '- Use dependsOn only when a task truly needs an earlier task landed first.',
    '- Prefer fewer, larger tasks over many trivial ones.',
    '- Each title is an imperative one-liner; detail carries acceptance criteria.',
    '',
    `Mission: ${request.mission}`,
    '',
    `Repository files${request.snapshot.truncated ? ' (truncated)' : ''}:`,
    files.length > 0 ? files : '(no tracked files)',
  ].join('\n');
}

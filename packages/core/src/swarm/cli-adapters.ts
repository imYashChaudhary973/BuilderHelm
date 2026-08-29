import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  boardAgentCatalogEntry,
  SWARM_PLAN_JSON_SCHEMA,
  SWARM_REVIEW_JSON_SCHEMA,
  swarmReviewSchema,
  type BoardAgentId,
  type SwarmLaunchMode,
  type SwarmReviewVerdict,
  type SwarmSeatArgv,
} from '@builderhelm/protocol';

import {
  buildPlanPrompt,
  normalizeSwarmPlan,
  type PlannedTask,
  type SwarmPlanner,
  type SwarmPlanRequest,
} from './swarm-planning.js';
import {
  buildReviewPrompt,
  type SwarmReviewer,
  type SwarmReviewRequest,
} from './swarm-reviewer.js';

function execCli(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeout: number,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  // Executor form is required by execFile's callback API; the repo targets
  // ES2022, which does not expose Promise.withResolvers.
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      [...args],
      {
        cwd,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    // Agent CLIs otherwise wait for optional piped context forever.
    child.stdin?.end();
  });
}
const SWARM_PROMPT_MAX = 100_000;
const OPENCODE_MODEL = 'openrouter/stealth/ox-alpha';

export interface AgentUsage {
  readonly tokensUsed: number;
  readonly costUsd: number;
}

export interface StructuredCallOptions {
  readonly agentId: BoardAgentId;
  readonly cwd: string;
  readonly executable?: string;
  readonly timeoutMs?: number;
}

interface CliAdapter {
  readonly seatArgs?: (prompt: string, mode: SwarmLaunchMode) => string[];
  readonly structuredCall?: (
    executable: string,
    options: StructuredCallOptions,
    prompt: string,
    schema: unknown,
  ) => Promise<unknown>;
  readonly usage?: (stdout: string) => AgentUsage;
}

interface UsageCandidate {
  readonly tokens: number;
  readonly cost: number;
}

function readUsageCandidate(value: unknown): UsageCandidate {
  if (typeof value !== 'object' || value === null) return { tokens: 0, cost: 0 };
  const row = value as Record<string, unknown>;
  const usage =
    typeof row.usage === 'object' && row.usage !== null
      ? (row.usage as Record<string, unknown>)
      : row;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? 0);
  const cached = Number(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? 0);
  const tokens = total > 0 ? total : input + output + cached;
  const cost = Number(row.total_cost_usd ?? row.cost_usd ?? usage.total_cost_usd ?? 0);
  return {
    tokens: Number.isFinite(tokens) ? tokens : 0,
    cost: Number.isFinite(cost) ? cost : 0,
  };
}

function jsonValues(output: string): unknown[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  }
}

function parseReportedUsage(output: string): AgentUsage {
  let tokens = 0;
  let cost = 0;
  for (const value of jsonValues(output)) {
    const candidate = readUsageCandidate(value);
    tokens = Math.max(tokens, candidate.tokens);
    cost = Math.max(cost, candidate.cost);
  }
  return { tokensUsed: Math.round(tokens), costUsd: cost };
}

function unwrapStructured(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const envelope = value as Record<string, unknown>;
  const structured = envelope.structured_output ?? envelope.structuredOutput;
  if (structured !== undefined && structured !== null) {
    return typeof structured === 'string' ? JSON.parse(structured) : structured;
  }
  if (envelope.result !== undefined) {
    return typeof envelope.result === 'string'
      ? JSON.parse(envelope.result)
      : envelope.result;
  }
  return value;
}

function parseStructuredOutput(output: string): unknown {
  const values = jsonValues(output);
  if (values.length === 0) throw new Error('agent returned no JSON object');
  return unwrapStructured(values.at(-1));
}

async function execStructured(
  executable: string,
  options: StructuredCallOptions,
  args: string[],
): Promise<unknown> {
  const { stdout } = await execCli(
    executable,
    args,
    options.cwd,
    options.timeoutMs ?? 180_000,
  );
  return parseStructuredOutput(stdout);
}

async function callCodexStructured(
  executable: string,
  options: StructuredCallOptions,
  prompt: string,
  schema: unknown,
): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'builderhelm-codex-'));
  const schemaPath = join(directory, 'schema.json');
  const outputPath = join(directory, 'result.json');
  try {
    await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
    await execCli(
      executable,
      [
        'exec',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--color',
        'never',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        prompt,
      ],
      options.cwd,
      options.timeoutMs ?? 180_000,
    );
    return parseStructuredOutput(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const CLI_ADAPTERS: Readonly<Partial<Record<BoardAgentId, CliAdapter>>> = {
  claude: {
    seatArgs: (prompt, mode) =>
      mode === 'full'
        ? ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions']
        : [
            '-p',
            prompt,
            '--output-format',
            'json',
            '--permission-mode',
            mode === 'auto' ? 'acceptEdits' : 'dontAsk',
          ],
    structuredCall: (executable, options, prompt, schema) =>
      execStructured(executable, options, [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(schema),
        '--permission-mode',
        'dontAsk',
      ]),
    usage: parseReportedUsage,
  },
  codex: {
    seatArgs: (prompt, mode) =>
      mode === 'full'
        ? ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', prompt]
        : mode === 'auto'
          ? ['exec', '--json', '--sandbox', 'workspace-write', '--approve-for-me', prompt]
          : ['exec', '--json', '--sandbox', 'read-only', prompt],
    structuredCall: callCodexStructured,
    usage: parseReportedUsage,
  },
  gemini: {
    seatArgs: (prompt, mode) => [
      '-p',
      prompt,
      '--skip-trust',
      '--approval-mode',
      mode === 'full' ? 'yolo' : mode === 'auto' ? 'auto_edit' : 'plan',
    ],
  },
  grok: {
    seatArgs: (prompt, mode) => [
      '-p',
      prompt,
      '--permission-mode',
      mode === 'full' ? 'bypassPermissions' : mode === 'auto' ? 'acceptEdits' : 'dontAsk',
    ],
    structuredCall: (executable, options, prompt, schema) =>
      execStructured(executable, options, [
        '-p',
        prompt,
        '--json-schema',
        JSON.stringify(schema),
        '--permission-mode',
        'dontAsk',
      ]),
  },
  opencode: {
    seatArgs: (prompt, mode) =>
      mode === 'full'
        ? ['run', '-m', OPENCODE_MODEL, '--auto', prompt]
        : ['run', '-m', OPENCODE_MODEL, prompt],
  },
  kimi: {
    seatArgs: (prompt, mode) =>
      mode === 'full'
        ? ['-p', prompt, '--auto']
        : mode === 'auto'
          ? ['-p', prompt, '-y']
          : ['-p', prompt],
  },
  omp: {
    seatArgs: (prompt, mode) => [
      '-p',
      prompt,
      '--approval-mode',
      mode === 'full' ? 'yolo' : mode === 'auto' ? 'write' : 'always-ask',
    ],
  },
  pi: {
    seatArgs: (prompt, mode) =>
      mode === 'auto' ? ['-p', prompt, '--approve'] : ['-p', prompt],
  },
};

/**
 * Ordered schema-CLI fallbacks: if the primary planner or reviewer CLI is
 * unavailable (quota, auth, crash), the next installed structured CLI takes
 * the call with the same cwd instead of failing a run that has healthy seats.
 */
export const CLI_FALLBACK_IDS: Readonly<
  Partial<Record<BoardAgentId, readonly BoardAgentId[]>>
> = {
  claude: ['codex'],
  codex: ['claude'],
  grok: ['claude', 'codex'],
};

export function swarmSeatArgv(
  agentId: BoardAgentId,
  prompt: string,
  mode: SwarmLaunchMode = 'auto',
): SwarmSeatArgv {
  const profile = boardAgentCatalogEntry(agentId);
  const adapter = CLI_ADAPTERS[agentId];
  if (adapter?.seatArgs === undefined || profile.capabilities.swarmModes.length === 0) {
    throw new Error(`${agentId} cannot take a swarm seat: no verified headless command`);
  }
  if (!profile.capabilities.swarmModes.includes(mode)) {
    throw new Error(`${agentId} does not support ${mode} launch mode`);
  }
  const body = prompt.trim().slice(0, SWARM_PROMPT_MAX);
  if (body.length === 0) throw new Error('swarm prompt must not be empty');
  return { binary: profile.command, args: adapter.seatArgs(body, mode) };
}

export function parseAgentUsage(agentId: BoardAgentId, output: string): AgentUsage {
  const profile = boardAgentCatalogEntry(agentId);
  if (!profile.capabilities.usageReporting) return { tokensUsed: 0, costUsd: 0 };
  return CLI_ADAPTERS[agentId]?.usage?.(output) ?? { tokensUsed: 0, costUsd: 0 };
}

export async function callStructuredAgent(
  options: StructuredCallOptions,
  prompt: string,
  schema: unknown,
): Promise<unknown> {
  const profile = boardAgentCatalogEntry(options.agentId);
  const call = CLI_ADAPTERS[options.agentId]?.structuredCall;
  if (profile.capabilities.structuredOutput !== 'json-schema' || call === undefined) {
    throw new Error(`${options.agentId} cannot produce schema-constrained output`);
  }
  return call(options.executable ?? profile.command, options, prompt, schema);
}

function fallbackOptions(options: StructuredCallOptions): StructuredCallOptions[] {
  return (CLI_FALLBACK_IDS[options.agentId] ?? []).map((agentId) => {
    // Destructure to satisfy exactOptionalPropertyTypes: the fallback runs the
    // catalog binary, never the primary's probed path.
    const { executable: _omit, ...rest } = options;
    void _omit;
    return { ...rest, agentId };
  });
}

export class CliSwarmPlanner implements SwarmPlanner {
  private readonly fallbacks: readonly StructuredCallOptions[];

  constructor(private readonly options: StructuredCallOptions) {
    this.fallbacks = fallbackOptions(options);
  }

  async plan(request: SwarmPlanRequest): Promise<PlannedTask[]> {
    const prompt = buildPlanPrompt(request);
    const attempts = [this.options, ...this.fallbacks];
    let last: unknown;
    for (const attempt of attempts) {
      try {
        const raw = await callStructuredAgent(attempt, prompt, SWARM_PLAN_JSON_SCHEMA);
        return normalizeSwarmPlan(raw, request.maxTasks);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error('planning failed');
  }
}

export class CliSwarmReviewer implements SwarmReviewer {
  private readonly fallbacks: readonly StructuredCallOptions[];

  constructor(private readonly options: StructuredCallOptions) {
    this.fallbacks = fallbackOptions(options);
  }

  async review(request: SwarmReviewRequest): Promise<SwarmReviewVerdict> {
    const prompt = buildReviewPrompt(request);
    for (const attempt of [this.options, ...this.fallbacks]) {
      let raw: unknown;
      try {
        raw = await callStructuredAgent(attempt, prompt, SWARM_REVIEW_JSON_SCHEMA);
      } catch {
        continue;
      }
      const parsed = swarmReviewSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      return { verdict: 'approve', issues: ['reviewer output was not readable'] };
    }
    return { verdict: 'approve', issues: ['no reviewer output was readable'] };
  }
}

import {
  boardAgentIdSchema,
  type BoardAgentDetection,
  type BoardAgentId,
  type BoardPaneStatus,
} from './board.js';
import type { CorrelationId } from '@zero/shared';

import { modelErrorSchema } from './model.js';
import { z } from 'zod';

export const SWARM_ROLES = ['coordinator', 'builder', 'scout', 'reviewer'] as const;
export type SwarmRole = (typeof SWARM_ROLES)[number];

export const SWARM_PANE_COUNT = 8;
export const SWARM_BUDGET_MS = 20 * 60 * 1000;
export const SWARM_STUCK_MS = 90 * 1000;

export type SwarmMemberStatus = 'starting' | 'running' | 'stuck' | 'exited' | 'failed';
export type SwarmStuckAction = 'none' | 'nudge' | 'stop';

export type SwarmRunStatus = 'running' | 'stuck' | 'budget' | 'stopped' | 'done';

export interface SwarmAssignment {
  readonly role: SwarmRole;
  readonly agentId: BoardAgentId;
  readonly auto: boolean;
}

const DUTY: Record<SwarmRole, string> = {
  coordinator:
    'Split the job, track the other roles, and stop when the job is done. Do not implement the whole job yourself.',
  builder: 'Implement the job in this folder. Keep the diff small and ship working code.',
  scout: 'Explore the repo and report what matters. Do not implement unless asked.',
  reviewer:
    'Review the Builder work. Name bugs and missing tests. Do not rewrite everything.',
};

export const SWARM_OPENCODE_MODEL = 'openrouter/stealth/ox-alpha';

export const SWARM_PRESETS = [
  {
    id: 'skiff',
    size: 3 as const,
    label: 'Skiff',
    seats: { coordinator: 1, builder: 1, scout: 1, reviewer: 0 },
  },
  {
    id: 'cutter',
    size: 5 as const,
    label: 'Cutter',
    seats: { coordinator: 1, builder: 2, scout: 1, reviewer: 1 },
  },
  {
    id: 'frigate',
    size: 8 as const,
    label: 'Frigate',
    seats: { coordinator: 1, builder: 5, scout: 1, reviewer: 1 },
  },
  {
    id: 'flagship',
    size: 12 as const,
    label: 'Flagship',
    seats: { coordinator: 1, builder: 7, scout: 2, reviewer: 2 },
  },
] as const;
export type SwarmPresetId = (typeof SWARM_PRESETS)[number]['id'];

/** Task ceiling per preset: effort scales with the roster, not model whim. */
export function swarmPlanBudget(presetId: SwarmPresetId): number {
  switch (presetId) {
    case 'skiff':
      return 3;
    case 'cutter':
      return 6;
    case 'frigate':
      return 10;
    default:
      return 14;
  }
}

export const SWARM_SKILLS = [
  {
    id: 'commits',
    group: 'workflow',
    title: 'Incremental Commits',
    detail: 'Commit small, atomic changes.',
    directive: 'Commit in small atomic steps after each working change.',
  },
  {
    id: 'refactor',
    group: 'workflow',
    title: 'Refactor Only',
    detail: 'Restructure without changing behavior.',
    directive: 'Refactor structure only. Do not change behavior.',
  },
  {
    id: 'monorepo',
    group: 'workflow',
    title: 'Monorepo Aware',
    detail: 'Respect package boundaries.',
    directive: 'Stay inside the touched package. Do not break workspace boundaries.',
  },
  {
    id: 'tdd',
    group: 'quality',
    title: 'Test-Driven',
    detail: 'Write tests first, then implement.',
    directive: 'Write a failing test first, then the smallest code that passes.',
  },
  {
    id: 'review',
    group: 'quality',
    title: 'Code Review',
    detail: 'Review all changes before merge.',
    directive: 'Review every change before considering the job done.',
  },
  {
    id: 'docs',
    group: 'quality',
    title: 'Documentation',
    detail: 'Document public APIs.',
    directive: 'Document public APIs and update existing docs you touch.',
  },
  {
    id: 'security',
    group: 'quality',
    title: 'Security Audit',
    detail: 'Check for vulnerabilities.',
    directive: 'Watch for injection, secret leaks, and unsafe defaults.',
  },
  {
    id: 'dry',
    group: 'quality',
    title: 'DRY Principle',
    detail: 'Eliminate duplication.',
    directive: 'Remove duplication instead of copying logic.',
  },
  {
    id: 'a11y',
    group: 'quality',
    title: 'Accessibility',
    detail: 'Meet WCAG basics.',
    directive: 'Keep UI keyboardable, labeled, and contrast-safe (WCAG 2.1 AA).',
  },
  {
    id: 'types',
    group: 'quality',
    title: 'Type Strict',
    detail: 'No implicit any.',
    directive: 'Keep types strict. Do not add implicit any or unsafe casts.',
  },
  {
    id: 'lint',
    group: 'quality',
    title: 'Lint Clean',
    detail: 'Leave the tree lint-clean.',
    directive: 'Leave lint and format clean in files you touch.',
  },
  {
    id: 'ci',
    group: 'ops',
    title: 'Keep CI Green',
    detail: 'All checks pass.',
    directive: 'Do not leave the tree failing typecheck or tests you can run.',
  },
  {
    id: 'migrations',
    group: 'ops',
    title: 'Migration Safe',
    detail: 'Safe schema changes.',
    directive: 'Schema changes must be additive and reversible.',
  },
  {
    id: 'changelog',
    group: 'ops',
    title: 'Changelog',
    detail: 'Note user-facing changes.',
    directive: 'Record user-facing changes in the project changelog style.',
  },
  {
    id: 'errors',
    group: 'ops',
    title: 'Error Handling',
    detail: 'Fail closed, say why.',
    directive: 'Fail closed on errors. Surface a clear reason. Do not swallow.',
  },
  {
    id: 'perf',
    group: 'analysis',
    title: 'Performance',
    detail: 'Watch hot paths.',
    directive: 'Avoid extra allocations and work on hot paths.',
  },
  {
    id: 'privacy',
    group: 'analysis',
    title: 'Privacy First',
    detail: 'No secrets in logs.',
    directive: 'Never log secrets, tokens, or personal data.',
  },
  {
    id: 'logging',
    group: 'analysis',
    title: 'Observability',
    detail: 'Useful logs, no noise.',
    directive: 'Log useful state changes. Do not add noisy debug spam.',
  },
] as const;
export type SwarmSkillId = (typeof SWARM_SKILLS)[number]['id'];
export type SwarmLaunchMode = 'safe' | 'auto' | 'full';
export const SWARM_LAUNCH_MODES = [
  'safe',
  'auto',
  'full',
] as const satisfies readonly SwarmLaunchMode[];

export function swarmPresetRoles(id: SwarmPresetId): SwarmRole[] {
  const preset = SWARM_PRESETS.find((item) => item.id === id)!;
  const roles: SwarmRole[] = [];
  for (const role of SWARM_ROLES) {
    for (let n = 0; n < preset.seats[role]; n += 1) roles.push(role);
  }
  return roles;
}

export function swarmSkillLines(ids: readonly string[]): string {
  return SWARM_SKILLS.filter((skill) => ids.includes(skill.id))
    .map((skill) => `${skill.title}: ${skill.directive}`)
    .join('\n');
}

export function swarmAddSeat(
  roster: readonly SwarmAssignment[],
  role: SwarmRole,
  agentId: BoardAgentId,
): SwarmAssignment[] {
  if (roster.length >= 12) return [...roster];
  return [...roster, { role, agentId, auto: false }];
}

export function swarmRemoveSeat(
  roster: readonly SwarmAssignment[],
  role: SwarmRole,
): SwarmAssignment[] {
  const index = roster.reduce(
    (found, seat, seatIndex) => (seat.role === role ? seatIndex : found),
    -1,
  );
  if (index < 0) return [...roster];
  return roster.filter((_, seatIndex) => seatIndex !== index);
}

export function availableSwarmAgents(
  detections: readonly BoardAgentDetection[],
): BoardAgentId[] {
  return detections
    .filter((item) => item.available && item.id !== 'shell' && item.id !== 'custom')
    .map((item) => item.id);
}

export function assignSwarmPanes(
  agentIds: readonly BoardAgentId[],
  roles: readonly SwarmRole[] = SWARM_ROLES,
): SwarmAssignment[] {
  if (agentIds.length === 0 || roles.length === 0) return [];
  return roles.map((role, index) => ({
    role,
    agentId: agentIds[index % agentIds.length]!,
    auto: false,
  }));
}

export function swarmBrief(role: SwarmRole, job: string): string {
  const clipped = job.trim().slice(0, 2_000);
  return `You are the ${role} in a BuilderHelm Swarm.\nJob: ${clipped}\n\n${DUTY[role]}\n`;
}
export function swarmRoleTasks(job: string): Record<SwarmRole, string> {
  const clipped = job.trim().slice(0, 200);
  const body = clipped || 'the swarm job';
  return {
    coordinator: `Coordinate: ${body}`,
    builder: `Build: ${body}`,
    scout: `Scout: ${body}`,
    reviewer: `Review: ${body}`,
  };
}

export interface SwarmSeatArgv {
  readonly binary: string;
  readonly args: string[];
}

interface SwarmCliLauncher {
  readonly binary: string;
  readonly modes: readonly SwarmLaunchMode[];
  readonly args: (prompt: string, mode: SwarmLaunchMode) => string[];
}

/**
 * Headless launch table. Flags verified against each installed CLI
 * (`<cli> --help`, 2026-08-25). Modes:
 * - safe: read/analyze only; unapproved actions fail closed
 * - auto: file edits approved, commands still gated
 * - full: bypass every approval (worktree isolation strongly advised)
 */
const SWARM_CLI_LAUNCHERS: Readonly<Partial<Record<BoardAgentId, SwarmCliLauncher>>> = {
  claude: {
    binary: 'claude',
    modes: SWARM_LAUNCH_MODES,
    args: (prompt, mode) =>
      mode === 'full'
        ? ['-p', prompt, '--dangerously-skip-permissions']
        : [
            '-p',
            prompt,
            '--permission-mode',
            mode === 'auto' ? 'acceptEdits' : 'dontAsk',
          ],
  },
  codex: {
    binary: 'codex',
    modes: SWARM_LAUNCH_MODES,
    args: (prompt, mode) =>
      mode === 'full'
        ? ['exec', '--dangerously-bypass-approvals-and-sandbox', prompt]
        : mode === 'auto'
          ? ['exec', '--sandbox', 'workspace-write', '--approve-for-me', prompt]
          : ['exec', '--sandbox', 'read-only', prompt],
  },
  gemini: {
    binary: 'gemini',
    modes: SWARM_LAUNCH_MODES,
    args: (prompt, mode) => [
      '-p',
      prompt,
      '--skip-trust',
      '--approval-mode',
      mode === 'full' ? 'yolo' : mode === 'auto' ? 'auto_edit' : 'plan',
    ],
  },
  grok: {
    binary: 'grok',
    modes: SWARM_LAUNCH_MODES,
    args: (prompt, mode) => [
      '-p',
      prompt,
      '--permission-mode',
      mode === 'full' ? 'bypassPermissions' : mode === 'auto' ? 'acceptEdits' : 'dontAsk',
    ],
  },
  opencode: {
    binary: 'opencode',
    modes: ['auto', 'full'],
    args: (prompt, mode) =>
      mode === 'full'
        ? ['run', '-m', SWARM_OPENCODE_MODEL, '--auto', prompt]
        : ['run', '-m', SWARM_OPENCODE_MODEL, prompt],
  },
  kimi: {
    binary: 'kimi',
    modes: SWARM_LAUNCH_MODES,
    args: (prompt, mode) =>
      mode === 'full'
        ? ['-p', prompt, '--auto']
        : mode === 'auto'
          ? ['-p', prompt, '-y']
          : ['-p', prompt],
  },
  omp: {
    binary: 'omp',
    modes: SWARM_LAUNCH_MODES,
    args: (prompt, mode) => [
      '-p',
      prompt,
      '--approval-mode',
      mode === 'full' ? 'yolo' : mode === 'auto' ? 'write' : 'always-ask',
    ],
  },
  pi: {
    binary: 'pi',
    modes: ['safe', 'auto'],
    args: (prompt, mode) =>
      mode === 'auto' ? ['-p', prompt, '--approve'] : ['-p', prompt],
  },
};

/** Prompt cap: generous headroom under the 1 MB ARG_MAX while staying sane. */
export const SWARM_PROMPT_MAX = 100_000;

export function swarmSeatArgv(
  agentId: BoardAgentId,
  prompt: string,
  mode: SwarmLaunchMode = 'auto',
): SwarmSeatArgv {
  const launcher = SWARM_CLI_LAUNCHERS[agentId];
  if (launcher === undefined) {
    throw new Error(`${agentId} cannot take a swarm seat: no verified headless command`);
  }
  if (!launcher.modes.includes(mode)) {
    throw new Error(`${agentId} does not support ${mode} launch mode`);
  }
  const body = prompt.trim().slice(0, SWARM_PROMPT_MAX);
  if (body.length === 0) {
    throw new Error('swarm prompt must not be empty');
  }
  return { binary: launcher.binary, args: launcher.args(body, mode) };
}

export const SWARM_NUDGE =
  'You have been silent. Report status in one line, then continue or say you are blocked.';

export function swarmStuckAction(input: {
  readonly status: SwarmMemberStatus;
  readonly nudgedAt: number | null;
  readonly now: number;
  readonly stuckAfterMs: number;
}): SwarmStuckAction {
  if (input.status !== 'stuck') return 'none';
  if (input.nudgedAt === null) return 'nudge';
  if (input.now - input.nudgedAt >= input.stuckAfterMs) return 'stop';
  return 'none';
}

export function swarmMemberStatus(input: {
  readonly paneStatus: BoardPaneStatus;
  readonly lastActivityAt: number;
  readonly now: number;
  readonly stuckAfterMs: number;
}): SwarmMemberStatus {
  if (input.paneStatus === 'exited' || input.paneStatus === 'failed') {
    return input.paneStatus;
  }
  if (input.paneStatus === 'starting') return 'starting';
  if (input.now - input.lastActivityAt >= input.stuckAfterMs) return 'stuck';
  return 'running';
}

export function swarmRunStatus(input: {
  readonly members: readonly SwarmMemberStatus[];
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly stopped: boolean;
}): SwarmRunStatus {
  if (input.stopped) return 'stopped';
  if (input.elapsedMs >= input.budgetMs) return 'budget';
  if (input.members.length === 0) return 'running';
  if (input.members.every((item) => item === 'exited' || item === 'failed'))
    return 'done';
  if (input.members.some((item) => item === 'stuck')) return 'stuck';
  return 'running';
}

export function swarmSeatLabel(roles: readonly SwarmRole[], index: number): string {
  const role = roles[index];
  if (role === undefined) return `Seat ${index + 1}`;
  const n = roles.slice(0, index + 1).filter((item) => item === role).length;
  return `${role[0]!.toUpperCase()}${role.slice(1)} ${n}`;
}

export function swarmGraphPoints(
  roles: readonly SwarmRole[],
): readonly { readonly x: number; readonly y: number }[] {
  const buckets: Record<SwarmRole, number[]> = {
    coordinator: [],
    builder: [],
    scout: [],
    reviewer: [],
  };
  roles.forEach((role, index) => buckets[role].push(index));
  const points = roles.map(() => ({ x: 50, y: 50 }));
  const place = (
    indices: readonly number[],
    cx: number,
    cy: number,
    spreadX: number,
    spreadY: number,
  ): void => {
    const n = indices.length;
    indices.forEach((index, k) => {
      const t = n === 1 ? 0.5 : k / (n - 1);
      points[index] = { x: cx + (t - 0.5) * spreadX, y: cy + (t - 0.5) * spreadY };
    });
  };
  place(buckets.coordinator, 50, 72, 16, 0);
  if (buckets.builder.length > 6) {
    const mid = Math.ceil(buckets.builder.length / 2);
    place(buckets.builder.slice(0, mid), 50, 22, 70, 0);
    place(buckets.builder.slice(mid), 50, 36, 58, 0);
  } else {
    place(buckets.builder, 50, 28, 70, 0);
  }
  place(buckets.scout, 14, 54, 0, 24);
  place(buckets.reviewer, 86, 54, 0, 24);
  return points;
}

export function swarmGraphHub(roles: readonly SwarmRole[]): number {
  const hub = roles.findIndex((role) => role === 'coordinator');
  return hub >= 0 ? hub : 0;
}

/* ---------------------------------------------------------------------------
 * Swarm persistence contracts (migration 0012). Runtime schemas, not just
 * types: every IPC crossing and repository row validates through these.
 * ------------------------------------------------------------------------ */

export const swarmRunStatusSchema = z.enum([
  'running',
  'stuck',
  'budget',
  'stopped',
  'done',
  'failed',
]);
export type SwarmRunRecordStatus = z.infer<typeof swarmRunStatusSchema>;

export const swarmSeatStatusSchema = z.enum([
  'queued',
  'booting',
  'working',
  'idle',
  'exited',
  'failed',
]);
export type SwarmSeatStatus = z.infer<typeof swarmSeatStatusSchema>;

export const swarmTaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'review',
  'landed',
  'failed',
  'skipped',
]);
export type SwarmTaskStatus = z.infer<typeof swarmTaskStatusSchema>;

export const swarmMessageKindSchema = z.enum([
  'directive',
  'seat_report',
  'coordinator_note',
  'task_event',
  'system',
]);
export type SwarmMessageKind = z.infer<typeof swarmMessageKindSchema>;

const uuidSchema = z.string().uuid();

export const swarmRunSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(1).max(120),
    folderPath: z.string().min(1).max(4096),
    mission: z.string().trim().min(1).max(10_000),
    launchMode: z.enum(SWARM_LAUNCH_MODES),
    presetId: z.enum(['skiff', 'cutter', 'frigate', 'flagship']),
    skillIds: z.array(z.string().min(1).max(64)).max(32),
    boardSessionId: uuidSchema.nullable(),
    status: swarmRunStatusSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    budgetMs: z
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60_000),
  })
  .strict();
export type SwarmRunRecord = z.infer<typeof swarmRunSchema>;

export const swarmSeatSchema = z
  .object({
    id: uuidSchema,
    runId: uuidSchema,
    role: z.enum(SWARM_ROLES),
    agentId: boardAgentIdSchema,
    mode: z.enum(SWARM_LAUNCH_MODES),
    paneId: uuidSchema.nullable(),
    worktreePath: z.string().min(1).max(4096).nullable(),
    branch: z.string().min(1).max(255).nullable(),
    status: swarmSeatStatusSchema,
    tokensUsed: z.number().int().min(0),
    costUsd: z.number().min(0),
  })
  .strict();
export type SwarmSeatRecord = z.infer<typeof swarmSeatSchema>;

export const swarmTaskSchema = z
  .object({
    id: uuidSchema,
    runId: uuidSchema,
    seatId: uuidSchema.nullable(),
    title: z.string().trim().min(1).max(500),
    detail: z.string().max(10_000).nullable(),
    files: z.array(z.string().min(1).max(4096)).max(200),
    status: swarmTaskStatusSchema,
    dependsOn: z.array(uuidSchema).max(50),
    attempts: z.number().int().min(0).max(3),
    landedCommit: z.string().min(7).max(40).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SwarmTaskRecord = z.infer<typeof swarmTaskSchema>;

export const swarmMessageSchema = z
  .object({
    id: uuidSchema,
    runId: uuidSchema,
    seatId: uuidSchema.nullable(),
    kind: swarmMessageKindSchema,
    body: z.string().min(1).max(4_000),
    createdAt: z.string().datetime(),
  })
  .strict();
export type SwarmMessageRecord = z.infer<typeof swarmMessageSchema>;

/* IPC payloads ----------------------------------------------------------- */

const swarmCorrelationSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const swarmCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    folderPath: z.string().min(1).max(4096),
    mission: z.string().trim().min(1).max(10_000),
    launchMode: z.enum(SWARM_LAUNCH_MODES),
    presetId: z.enum(['skiff', 'cutter', 'frigate', 'flagship']),
    skillIds: z.array(z.string().min(1).max(64)).max(32),
    seats: z
      .array(
        z
          .object({
            role: z.enum(SWARM_ROLES),
            agentId: boardAgentIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type SwarmCreateInput = z.infer<typeof swarmCreateInputSchema>;

export const swarmStateSchema = z
  .object({
    run: swarmRunSchema,
    seats: z.array(swarmSeatSchema),
    tasks: z.array(swarmTaskSchema),
    messages: z.array(swarmMessageSchema).max(500),
  })
  .strict();
export type SwarmState = z.infer<typeof swarmStateSchema>;

export const swarmDirectInputSchema = z
  .object({
    runId: uuidSchema,
    seatIds: z.array(uuidSchema).min(1).max(12),
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();
export type SwarmDirectInput = z.infer<typeof swarmDirectInputSchema>;

export const swarmTaskUpdateInputSchema = z
  .object({
    runId: uuidSchema,
    taskId: uuidSchema,
    status: swarmTaskStatusSchema,
    detail: z.string().max(10_000).optional(),
  })
  .strict();
export type SwarmTaskUpdateInput = z.infer<typeof swarmTaskUpdateInputSchema>;

export const swarmStopInputSchema = z
  .object({
    runId: uuidSchema,
  })
  .strict();
export type SwarmStopInput = z.infer<typeof swarmStopInputSchema>;

function swarmIpcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const swarmCreateRequestSchema = z
  .object({
    correlationId: swarmCorrelationSchema,
    input: swarmCreateInputSchema,
  })
  .strict();
export const swarmStateRequestSchema = z
  .object({
    correlationId: swarmCorrelationSchema,
    runId: uuidSchema,
  })
  .strict();
export const swarmDirectRequestSchema = z
  .object({
    correlationId: swarmCorrelationSchema,
    input: swarmDirectInputSchema,
  })
  .strict();
export const swarmTaskUpdateRequestSchema = z
  .object({
    correlationId: swarmCorrelationSchema,
    input: swarmTaskUpdateInputSchema,
  })
  .strict();
export const swarmStopRequestSchema = z
  .object({
    correlationId: swarmCorrelationSchema,
    runId: uuidSchema,
  })
  .strict();
export const swarmStopSeatRequestSchema = z
  .object({
    correlationId: swarmCorrelationSchema,
    runId: uuidSchema,
    seatId: uuidSchema,
  })
  .strict();

export const swarmCreateIpcResponseSchema = swarmIpcResult(swarmRunSchema);
export const swarmStateIpcResponseSchema = swarmIpcResult(swarmStateSchema);
export const swarmDirectIpcResponseSchema = swarmIpcResult(
  z.object({ queued: z.literal(true) }).strict(),
);
export const swarmTaskUpdateIpcResponseSchema = swarmIpcResult(swarmTaskSchema);
export const swarmStopIpcResponseSchema = swarmIpcResult(
  z.object({ stopped: z.literal(true) }).strict(),
);
export const swarmStopSeatIpcResponseSchema = swarmStopIpcResponseSchema;
export const swarmLatestRequestSchema = z
  .object({ correlationId: swarmCorrelationSchema })
  .strict();
export const swarmLatestIpcResponseSchema = swarmIpcResult(swarmRunSchema.nullable());

/* Planning and review contracts ------------------------------------------- */

export const swarmPlanTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    detail: z.string().max(10_000).optional(),
    files: z.array(z.string().trim().min(1).max(4096)).max(200),
    dependsOn: z.array(z.number().int().min(0)).max(50).optional(),
  })
  .strict();

export const swarmPlanSchema = z
  .object({ tasks: z.array(swarmPlanTaskSchema).min(1).max(32) })
  .strict();
export type SwarmPlanPayload = z.infer<typeof swarmPlanSchema>;

export const swarmReviewSchema = z.object({
  verdict: z.enum(['approve', 'fix']),
  issues: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
});
export type SwarmReviewVerdict = z.infer<typeof swarmReviewSchema>;

/** JSON Schema handed to CLIs that constrain output. */
export const SWARM_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'files'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'integer', minimum: 0 } },
        },
      },
    },
  },
} as const;

export const SWARM_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'fix'] },
    issues: { type: 'array', items: { type: 'string' } },
  },
} as const;

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  boardAgentCatalogEntry,
  RUNTIME_LAUNCH_NONE,
  SWARM_PLAN_JSON_SCHEMA,
  SWARM_REVIEW_JSON_SCHEMA,
  swarmReviewSchema,
  type BoardAgentId,
  type RuntimeLaunch,
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

export interface AgentUsage {
  readonly tokensUsed: number;
  readonly costUsd: number;
}

export interface StructuredCallOptions {
  readonly agentId: BoardAgentId;
  readonly cwd: string;
  readonly executable?: string;
  readonly timeoutMs?: number;
  /**
   * What the person selected for this call. Absent means no selection, and
   * the runtime's own default applies — never a substituted model.
   */
  readonly launch?: RuntimeLaunch;
}

interface CliAdapter {
  readonly seatArgs?: (
    prompt: string,
    mode: SwarmLaunchMode,
    launch: RuntimeLaunch,
  ) => string[];
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
        ...modelArgv('codex', options.launch),
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

/**
 * Model flags BuilderHelm has verified for headless runs. A selected model
 * outside this map fails the launch loudly instead of being dropped, and no
 * entry here invents a default model — the runtime's own default applies
 * when nothing was selected.
 */
const MODEL_FLAG: Partial<Record<BoardAgentId, string>> = {
  claude: '--model',
  codex: '--model',
  gemini: '--model',
  opencode: '-m',
};

function modelArgv(agentId: BoardAgentId, launch?: RuntimeLaunch): string[] {
  const selected = launch ?? RUNTIME_LAUNCH_NONE;
  if (selected.effort !== null) {
    throw new Error(`${agentId} cannot set an explicit effort yet; refusing to launch`);
  }
  const flag = MODEL_FLAG[agentId];
  if (selected.model !== null && flag === undefined) {
    throw new Error(`${agentId} cannot set an explicit model; refusing to launch`);
  }
  return selected.model === null || flag === undefined ? [] : [flag, selected.model];
}

export const CLI_ADAPTERS: Readonly<Partial<Record<BoardAgentId, CliAdapter>>> = {
  claude: {
    seatArgs: (prompt, mode, launch) =>
      mode === 'full'
        ? [
            ...modelArgv('claude', launch),
            '-p',
            prompt,
            '--output-format',
            'json',
            '--dangerously-skip-permissions',
          ]
        : [
            ...modelArgv('claude', launch),
            '-p',
            prompt,
            '--output-format',
            'json',
            '--permission-mode',
            mode === 'auto' ? 'acceptEdits' : 'plan',
          ],
    structuredCall: (executable, options, prompt, schema) =>
      execStructured(executable, options, [
        ...modelArgv('claude', options.launch),
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
    seatArgs: (prompt, mode, launch) =>
      mode === 'full'
        ? [
            'exec',
            ...modelArgv('codex', launch),
            '--json',
            '--dangerously-bypass-approvals-and-sandbox',
            prompt,
          ]
        : mode === 'auto'
          ? [
              'exec',
              ...modelArgv('codex', launch),
              '--json',
              '--sandbox',
              'workspace-write',
              '--approve-for-me',
              prompt,
            ]
          : [
              'exec',
              ...modelArgv('codex', launch),
              '--json',
              '--sandbox',
              'read-only',
              prompt,
            ],
    structuredCall: callCodexStructured,
    usage: parseReportedUsage,
  },
  gemini: {
    seatArgs: (prompt, mode, launch) => [
      ...modelArgv('gemini', launch),
      '-p',
      prompt,
      '--skip-trust',
      '--approval-mode',
      mode === 'full' ? 'yolo' : mode === 'auto' ? 'auto_edit' : 'plan',
    ],
  },
  grok: {
    seatArgs: (prompt, mode, launch) => [
      ...modelArgv('grok', launch),
      '-p',
      prompt,
      '--permission-mode',
      mode === 'full' ? 'bypassPermissions' : mode === 'auto' ? 'acceptEdits' : 'plan',
    ],
    structuredCall: (executable, options, prompt, schema) =>
      execStructured(executable, options, [
        ...modelArgv('grok', options.launch),
        '-p',
        prompt,
        '--json-schema',
        JSON.stringify(schema),
        '--permission-mode',
        'dontAsk',
      ]),
  },
  opencode: {
    // No default model here: without a selection, opencode runs on whatever
    // the person configured in opencode itself.
    seatArgs: (prompt, mode, launch) => [
      'run',
      ...modelArgv('opencode', launch),
      ...(mode === 'full' ? ['--auto'] : []),
      prompt,
    ],
  },
  kimi: {
    seatArgs: (prompt, mode, launch) => [
      ...modelArgv('kimi', launch),
      ...(mode === 'full'
        ? ['-p', prompt, '--auto']
        : mode === 'auto'
          ? ['-p', prompt, '-y']
          : ['-p', prompt]),
    ],
  },
  omp: {
    seatArgs: (prompt, mode, launch) => [
      ...modelArgv('omp', launch),
      '-p',
      prompt,
      '--approval-mode',
      mode === 'full' ? 'yolo' : mode === 'auto' ? 'write' : 'always-ask',
    ],
  },
  pi: {
    seatArgs: (prompt, mode, launch) => [
      ...modelArgv('pi', launch),
      ...(mode === 'auto' ? ['-p', prompt, '--approve'] : ['-p', prompt]),
    ],
  },
};

export function swarmSeatArgv(
  agentId: BoardAgentId,
  prompt: string,
  mode: SwarmLaunchMode = 'auto',
  launch: RuntimeLaunch = RUNTIME_LAUNCH_NONE,
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
  return { binary: profile.command, args: adapter.seatArgs(body, mode, launch) };
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
  const normalized: StructuredCallOptions = {
    ...options,
    launch: options.launch ?? RUNTIME_LAUNCH_NONE,
  };
  return call(normalized.executable ?? profile.command, normalized, prompt, schema);
}

export class CliSwarmPlanner implements SwarmPlanner {
  constructor(private readonly options: StructuredCallOptions) {}

  /**
   * The selected runtime plans, or the run fails visibly. There is no
   * second runtime: silently spending a different subscription or model
   * than the one selected is exactly what launch consistency forbids.
   */
  async plan(request: SwarmPlanRequest): Promise<PlannedTask[]> {
    const prompt = buildPlanPrompt(request);
    const raw = await callStructuredAgent(this.options, prompt, SWARM_PLAN_JSON_SCHEMA);
    return normalizeSwarmPlan(raw, request.maxTasks);
  }
}

const SENSITIVE_REVIEW_PATH =
  /(?:^|\/)(?:\.env(?:\..+)?|credentials(?:\.[^/]+)?|auth\.json|id_rsa|id_ed25519|[^/]+\.pem)$/i;

export function parseReviewVerdict(raw: unknown): SwarmReviewVerdict {
  const parsed = swarmReviewSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('reviewer output was not readable');
  }
  return parsed.data;
}

export function gateReviewVerdict(
  verdict: SwarmReviewVerdict,
  files: readonly string[],
): SwarmReviewVerdict {
  if (
    verdict.verdict === 'approve' &&
    files.some((file) => SENSITIVE_REVIEW_PATH.test(file))
  ) {
    return {
      verdict: 'fix',
      issues: ['reviewer cannot approve credential or key files'],
    };
  }
  return verdict;
}

export class CliSwarmReviewer implements SwarmReviewer {
  constructor(private readonly options: StructuredCallOptions) {}

  /** Same rule as the planner: the selected runtime, or a visible failure. */
  async review(request: SwarmReviewRequest): Promise<SwarmReviewVerdict> {
    const prompt = buildReviewPrompt(request);
    const raw = await callStructuredAgent(this.options, prompt, SWARM_REVIEW_JSON_SCHEMA);
    const parsed = parseReviewVerdict(raw);
    return gateReviewVerdict(parsed, request.files);
  }
}

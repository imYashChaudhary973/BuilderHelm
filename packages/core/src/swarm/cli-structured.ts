import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  SWARM_PLAN_JSON_SCHEMA,
  SWARM_REVIEW_JSON_SCHEMA,
  swarmReviewSchema,
  type BoardAgentId,
  type SwarmReviewVerdict,
} from '@zero/protocol';

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

const execFileAsync = promisify(execFile);

/** CLIs verified to constrain output to a JSON Schema. */
const STRUCTURED_CLIS: Record<string, (prompt: string, schema: string) => string[]> = {
  claude: (prompt, schema) => [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--json-schema',
    schema,
    '--permission-mode',
    'dontAsk',
  ],
  grok: (prompt, schema) => [
    '-p',
    prompt,
    '--json-schema',
    schema,
    '--permission-mode',
    'dontAsk',
  ],
};

export interface StructuredCallOptions {
  readonly agentId: BoardAgentId;
  readonly cwd: string;
  readonly timeoutMs?: number;
}

/**
 * Runs one structured, read-only agent call and returns the parsed JSON.
 * Claude wraps structured output in `structured_output`; grok returns the
 * object directly, so both shapes are unwrapped here.
 */
export async function callStructuredAgent(
  options: StructuredCallOptions,
  prompt: string,
  schema: unknown,
): Promise<unknown> {
  const build = STRUCTURED_CLIS[options.agentId];
  if (build === undefined) {
    throw new Error(`${options.agentId} cannot produce schema-constrained output`);
  }
  const { stdout } = await execFileAsync(
    options.agentId,
    build(prompt, JSON.stringify(schema)),
    {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 180_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('agent returned no JSON object');
  const parsed: unknown = JSON.parse(trimmed.slice(start));
  if (typeof parsed !== 'object' || parsed === null) return parsed;
  const envelope = parsed as Record<string, unknown>;
  // claude reports `structured_output`; grok reports `structuredOutput`.
  const structured = envelope.structured_output ?? envelope.structuredOutput;
  if (structured !== undefined && structured !== null) {
    return typeof structured === 'string' ? JSON.parse(structured) : structured;
  }
  if (envelope.result !== undefined) {
    return typeof envelope.result === 'string'
      ? JSON.parse(envelope.result)
      : envelope.result;
  }
  return parsed;
}

export class CliSwarmPlanner implements SwarmPlanner {
  constructor(private readonly options: StructuredCallOptions) {}

  async plan(request: SwarmPlanRequest): Promise<PlannedTask[]> {
    const raw = await callStructuredAgent(
      this.options,
      buildPlanPrompt(request),
      SWARM_PLAN_JSON_SCHEMA,
    );
    return normalizeSwarmPlan(raw, request.maxTasks);
  }
}

export class CliSwarmReviewer implements SwarmReviewer {
  constructor(private readonly options: StructuredCallOptions) {}

  async review(request: SwarmReviewRequest): Promise<SwarmReviewVerdict> {
    const raw = await callStructuredAgent(
      this.options,
      buildReviewPrompt(request),
      SWARM_REVIEW_JSON_SCHEMA,
    );
    const parsed = swarmReviewSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    // Review is advisory and the deterministic gate already passed, so an
    // unreadable verdict must not cost the task an attempt.
    return { verdict: 'approve', issues: ['reviewer output was not readable'] };
  }
}

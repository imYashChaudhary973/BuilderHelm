import { basename } from 'node:path';

import type { ChatUsageRow, UsageRecordWrite } from '@builderhelm/db';

/**
 * Provider adapters: each turns one provider's own usage format into
 * normalized ledger rows. Pure functions; reading files and databases lives
 * in the usage service.
 *
 * Token categories never overlap. Uncached input, cache reads, cache writes,
 * and output add up to the whole event; one-hour cache writes are part of
 * cache writes and reasoning is part of output, so neither is added again.
 */

export interface SourceContext {
  readonly accountKey: string;
  readonly accountRef: string | null;
  readonly environment: string;
  readonly sourceId: string;
}

export interface ParsedUsage {
  readonly records: UsageRecordWrite[];
  /** Lines or rows that were not readable usage. */
  readonly skipped: number;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function text(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function isoOrNull(value: unknown): string | null {
  const date =
    typeof value === 'number'
      ? new Date(value)
      : typeof value === 'string'
        ? new Date(value)
        : null;
  return date === null || Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    return object(JSON.parse(line));
  } catch {
    return null;
  }
}

// ── Claude Code transcripts ─────────────────────────────────────────────────

/**
 * Claude Code writes one JSONL line per streamed content block, so a single
 * API response appears several times with identical usage. `message.id` plus
 * `requestId` identifies the response; a resumed or forked session copies
 * those lines into a new file under the same identity, so the key also
 * deduplicates copies.
 *
 * `usage.input_tokens` already excludes cache reads and writes.
 */
export function parseClaudeTranscript(
  chunk: string,
  context: SourceContext,
): ParsedUsage {
  const records: UsageRecordWrite[] = [];
  let skipped = 0;
  for (const line of chunk.split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = parseLine(line);
    if (entry === null) {
      skipped += 1;
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const message = object(entry.message);
    const usage = object(message?.usage);
    const messageId = text(message?.id, 120);
    const requestId = text(entry.requestId, 120);
    const occurredAt = isoOrNull(entry.timestamp);
    if (message === null || usage === null || occurredAt === null) continue;
    const model = text(message.model, 200);
    const uncached = count(usage.input_tokens);
    const cacheRead = count(usage.cache_read_input_tokens);
    const cacheWrite = count(usage.cache_creation_input_tokens);
    const output = count(usage.output_tokens);
    // Placeholder turns (`<synthetic>`) carry no real usage.
    if (model === '<synthetic>' || uncached + cacheRead + cacheWrite + output === 0)
      continue;
    if (messageId === null || requestId === null) {
      skipped += 1;
      continue;
    }
    const creation = object(usage.cache_creation);
    const oneHour = Math.min(cacheWrite, count(creation?.ephemeral_1h_input_tokens));
    const details = object(usage.output_tokens_details);
    const thinking =
      details === null ? null : Math.min(output, count(details.thinking_tokens));
    const speed =
      usage.speed === 'fast' ? 'fast' : usage.speed === 'standard' ? 'standard' : null;
    const geo = text(usage.inference_geo, 32);
    const cwd = text(entry.cwd, 4096);
    records.push({
      event_key: `claude:${messageId}:${requestId}`,
      provider: 'claude',
      account_key: context.accountKey,
      account_ref: context.accountRef,
      environment: context.environment,
      session_id: text(entry.sessionId),
      session_label:
        cwd === null ? null : basename(cwd).slice(0, 200) || cwd.slice(0, 200),
      model_id: model,
      occurred_at: occurredAt,
      uncached_input_tokens: uncached,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      cache_write_1h_tokens: oneHour,
      output_tokens: output,
      reasoning_tokens: thinking,
      reported_cost_usd: null,
      service_tier: text(usage.service_tier, 64),
      speed,
      inference_geo: geo === 'not_available' ? null : geo,
      source: 'claude-transcript',
      source_id: context.sourceId,
      complete: [
        'input_tokens',
        'output_tokens',
        'cache_read_input_tokens',
        'cache_creation_input_tokens',
      ].every((key) => typeof usage[key] === 'number'),
    });
  }
  return { records, skipped };
}

// ── Codex rollouts ──────────────────────────────────────────────────────────

/** State carried between incremental reads of one rollout file. */
export interface CodexCursor {
  sessionId: string | null;
  model: string | null;
  sessionLabel: string | null;
  serviceTier: string | null;
  lastTotal: number | null;
}

export const EMPTY_CODEX_CURSOR: CodexCursor = {
  sessionId: null,
  model: null,
  sessionLabel: null,
  serviceTier: null,
  lastTotal: null,
};

/**
 * Codex rollouts emit a `token_count` event after each model call with the
 * call's usage (`last_token_usage`) and the session's running total. Codex
 * re-emits an unchanged total on some turns; those repeats are skipped. The
 * key uses the event's own timestamp and running total, so a forked rollout
 * that copies history keeps one copy.
 *
 * `input_tokens` includes `cached_input_tokens`, and `output_tokens`
 * includes `reasoning_output_tokens`. Codex does not record cache writes, so
 * every record is marked incomplete.
 */
export function parseCodexRollout(
  chunk: string,
  context: SourceContext,
  cursor: CodexCursor,
): ParsedUsage & { cursor: CodexCursor } {
  const records: UsageRecordWrite[] = [];
  let skipped = 0;
  const next = { ...cursor };
  for (const line of chunk.split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = parseLine(line);
    if (entry === null) {
      skipped += 1;
      continue;
    }
    const payload = object(entry.payload);
    if (payload === null) continue;
    if (entry.type === 'session_meta') {
      next.sessionId = text(payload.id) ?? next.sessionId;
      const cwd = text(payload.cwd, 4096);
      if (cwd !== null) next.sessionLabel = basename(cwd).slice(0, 200) || null;
      continue;
    }
    if (entry.type === 'turn_context') {
      next.model = text(payload.model, 200) ?? next.model;
      next.serviceTier = text(payload.service_tier, 64) ?? next.serviceTier;
      continue;
    }
    if (entry.type !== 'event_msg' || payload.type !== 'token_count') continue;
    const info = object(payload.info);
    const last = object(info?.last_token_usage);
    const total = object(info?.total_token_usage);
    const occurredAt = isoOrNull(entry.timestamp);
    if (last === null || total === null || occurredAt === null) continue;
    const runningTotal = count(total.total_tokens);
    if (runningTotal === next.lastTotal) continue;
    next.lastTotal = runningTotal;
    const input = count(last.input_tokens);
    const cached = Math.min(input, count(last.cached_input_tokens));
    const output = count(last.output_tokens);
    const reasoning = Math.min(output, count(last.reasoning_output_tokens));
    if (input + output === 0) continue;
    const tier = next.serviceTier;
    records.push({
      event_key: `codex:${occurredAt}:${runningTotal}:${input + output}`,
      provider: 'codex',
      account_key: context.accountKey,
      account_ref: context.accountRef,
      environment: context.environment,
      session_id: next.sessionId,
      session_label: next.sessionLabel,
      model_id: next.model,
      occurred_at: occurredAt,
      uncached_input_tokens: input - cached,
      cache_read_tokens: cached,
      cache_write_tokens: 0,
      cache_write_1h_tokens: 0,
      output_tokens: output,
      reasoning_tokens: reasoning,
      reported_cost_usd: null,
      service_tier: tier,
      speed:
        tier === null
          ? null
          : tier === 'priority' || tier === 'fast'
            ? 'fast'
            : 'standard',
      inference_geo: null,
      source: 'codex-rollout',
      source_id: context.sourceId,
      complete: false,
    });
  }
  return { records, skipped, cursor: next };
}

// ── OpenCode ────────────────────────────────────────────────────────────────

export interface OpenCodeMessageRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  title: string | null;
  directory: string;
  model_id: string | null;
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  time_created: number;
  time_updated: number;
}

/** Message-level counters retain the model and day of each actual call. */
export function parseOpenCodeMessages(
  rows: readonly OpenCodeMessageRow[],
  context: SourceContext,
): ParsedUsage {
  const records: UsageRecordWrite[] = [];
  let skipped = 0;
  for (const row of rows) {
    const occurredAt = isoOrNull(row.time_created);
    if (
      occurredAt === null ||
      typeof row.id !== 'string' ||
      row.tokens_input === null ||
      row.tokens_output === null
    ) {
      skipped += 1;
      continue;
    }
    const reasoning = count(row.tokens_reasoning);
    const output = count(row.tokens_output) + reasoning;
    const uncached = count(row.tokens_input);
    const cacheRead = count(row.tokens_cache_read);
    const cacheWrite = count(row.tokens_cache_write);
    if (uncached + cacheRead + cacheWrite + output === 0) continue;
    records.push({
      event_key: `opencode:${row.id}`,
      provider: 'opencode',
      account_key: context.accountKey,
      account_ref: context.accountRef,
      environment: context.environment,
      session_id: row.session_id.slice(0, 256),
      session_label:
        text(row.title, 200) ?? (basename(row.directory).slice(0, 200) || null),
      model_id: text(row.model_id, 200),
      occurred_at: occurredAt,
      uncached_input_tokens: uncached,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      cache_write_1h_tokens: 0,
      output_tokens: output,
      reasoning_tokens: reasoning,
      reported_cost_usd:
        typeof row.cost === 'number' && Number.isFinite(row.cost) && row.cost >= 0
          ? row.cost
          : null,
      service_tier: null,
      speed: null,
      inference_geo: null,
      source: 'opencode-db',
      source_id: context.sourceId,
      complete:
        row.tokens_cache_read !== null &&
        row.tokens_cache_write !== null &&
        row.tokens_reasoning !== null,
    });
  }
  return { records, skipped };
}

// ── BuilderHelm chat ────────────────────────────────────────────────────────

const INPUT_EXCLUDES_CACHE = new Set(['anthropic', 'anthropic-compatible']);

/**
 * BuilderHelm's own API calls. The gateway stores each API's own input
 * count: Anthropic's excludes cache reads, OpenAI-style APIs include them.
 * No gateway adapter records cache writes, so only Ollama (which has none)
 * is complete.
 */
export function parseChatUsage(
  rows: readonly ChatUsageRow[],
  environment: string,
  sourceId: string,
): ParsedUsage {
  const records: UsageRecordWrite[] = [];
  for (const row of rows) {
    const cached = row.cached_input_tokens ?? 0;
    const excludes = INPUT_EXCLUDES_CACHE.has(row.protocol ?? '');
    const uncached = excludes ? row.input_tokens : Math.max(0, row.input_tokens - cached);
    const reasoning =
      row.reasoning_tokens === null
        ? null
        : Math.min(row.output_tokens, row.reasoning_tokens);
    records.push({
      event_key: `api:${row.id}`,
      provider: 'api',
      account_key: `api:${row.provider_id}`,
      account_ref: null,
      environment,
      session_id: row.thread_id,
      session_label: row.thread_title?.slice(0, 200) ?? null,
      model_id: row.model_ref.slice(row.model_ref.indexOf(':') + 1).slice(0, 200),
      occurred_at: new Date(row.created_at).toISOString(),
      uncached_input_tokens: uncached,
      cache_read_tokens: cached,
      cache_write_tokens: 0,
      cache_write_1h_tokens: 0,
      output_tokens: row.output_tokens,
      reasoning_tokens: reasoning,
      reported_cost_usd: null,
      service_tier: null,
      speed: null,
      inference_geo: null,
      source: 'builderhelm-chat',
      source_id: sourceId,
      complete: row.protocol === 'ollama',
    });
  }
  return { records, skipped: 0 };
}

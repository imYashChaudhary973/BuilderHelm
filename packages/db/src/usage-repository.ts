import { DatabaseSync } from 'node:sqlite';

import type { BuilderHelmDatabase } from './database.js';

interface UsageRecordFields {
  event_key: string;
  provider: string;
  account_key: string;
  account_ref: string | null;
  environment: string;
  session_id: string | null;
  session_label: string | null;
  model_id: string | null;
  occurred_at: string;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_write_1h_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  reported_cost_usd: number | null;
  service_tier: string | null;
  speed: string | null;
  inference_geo: string | null;
  source: string;
  source_id: string;
}

export interface UsageRecordRow extends UsageRecordFields, Record<string, unknown> {
  complete: number;
}

export interface UsageSourceRow extends Record<string, unknown> {
  id: string;
  provider: string;
  kind: string;
  account_ref: string | null;
  account_key: string | null;
  location: string | null;
  file_identity: string | null;
  size: number;
  mtime_ms: number;
  read_offset: number;
  cursor_json: string;
  state: string;
  records: number;
  skipped: number;
  message: string | null;
  last_scan_at: string | null;
}

export interface ChatUsageRow extends Record<string, unknown> {
  id: string;
  thread_id: string;
  provider_id: string;
  model_ref: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  created_at: string;
  protocol: string | null;
  provider_label: string | null;
  thread_title: string | null;
}

export interface UsageRecordWrite extends UsageRecordFields {
  complete: boolean;
}

/**
 * The usage ledger. `event_key` is the provider's own event identity, so the
 * same event read twice (a repeated transcript line, a forked session, one
 * account visible from two folders) is stored once.
 */
export class UsageRepository {
  constructor(private readonly database: BuilderHelmDatabase) {}

  /**
   * Inserts new events. An existing event is replaced only when `replace` is
   * set, for sources that report a running total (an OpenCode session row).
   */
  upsert(
    records: readonly UsageRecordWrite[],
    ingestedAt: string,
    replace = false,
  ): number {
    if (records.length === 0) return 0;
    const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
    let written = 0;
    this.database.transaction(() => {
      for (const record of records) {
        const before = this.database.queryOne<{ n: number }>(
          'SELECT count(*) AS n FROM usage_records WHERE event_key = ?',
          [record.event_key],
        );
        this.database.run(
          `${verb} INTO usage_records (
             event_key, provider, account_key, account_ref, environment, session_id,
             session_label, model_id, occurred_at, uncached_input_tokens,
             cache_read_tokens, cache_write_tokens, cache_write_1h_tokens,
             output_tokens, reasoning_tokens, reported_cost_usd, service_tier, speed,
             inference_geo, source, source_id, complete, ingested_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.event_key,
            record.provider,
            record.account_key,
            record.account_ref,
            record.environment,
            record.session_id,
            record.session_label,
            record.model_id,
            record.occurred_at,
            record.uncached_input_tokens,
            record.cache_read_tokens,
            record.cache_write_tokens,
            record.cache_write_1h_tokens,
            record.output_tokens,
            record.reasoning_tokens,
            record.reported_cost_usd,
            record.service_tier,
            record.speed,
            record.inference_geo,
            record.source,
            record.source_id,
            record.complete ? 1 : 0,
            ingestedAt,
          ],
        );
        if ((before?.n ?? 0) === 0) written += 1;
      }
    });
    return written;
  }

  /** Records at or after `from` (ISO), oldest first. */
  list(from: string | null): UsageRecordRow[] {
    return from === null
      ? this.database.queryAll<UsageRecordRow>(
          'SELECT * FROM usage_records ORDER BY occurred_at',
        )
      : this.database.queryAll<UsageRecordRow>(
          'SELECT * FROM usage_records WHERE occurred_at >= ? ORDER BY occurred_at',
          [from],
        );
  }

  countForSource(sourceId: string): number {
    return (
      this.database.queryOne<{ n: number }>(
        'SELECT count(*) AS n FROM usage_records WHERE source_id = ?',
        [sourceId],
      )?.n ?? 0
    );
  }

  source(id: string): UsageSourceRow | undefined {
    return this.database.queryOne<UsageSourceRow>(
      'SELECT * FROM usage_sources WHERE id = ?',
      [id],
    );
  }

  sources(): UsageSourceRow[] {
    return this.database.queryAll<UsageSourceRow>(
      'SELECT * FROM usage_sources ORDER BY provider, id',
    );
  }

  saveSource(row: UsageSourceRow): void {
    this.database.run(
      `INSERT INTO usage_sources (
         id, provider, kind, account_ref, account_key, location, file_identity, size,
         mtime_ms, read_offset, cursor_json, state, records, skipped, message, last_scan_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider, kind = excluded.kind,
         account_ref = excluded.account_ref, account_key = excluded.account_key,
         location = excluded.location, file_identity = excluded.file_identity,
         size = excluded.size, mtime_ms = excluded.mtime_ms,
         read_offset = excluded.read_offset, cursor_json = excluded.cursor_json,
         state = excluded.state, records = excluded.records, skipped = excluded.skipped,
         message = excluded.message, last_scan_at = excluded.last_scan_at`,
      [
        row.id,
        row.provider,
        row.kind,
        row.account_ref,
        row.account_key,
        row.location,
        row.file_identity,
        row.size,
        row.mtime_ms,
        row.read_offset,
        row.cursor_json,
        row.state,
        row.records,
        row.skipped,
        row.message,
        row.last_scan_at,
      ],
    );
  }

  /** Marks sources not seen in this scan as missing; their records stay. */
  markMissing(seen: ReadonlySet<string>, at: string): void {
    for (const row of this.sources()) {
      if (seen.has(row.id) || row.state === 'missing') continue;
      this.saveSource({
        ...row,
        state: 'missing',
        message: 'No longer on disk',
        last_scan_at: at,
      });
    }
  }

  /**
   * BuilderHelm's own model calls after `afterCreatedAt`, with the protocol of
   * the provider each was made through (it decides what input_tokens means).
   */
  chatUsage(afterCreatedAt: string | null): ChatUsageRow[] {
    return this.database.queryAll<ChatUsageRow>(
      `SELECT u.id, u.thread_id, u.provider_id, u.model_ref, u.input_tokens,
              u.output_tokens, u.cached_input_tokens, u.reasoning_tokens, u.created_at,
              p.protocol AS protocol, p.label AS provider_label, t.title AS thread_title
         FROM chat_usage u
         LEFT JOIN providers p ON p.id = u.provider_id
         LEFT JOIN chat_threads t ON t.id = u.thread_id
        WHERE ? IS NULL OR u.created_at > ?
        ORDER BY u.created_at`,
      [afterCreatedAt, afterCreatedAt],
    );
  }

  saveAccount(accountKey: string, provider: string, label: string, at: string): void {
    this.database.run(
      `INSERT INTO usage_accounts (account_key, provider, label, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_key) DO UPDATE SET
         label = excluded.label, updated_at = excluded.updated_at`,
      [accountKey, provider, label.slice(0, 200), at],
    );
  }

  accounts(): { account_key: string; provider: string; label: string }[] {
    return this.database.queryAll<{
      account_key: string;
      provider: string;
      label: string;
    }>('SELECT account_key, provider, label FROM usage_accounts');
  }
}

/**
 * Opens another program's SQLite file read-only, for reading its usage
 * columns. Never writes, never runs migrations.
 */
export function readForeignDatabase<T extends Record<string, unknown>>(
  path: string,
  sql: string,
  parameters: readonly (string | number)[] = [],
): T[] {
  const foreign = new DatabaseSync(path, { readOnly: true });
  try {
    return foreign.prepare(sql).all(...parameters) as T[];
  } finally {
    foreign.close();
  }
}

import type { Migration } from '../migration-runner.js';

/**
 * Normalized usage records read from agent CLI histories and BuilderHelm's own
 * model calls, with the scan state that makes re-reading incremental.
 */
export const usageLedgerMigration: Migration = {
  version: 26,
  name: 'usage-ledger',
  up(database) {
    database.execute(`
      CREATE TABLE usage_records (
        event_key TEXT PRIMARY KEY CHECK (length(event_key) BETWEEN 1 AND 256),
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'opencode', 'api')),
        account_key TEXT NOT NULL,
        account_ref TEXT,
        environment TEXT NOT NULL,
        session_id TEXT,
        session_label TEXT,
        model_id TEXT,
        occurred_at TEXT NOT NULL,
        uncached_input_tokens INTEGER NOT NULL CHECK (uncached_input_tokens >= 0),
        cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
        cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
        cache_write_1h_tokens INTEGER NOT NULL CHECK (
          cache_write_1h_tokens >= 0 AND cache_write_1h_tokens <= cache_write_tokens
        ),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        reasoning_tokens INTEGER CHECK (
          reasoning_tokens IS NULL OR (reasoning_tokens >= 0 AND reasoning_tokens <= output_tokens)
        ),
        reported_cost_usd REAL CHECK (reported_cost_usd IS NULL OR reported_cost_usd >= 0),
        service_tier TEXT,
        speed TEXT CHECK (speed IS NULL OR speed IN ('standard', 'fast')),
        inference_geo TEXT,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
        ingested_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX usage_records_occurred_at_idx ON usage_records(occurred_at);
      CREATE INDEX usage_records_source_id_idx ON usage_records(source_id);

      CREATE TABLE usage_sources (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        account_ref TEXT,
        account_key TEXT,
        location TEXT,
        file_identity TEXT,
        size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        read_offset INTEGER NOT NULL DEFAULT 0 CHECK (read_offset >= 0),
        cursor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cursor_json)),
        state TEXT NOT NULL CHECK (state IN ('ok', 'partial', 'failed', 'missing')),
        records INTEGER NOT NULL DEFAULT 0 CHECK (records >= 0),
        skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
        message TEXT,
        last_scan_at TEXT
      ) STRICT;

      CREATE TABLE usage_accounts (
        account_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
        updated_at TEXT NOT NULL
      ) STRICT;

    `);
  },
};

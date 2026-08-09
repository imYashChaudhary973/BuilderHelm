import type { Migration } from '../migration-runner.js';

export const providerSettingsMigration: Migration = {
  version: 2,
  name: 'provider-settings',
  up(database) {
    database.execute(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
        protocol TEXT NOT NULL CHECK (length(trim(protocol)) BETWEEN 1 AND 64),
        base_url TEXT,
        secret_ref TEXT NOT NULL UNIQUE,
        headers_json TEXT NOT NULL CHECK (json_valid(headers_json)),
        allow_personal INTEGER NOT NULL CHECK (allow_personal IN (0, 1)),
        allow_sensitive INTEGER NOT NULL CHECK (allow_sensitive IN (0, 1)),
        allow_health INTEGER NOT NULL CHECK (allow_health IN (0, 1)),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        label TEXT NOT NULL,
        privacy_class TEXT NOT NULL CHECK (privacy_class IN ('local', 'remote')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (provider_id, model_id)
      ) STRICT;

      CREATE INDEX models_provider_id_idx ON models(provider_id);

      CREATE TABLE model_capabilities (
        model_id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
        text INTEGER NOT NULL DEFAULT 1 CHECK (text IN (0, 1)),
        vision INTEGER NOT NULL DEFAULT 0 CHECK (vision IN (0, 1)),
        audio_input INTEGER NOT NULL DEFAULT 0 CHECK (audio_input IN (0, 1)),
        tool_calling INTEGER NOT NULL DEFAULT 0 CHECK (tool_calling IN (0, 1)),
        parallel_tools INTEGER NOT NULL DEFAULT 0 CHECK (parallel_tools IN (0, 1)),
        structured_output INTEGER NOT NULL DEFAULT 0 CHECK (structured_output IN (0, 1)),
        streaming INTEGER NOT NULL DEFAULT 0 CHECK (streaming IN (0, 1)),
        reasoning_controls INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_controls IN (0, 1)),
        server_web_search INTEGER NOT NULL DEFAULT 0 CHECK (server_web_search IN (0, 1)),
        server_mcp INTEGER NOT NULL DEFAULT 0 CHECK (server_mcp IN (0, 1)),
        context_window INTEGER,
        max_output_tokens INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
      ) STRICT;

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE secret_metadata (
        ref TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL UNIQUE REFERENCES providers(id) ON DELETE CASCADE,
        service TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      ) STRICT;

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        correlation_id TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        resource_refs_json TEXT NOT NULL CHECK (json_valid(resource_refs_json)),
        before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
        after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
        approval_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX audit_events_correlation_id_idx ON audit_events(correlation_id);
      CREATE INDEX audit_events_created_at_idx ON audit_events(created_at);

      CREATE TRIGGER audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit events are append-only');
      END;

      CREATE TRIGGER audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit events are append-only');
      END;
    `);
  },
};

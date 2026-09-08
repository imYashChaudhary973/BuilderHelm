import type { Migration } from '../migration-runner.js';

export const remoteSessionsMigration: Migration = {
  version: 24,
  name: 'remote-sessions',
  up(database) {
    database.execute(`
      CREATE TABLE ade_remote_sessions (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        client_label TEXT NOT NULL CHECK (length(client_label) BETWEEN 1 AND 80),
        scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;

      CREATE TABLE ade_remote_commands (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES ade_remote_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN (
          'status', 'artifacts', 'instruct', 'approve', 'cancel'
        )),
        request_id TEXT,
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX ade_remote_commands_approval_request_idx
      ON ade_remote_commands (request_id)
      WHERE kind = 'approve' AND request_id IS NOT NULL;

      CREATE TABLE ade_remote_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES ade_remote_sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('command', 'status', 'artifact', 'approval')),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE ade_remote_audit (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES ade_remote_sessions(id) ON DELETE CASCADE,
        command_id TEXT,
        action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
        outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'replayed', 'error')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX ade_remote_audit_session_idx
      ON ade_remote_audit (session_id, created_at DESC);
    `);
  },
};

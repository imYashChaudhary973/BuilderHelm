import type { Migration } from '../migration-runner.js';

export const toolsPermissionsActionsMigration: Migration = {
  version: 6,
  name: 'tools-permissions-actions',
  up(database) {
    database.execute(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
        normalized_name TEXT NOT NULL UNIQUE,
        description TEXT CHECK (description IS NULL OR length(description) <= 4000),
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
        normalized_title TEXT NOT NULL,
        description TEXT CHECK (description IS NULL OR length(description) <= 10000),
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT,
        source TEXT NOT NULL CHECK (source IN ('action_chat', 'manual', 'automation')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX tasks_project_status_idx ON tasks(project_id, status);
      CREATE INDEX tasks_normalized_title_idx ON tasks(normalized_title);

      CREATE TABLE project_decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
        title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
        detail TEXT CHECK (detail IS NULL OR length(detail) <= 10000),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX project_decisions_project_created_idx
      ON project_decisions(project_id, created_at DESC);

      CREATE TABLE permission_policies (
        tool_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('ask', 'auto_approve', 'deny')),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        tool_id TEXT NOT NULL,
        summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
        arguments_json TEXT NOT NULL CHECK (json_valid(arguments_json)),
        risk_level TEXT NOT NULL CHECK (risk_level IN (
          'read', 'draft', 'reversible_write', 'external_side_effect', 'destructive_sensitive'
        )),
        affected_resources_json TEXT NOT NULL CHECK (json_valid(affected_resources_json)),
        reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'denied', 'executed', 'expired', 'failed')),
        actor_type TEXT NOT NULL CHECK (actor_type IN ('deterministic_intent', 'model')),
        model_ref TEXT,
        correlation_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX approval_requests_status_created_idx
      ON approval_requests(status, created_at);

      CREATE TRIGGER approval_requests_immutable_fields
      BEFORE UPDATE ON approval_requests
      WHEN OLD.id != NEW.id
        OR OLD.request_id != NEW.request_id
        OR OLD.tool_id != NEW.tool_id
        OR OLD.summary != NEW.summary
        OR OLD.arguments_json != NEW.arguments_json
        OR OLD.risk_level != NEW.risk_level
        OR OLD.affected_resources_json != NEW.affected_resources_json
        OR OLD.reversible != NEW.reversible
        OR OLD.actor_type != NEW.actor_type
        OR COALESCE(OLD.model_ref, '') != COALESCE(NEW.model_ref, '')
        OR OLD.correlation_id != NEW.correlation_id
        OR OLD.expires_at != NEW.expires_at
        OR OLD.created_at != NEW.created_at
      BEGIN
        SELECT RAISE(ABORT, 'approval request arguments are immutable');
      END;

      CREATE TRIGGER approval_requests_no_delete
      BEFORE DELETE ON approval_requests
      BEGIN
        SELECT RAISE(ABORT, 'approval requests are append-only');
      END;

      CREATE TRIGGER approval_requests_terminal_once
      BEFORE UPDATE ON approval_requests
      WHEN OLD.status != 'pending'
        OR NEW.status = 'pending'
        OR NEW.resolved_at IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'approval requests can only resolve once');
      END;

      CREATE TABLE action_receipts (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        correlation_id TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('deterministic_intent', 'model')),
        actor_id TEXT,
        model_ref TEXT,
        tool_id TEXT NOT NULL,
        requested_action TEXT NOT NULL CHECK (length(requested_action) BETWEEN 1 AND 1000),
        arguments_json TEXT NOT NULL CHECK (json_valid(arguments_json)),
        approval_state TEXT NOT NULL CHECK (approval_state IN ('not_required', 'auto_approved', 'granted')),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        affected_resources_json TEXT NOT NULL CHECK (json_valid(affected_resources_json)),
        rollback_json TEXT CHECK (rollback_json IS NULL OR json_valid(rollback_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX action_receipts_created_idx ON action_receipts(created_at DESC);

      CREATE TRIGGER action_receipts_no_update
      BEFORE UPDATE ON action_receipts
      BEGIN
        SELECT RAISE(ABORT, 'action receipts are append-only');
      END;

      CREATE TRIGGER action_receipts_no_delete
      BEFORE DELETE ON action_receipts
      BEGIN
        SELECT RAISE(ABORT, 'action receipts are append-only');
      END;
    `);
  },
};

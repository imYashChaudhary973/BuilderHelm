import type { Migration } from '../migration-runner.js';

export const linearIssuesMigration: Migration = {
  version: 20,
  name: 'linear-issues',
  up(database) {
    database.execute(`
      CREATE TABLE kanban_cards_next (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        workspace TEXT NOT NULL CHECK (length(workspace) BETWEEN 1 AND 4096),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        column_name TEXT NOT NULL CHECK (
          column_name IN ('idea', 'doing', 'review', 'shipped', 'cancelled')
        ),
        created_at TEXT NOT NULL,
        detail TEXT CHECK (detail IS NULL OR length(detail) <= 10000),
        source_provider TEXT CHECK (
          source_provider IS NULL OR source_provider IN ('github', 'linear')
        ),
        source_id TEXT CHECK (source_id IS NULL OR length(source_id) BETWEEN 1 AND 200),
        source_url TEXT CHECK (source_url IS NULL OR length(source_url) BETWEEN 1 AND 2048),
        source_repository TEXT CHECK (
          source_repository IS NULL OR length(source_repository) BETWEEN 3 AND 240
        ),
        source_number INTEGER CHECK (source_number IS NULL OR source_number > 0),
        source_state TEXT CHECK (source_state IS NULL OR source_state IN ('open', 'closed')),
        source_synced_at TEXT,
        linked_run_id TEXT CHECK (linked_run_id IS NULL OR length(linked_run_id) = 36)
      ) STRICT;
    `);
    database.execute(`
      INSERT INTO kanban_cards_next (
        id, workspace, title, column_name, created_at, detail,
        source_provider, source_id, source_url, source_repository,
        source_number, source_state, source_synced_at, linked_run_id
      )
      SELECT
        id, workspace, title, column_name, created_at, detail,
        source_provider, source_id, source_url, source_repository,
        source_number, source_state, source_synced_at, linked_run_id
      FROM kanban_cards;
    `);
    database.execute(`DROP TABLE kanban_cards;`);
    database.execute(`ALTER TABLE kanban_cards_next RENAME TO kanban_cards;`);
    database.execute(`
      CREATE INDEX kanban_cards_workspace_created
      ON kanban_cards (workspace, created_at);
    `);
    database.execute(`
      CREATE UNIQUE INDEX kanban_cards_source_idx
      ON kanban_cards (source_provider, source_id)
      WHERE source_provider IS NOT NULL AND source_id IS NOT NULL;
    `);
    database.execute(`
      CREATE TABLE linear_issue_receipts (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) = 36),
        correlation_id TEXT NOT NULL CHECK (length(correlation_id) = 36),
        card_id TEXT NOT NULL CHECK (length(card_id) = 36),
        issue_id TEXT NOT NULL CHECK (length(issue_id) BETWEEN 1 AND 200),
        issue_url TEXT NOT NULL CHECK (length(issue_url) BETWEEN 1 AND 2048),
        requested_state TEXT NOT NULL CHECK (requested_state IN ('open', 'closed')),
        outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'outcome_unknown')),
        changed INTEGER NOT NULL CHECK (changed IN (0, 1)),
        detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 500),
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX linear_issue_receipts_card_created_idx
      ON linear_issue_receipts (card_id, created_at DESC);
    `);
    database.execute(`
      CREATE TRIGGER linear_issue_receipts_no_update
      BEFORE UPDATE ON linear_issue_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Linear issue receipts are append-only');
      END;
      CREATE TRIGGER linear_issue_receipts_no_delete
      BEFORE DELETE ON linear_issue_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Linear issue receipts are append-only');
      END;
    `);
  },
};

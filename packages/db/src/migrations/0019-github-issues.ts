import type { Migration } from '../migration-runner.js';

export const githubIssuesMigration: Migration = {
  version: 19,
  name: 'github-issues',
  up(database) {
    database.execute(`
      ALTER TABLE kanban_cards
      ADD COLUMN detail TEXT CHECK (detail IS NULL OR length(detail) <= 10000);
      ALTER TABLE kanban_cards
      ADD COLUMN source_provider TEXT CHECK (source_provider IS NULL OR source_provider = 'github');
      ALTER TABLE kanban_cards
      ADD COLUMN source_id TEXT CHECK (source_id IS NULL OR length(source_id) BETWEEN 1 AND 200);
      ALTER TABLE kanban_cards
      ADD COLUMN source_url TEXT CHECK (source_url IS NULL OR length(source_url) BETWEEN 1 AND 2048);
      ALTER TABLE kanban_cards
      ADD COLUMN source_repository TEXT CHECK (
        source_repository IS NULL OR length(source_repository) BETWEEN 3 AND 240
      );
      ALTER TABLE kanban_cards
      ADD COLUMN source_number INTEGER CHECK (source_number IS NULL OR source_number > 0);
      ALTER TABLE kanban_cards
      ADD COLUMN source_state TEXT CHECK (source_state IS NULL OR source_state IN ('open', 'closed'));
      ALTER TABLE kanban_cards
      ADD COLUMN source_synced_at TEXT;
      ALTER TABLE kanban_cards
      ADD COLUMN linked_run_id TEXT CHECK (linked_run_id IS NULL OR length(linked_run_id) = 36);
    `);
    database.execute(`
      CREATE UNIQUE INDEX kanban_cards_source_idx
      ON kanban_cards (source_provider, source_id)
      WHERE source_provider IS NOT NULL AND source_id IS NOT NULL;
    `);
    database.execute(`
      CREATE TABLE github_issue_receipts (
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
      CREATE INDEX github_issue_receipts_card_created_idx
      ON github_issue_receipts (card_id, created_at DESC);
    `);
    database.execute(`
      CREATE TRIGGER github_issue_receipts_no_update
      BEFORE UPDATE ON github_issue_receipts
      BEGIN
        SELECT RAISE(ABORT, 'GitHub issue receipts are append-only');
      END;
      CREATE TRIGGER github_issue_receipts_no_delete
      BEFORE DELETE ON github_issue_receipts
      BEGIN
        SELECT RAISE(ABORT, 'GitHub issue receipts are append-only');
      END;
    `);
  },
};

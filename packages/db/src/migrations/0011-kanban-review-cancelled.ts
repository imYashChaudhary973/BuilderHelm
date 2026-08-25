import type { Migration } from '../migration-runner.js';

export const kanbanReviewCancelledMigration: Migration = {
  version: 11,
  name: 'kanban-review-cancelled',
  up(database) {
    database.execute(`
      CREATE TABLE kanban_cards_next (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        workspace TEXT NOT NULL CHECK (length(workspace) BETWEEN 1 AND 4096),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        column_name TEXT NOT NULL CHECK (
          column_name IN ('idea', 'doing', 'review', 'shipped', 'cancelled')
        ),
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      INSERT INTO kanban_cards_next (id, workspace, title, column_name, created_at)
      SELECT id, workspace, title, column_name, created_at
      FROM kanban_cards;
    `);
    database.execute(`DROP TABLE kanban_cards;`);
    database.execute(`ALTER TABLE kanban_cards_next RENAME TO kanban_cards;`);
    database.execute(`
      CREATE INDEX kanban_cards_workspace_created
      ON kanban_cards (workspace, created_at);
    `);
  },
};

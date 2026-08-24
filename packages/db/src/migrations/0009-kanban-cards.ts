import type { Migration } from '../migration-runner.js';

export const kanbanCardsMigration: Migration = {
  version: 9,
  name: 'kanban-cards',
  up(database) {
    database.execute(`
      CREATE TABLE kanban_cards (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        workspace TEXT NOT NULL CHECK (length(workspace) BETWEEN 1 AND 4096),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        column_name TEXT NOT NULL CHECK (column_name IN ('idea', 'doing', 'shipped')),
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX kanban_cards_workspace_created
      ON kanban_cards (workspace, created_at);
    `);
  },
};

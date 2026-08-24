import type { Migration } from '../migration-runner.js';

export const kanbanProjectsMigration: Migration = {
  version: 10,
  name: 'kanban-projects',
  up(database) {
    database.execute(`
      CREATE TABLE kanban_projects (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 4096),
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 120),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX kanban_projects_updated
      ON kanban_projects (updated_at DESC);
    `);
    database.execute(`
      INSERT INTO kanban_projects (id, name, created_at, updated_at)
      SELECT
        workspace,
        CASE WHEN workspace = 'global' THEN 'BuilderHelm' ELSE substr(workspace, 1, 120) END,
        min(created_at),
        max(created_at)
      FROM kanban_cards
      GROUP BY workspace;
    `);
  },
};

import type { Migration } from '../migration-runner.js';

export const notesMigration: Migration = {
  version: 21,
  name: 'notes',
  up(database) {
    database.execute(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        workspace TEXT NOT NULL CHECK (length(workspace) BETWEEN 1 AND 4096),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        body TEXT NOT NULL CHECK (length(body) <= 100000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX notes_workspace_updated_idx
      ON notes (workspace, updated_at DESC);
    `);
  },
};

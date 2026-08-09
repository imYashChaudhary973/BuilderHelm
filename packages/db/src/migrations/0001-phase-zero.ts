import type { Migration } from '../migration-runner.js';

export const phaseZeroMigration: Migration = {
  version: 1,
  name: 'phase-zero-foundation',
  up(database) {
    database.execute(`
      CREATE TABLE zero_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  },
};

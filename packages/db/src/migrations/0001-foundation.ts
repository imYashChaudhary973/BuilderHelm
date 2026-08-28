import type { Migration } from '../migration-runner.js';

export const foundationMigration: Migration = {
  version: 1,
  name: 'builderhelm-foundation',
  up(database) {
    database.execute(`
      CREATE TABLE builderhelm_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  },
};

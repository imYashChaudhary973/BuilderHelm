import type { Migration } from '../migration-runner.js';

export const previewArtifactsMigration: Migration = {
  version: 15,
  name: 'preview-artifacts',
  up(database) {
    database.execute(`
      CREATE TABLE preview_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        head_sha TEXT NOT NULL CHECK (length(head_sha) BETWEEN 7 AND 64),
        kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'snapshot')),
        url TEXT NOT NULL CHECK (length(url) <= 4096),
        viewport TEXT NOT NULL CHECK (viewport IN ('desktop', 'tablet', 'phone')),
        body_json TEXT,
        png BLOB,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX preview_artifacts_head_created_idx
      ON preview_artifacts (head_sha, created_at DESC);
    `);
    database.execute(`
      CREATE INDEX preview_artifacts_run_created_idx
      ON preview_artifacts (run_id, created_at DESC);
    `);
  },
};

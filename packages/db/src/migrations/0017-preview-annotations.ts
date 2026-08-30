import type { Migration } from '../migration-runner.js';

/**
 * Annotations are preview artifacts with a note. They ride the same table so a
 * reviewer sees them beside snapshots and screenshots on the same revision;
 * only the `kind` CHECK has to widen.
 */
export const previewAnnotationsMigration: Migration = {
  version: 17,
  name: 'preview-annotations',
  up(database) {
    database.execute(`
      CREATE TABLE preview_artifacts_v17 (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        head_sha TEXT NOT NULL CHECK (length(head_sha) BETWEEN 7 AND 64),
        kind TEXT NOT NULL CHECK (
          kind IN ('screenshot', 'snapshot', 'tool', 'console', 'annotation')
        ),
        url TEXT NOT NULL CHECK (length(url) <= 4096),
        viewport TEXT NOT NULL CHECK (viewport IN ('desktop', 'tablet', 'phone')),
        body_json TEXT,
        png BLOB,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      INSERT INTO preview_artifacts_v17
      SELECT id, run_id, head_sha, kind, url, viewport, body_json, png, created_at
      FROM preview_artifacts;
    `);
    database.execute(`DROP TABLE preview_artifacts;`);
    database.execute(`ALTER TABLE preview_artifacts_v17 RENAME TO preview_artifacts;`);
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

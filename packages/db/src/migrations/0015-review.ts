import type { Migration } from '../migration-runner.js';

export const reviewPersistenceMigration: Migration = {
  version: 15,
  name: 'review-persistence',
  up(database) {
    database.execute(`
      CREATE TABLE review_comments (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL CHECK (length(root_path) BETWEEN 1 AND 4096),
        head_sha TEXT NOT NULL CHECK (length(head_sha) BETWEEN 40 AND 64),
        path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 4096),
        side TEXT NOT NULL CHECK (side IN ('old', 'new')),
        line INTEGER NOT NULL CHECK (line >= 1),
        body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
        run_id TEXT,
        seat_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX review_comments_root_path_idx
      ON review_comments (root_path, path, created_at);
    `);
    database.execute(`
      CREATE TABLE review_checks (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL CHECK (length(root_path) BETWEEN 1 AND 4096),
        head_sha TEXT NOT NULL CHECK (length(head_sha) BETWEEN 40 AND 64),
        command_json TEXT NOT NULL CHECK (json_valid(command_json)),
        exit_code INTEGER NOT NULL,
        output TEXT NOT NULL CHECK (length(output) <= 32000),
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX review_checks_root_ended_idx
      ON review_checks (root_path, ended_at DESC);
    `);
  },
};

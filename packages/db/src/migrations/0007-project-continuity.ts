import type { Migration } from '../migration-runner.js';

export const projectContinuityMigration: Migration = {
  version: 7,
  name: 'project-continuity',
  up(database) {
    database.execute(`
      CREATE TABLE project_repositories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        root_path TEXT NOT NULL UNIQUE CHECK (length(root_path) BETWEEN 1 AND 4096),
        directory_name TEXT NOT NULL CHECK (length(directory_name) BETWEEN 1 AND 255),
        branch TEXT NOT NULL CHECK (length(branch) BETWEEN 1 AND 255),
        head_sha TEXT NOT NULL CHECK (length(head_sha) BETWEEN 40 AND 64),
        dirty_count INTEGER NOT NULL CHECK (dirty_count >= 0),
        ahead_count INTEGER NOT NULL CHECK (ahead_count >= 0),
        behind_count INTEGER NOT NULL CHECK (behind_count >= 0),
        last_synced_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE repository_commits (
        repository_id TEXT NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
        sha TEXT NOT NULL CHECK (length(sha) BETWEEN 40 AND 64),
        short_sha TEXT NOT NULL CHECK (length(short_sha) BETWEEN 7 AND 16),
        subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 500),
        author_name TEXT NOT NULL CHECK (length(author_name) BETWEEN 1 AND 200),
        authored_at TEXT NOT NULL,
        PRIMARY KEY (repository_id, sha)
      ) STRICT;

      CREATE INDEX repository_commits_authored_idx
      ON repository_commits(repository_id, authored_at DESC);
    `);
  },
};

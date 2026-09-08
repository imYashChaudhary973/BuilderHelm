import type { Migration } from '../migration-runner.js';

export const workspaceFoundationMigration: Migration = {
  version: 25,
  name: 'workspace-foundation',
  up(database) {
    database.execute(`
      CREATE TABLE ade_workspaces (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('provisioning','running','interrupted','closed')),
        record_json TEXT NOT NULL CHECK(json_valid(record_json)),
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE ade_workspace_metadata (
        root TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        color TEXT NOT NULL
      ) STRICT;
      CREATE TABLE ade_terminal_output (
        workspace_id TEXT NOT NULL REFERENCES ade_workspaces(id),
        pane_id TEXT NOT NULL,
        text TEXT NOT NULL CHECK(length(text)<=262144),
        PRIMARY KEY(workspace_id, pane_id)
      ) STRICT;
      CREATE TABLE ade_editor_drafts (
        root TEXT NOT NULL,
        path TEXT NOT NULL,
        text TEXT NOT NULL,
        base_text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(root, path)
      ) STRICT;
    `);
  },
};

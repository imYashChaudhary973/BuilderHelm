import type { Migration } from '../migration-runner.js';

export const swarmPersistenceMigration: Migration = {
  version: 12,
  name: 'swarm-persistence',
  up(database) {
    database.execute(`
      CREATE TABLE swarm_runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        folder_path TEXT NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 4096),
        mission TEXT NOT NULL CHECK (length(mission) BETWEEN 1 AND 10000),
        launch_mode TEXT NOT NULL CHECK (launch_mode IN ('safe', 'auto', 'full')),
        preset_id TEXT NOT NULL CHECK (preset_id IN ('skiff', 'cutter', 'frigate', 'flagship')),
        board_session_id TEXT,
        status TEXT NOT NULL CHECK (status IN (
          'running', 'stuck', 'budget', 'stopped', 'done', 'failed'
        )),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        budget_ms INTEGER NOT NULL CHECK (budget_ms BETWEEN 60000 AND 86400000)
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX swarm_runs_status_started_idx
      ON swarm_runs (status, started_at DESC);
    `);

    database.execute(`
      CREATE TABLE swarm_seats (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('coordinator', 'builder', 'scout', 'reviewer')),
        agent_id TEXT NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 64),
        mode TEXT NOT NULL CHECK (mode IN ('safe', 'auto', 'full')),
        pane_id TEXT,
        worktree_path TEXT CHECK (worktree_path IS NULL OR length(worktree_path) BETWEEN 1 AND 4096),
        branch TEXT CHECK (branch IS NULL OR length(branch) BETWEEN 1 AND 255),
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'booting', 'working', 'idle', 'exited', 'failed'
        )),
        tokens_used INTEGER NOT NULL CHECK (tokens_used >= 0),
        cost_usd REAL NOT NULL CHECK (cost_usd >= 0)
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX swarm_seats_run_idx ON swarm_seats (run_id, role);
    `);

    database.execute(`
      CREATE TABLE swarm_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
        seat_id TEXT REFERENCES swarm_seats(id) ON DELETE SET NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
        detail TEXT CHECK (detail IS NULL OR length(detail) <= 10000),
        files_json TEXT NOT NULL CHECK (json_valid(files_json)),
        status TEXT NOT NULL CHECK (status IN (
          'pending', 'in_progress', 'review', 'landed', 'failed', 'skipped'
        )),
        depends_on_json TEXT NOT NULL CHECK (json_valid(depends_on_json)),
        attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 3),
        landed_commit TEXT CHECK (landed_commit IS NULL OR length(landed_commit) BETWEEN 7 AND 40),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX swarm_tasks_run_status_idx ON swarm_tasks (run_id, status);
    `);

    database.execute(`
      CREATE TABLE swarm_messages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE RESTRICT,
        seat_id TEXT REFERENCES swarm_seats(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'directive', 'seat_report', 'coordinator_note', 'task_event', 'system'
        )),
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      CREATE INDEX swarm_messages_run_created_idx
      ON swarm_messages (run_id, created_at DESC);
    `);
    database.execute(`
      CREATE TRIGGER swarm_messages_no_update
      BEFORE UPDATE ON swarm_messages
      BEGIN
        SELECT RAISE(ABORT, 'swarm messages are append-only');
      END;
    `);
    database.execute(`
      CREATE TRIGGER swarm_messages_no_delete
      BEFORE DELETE ON swarm_messages
      BEGIN
        SELECT RAISE(ABORT, 'swarm messages are append-only');
      END;
    `);
  },
};

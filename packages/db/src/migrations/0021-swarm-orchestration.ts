import type { Migration } from '../migration-runner.js';

export const swarmOrchestrationMigration: Migration = {
  version: 21,
  name: 'swarm-orchestration',
  up(database) {
    database.execute('PRAGMA foreign_keys = OFF;');
    database.execute(`
      CREATE TABLE swarm_runs_next (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        folder_path TEXT NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 4096),
        mission TEXT NOT NULL CHECK (length(mission) BETWEEN 1 AND 10000),
        launch_mode TEXT NOT NULL CHECK (launch_mode IN ('safe', 'auto', 'full')),
        preset_id TEXT NOT NULL CHECK (preset_id IN ('skiff', 'cutter', 'frigate', 'flagship')),
        skills_json TEXT NOT NULL CHECK (json_valid(skills_json)),
        board_session_id TEXT,
        status TEXT NOT NULL CHECK (status IN (
          'running', 'stuck', 'budget', 'stopped', 'done', 'failed', 'partial'
        )),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        budget_ms INTEGER NOT NULL CHECK (budget_ms BETWEEN 60000 AND 86400000)
      ) STRICT;
    `);
    database.execute(`
      INSERT INTO swarm_runs_next (
        id, name, folder_path, mission, launch_mode, preset_id, skills_json,
        board_session_id, status, started_at, ended_at, budget_ms
      )
      SELECT id, name, folder_path, mission, launch_mode, preset_id, skills_json,
             board_session_id, status, started_at, ended_at, budget_ms
      FROM swarm_runs;
    `);
    database.execute('DROP TABLE swarm_runs;');
    database.execute('ALTER TABLE swarm_runs_next RENAME TO swarm_runs;');
    database.execute(`
      CREATE INDEX swarm_runs_status_started_idx
      ON swarm_runs (status, started_at DESC);
    `);

    database.execute(
      'ALTER TABLE swarm_tasks ADD COLUMN base_sha TEXT CHECK (base_sha IS NULL OR length(base_sha) BETWEEN 7 AND 40);',
    );

    database.execute(`
      CREATE TABLE swarm_messages_next (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE RESTRICT,
        seat_id TEXT REFERENCES swarm_seats(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'directive', 'seat_report', 'coordinator_note', 'task_event', 'system',
          'question', 'answer', 'handoff', 'progress', 'artifact'
        )),
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    database.execute(`
      INSERT INTO swarm_messages_next (id, run_id, seat_id, task_id, kind, body, created_at)
      SELECT id, run_id, seat_id, NULL, kind, body, created_at
      FROM swarm_messages;
    `);
    database.execute('DROP TABLE swarm_messages;');
    database.execute('ALTER TABLE swarm_messages_next RENAME TO swarm_messages;');
    database.execute(`
      CREATE INDEX swarm_messages_run_created_idx
      ON swarm_messages (run_id, created_at DESC);
    `);
    database.execute(`
      CREATE INDEX swarm_messages_task_idx
      ON swarm_messages (task_id, created_at);
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
    database.execute('PRAGMA foreign_keys = ON;');
  },
};

import type { Migration } from '../migration-runner.js';

export const schedulesMigration: Migration = {
  version: 23,
  name: 'schedules',
  up(database) {
    database.execute(`
      CREATE TABLE ade_schedules (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        state TEXT NOT NULL CHECK (state IN ('active', 'paused')),
        lifetime TEXT NOT NULL CHECK (lifetime = 'desktop-open'),
        timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
        trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json)),
        task_json TEXT NOT NULL CHECK (json_valid(task_json)),
        config_version INTEGER NOT NULL CHECK (config_version >= 1),
        overlap_policy TEXT NOT NULL CHECK (overlap_policy = 'skip'),
        budget_usd REAL NOT NULL CHECK (budget_usd >= 0),
        remaining_budget_usd REAL NOT NULL CHECK (remaining_budget_usd >= 0),
        notification TEXT NOT NULL CHECK (notification = 'in-app'),
        next_run_at TEXT,
        last_tick_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE ade_schedule_runs (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        schedule_id TEXT NOT NULL REFERENCES ade_schedules(id) ON DELETE CASCADE,
        config_version INTEGER NOT NULL CHECK (config_version >= 1),
        trigger_id TEXT NOT NULL UNIQUE CHECK (length(trigger_id) BETWEEN 1 AND 200),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT NOT NULL CHECK (outcome IN (
          'running', 'succeeded', 'failed', 'skipped', 'cancelled',
          'needs_approval', 'outcomeUnknown'
        )),
        skip_reason TEXT CHECK (skip_reason IS NULL OR skip_reason IN (
          'overlap', 'missed-paid', 'expired-account', 'quota', 'duplicate',
          'paused', 'host-restart'
        )),
        connector_job_id TEXT,
        remote_job_id TEXT,
        notice TEXT CHECK (notice IS NULL OR length(notice) <= 500),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX ade_schedule_runs_schedule_started_idx
      ON ade_schedule_runs (schedule_id, started_at DESC);
    `);
  },
};

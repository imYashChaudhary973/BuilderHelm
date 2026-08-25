import { afterEach, describe, expect, it } from 'vitest';

import {
  migrations,
  openDatabase,
  runMigrations,
  type ZeroDatabase,
} from '../src/index.js';

const openDatabases: ZeroDatabase[] = [];

function setup(): ZeroDatabase {
  const database = openDatabase(':memory:');
  openDatabases.push(database);
  runMigrations(database, migrations);
  return database;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function seedRun(database: ZeroDatabase): string {
  const id = '00000000-0000-4000-8000-000000000001';
  database.run(
    `INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
       skills_json, board_session_id, status, started_at, ended_at, budget_ms)
     VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 'running', ?, NULL, ?)`,
    [
      id,
      'Swarm One',
      '/tmp/repo',
      'ship the feature',
      'auto',
      'skiff',
      '2026-08-25T10:00:00.000Z',
      20 * 60 * 1000,
    ],
  );
  return id;
}

function seedSeat(database: ZeroDatabase, runId: string): string {
  const id = '00000000-0000-4000-8000-000000000002';
  database.run(
    `INSERT INTO swarm_seats (id, run_id, role, agent_id, mode, pane_id,
       worktree_path, branch, status, tokens_used, cost_usd)
     VALUES (?, ?, 'builder', 'grok', 'auto', NULL, NULL, NULL, 'queued', 0, 0)`,
    [id, runId],
  );
  return id;
}

describe('swarm persistence migration', () => {
  it('creates the four swarm tables', () => {
    const database = setup();
    for (const table of ['swarm_runs', 'swarm_seats', 'swarm_tasks', 'swarm_messages']) {
      expect(
        database.queryOne<{ count: number }>(
          'SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?',
          ['table', table],
        ),
      ).toEqual({ count: 1 });
    }
  });

  it('rejects invalid run status and launch mode', () => {
    const database = setup();
    expect(() =>
      database.run(
        `INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
           skills_json, board_session_id, status, started_at, ended_at, budget_ms)
         VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 'bogus', ?, NULL, ?)`,
        [
          '00000000-0000-4000-8000-000000000009',
          'X',
          '/tmp/r',
          'm',
          'auto',
          'skiff',
          '2026-08-25T10:00:00.000Z',
          20 * 60 * 1000,
        ],
      ),
    ).toThrow(/CHECK|status/i);
    expect(() =>
      database.run(
        `INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
           skills_json, board_session_id, status, started_at, ended_at, budget_ms)
         VALUES (?, ?, ?, ?, 'yolo', ?, '[]', NULL, 'running', ?, NULL, ?)`,
        [
          '00000000-0000-4000-8000-000000000009',
          'X',
          '/tmp/r',
          'm',
          'skiff',
          '2026-08-25T10:00:00.000Z',
          20 * 60 * 1000,
        ],
      ),
    ).toThrow(/CHECK|launch_mode/i);
  });

  it('stores tasks with file ownership and dependency json', () => {
    const database = setup();
    const runId = seedRun(database);
    const seatId = seedSeat(database, runId);
    const taskId = '00000000-0000-4000-8000-000000000003';
    database.run(
      `INSERT INTO swarm_tasks (id, run_id, seat_id, title, detail, files_json,
         status, depends_on_json, attempts, landed_commit, created_at, updated_at)
       VALUES (?, ?, ?, 'Implement X', NULL, ?, 'pending', ?, 0, NULL, ?, ?)`,
      [
        taskId,
        runId,
        seatId,
        JSON.stringify(['src/x.ts']),
        JSON.stringify([]),
        '2026-08-25T10:00:00.000Z',
        '2026-08-25T10:00:00.000Z',
      ],
    );
    const row = database.queryOne<{ files_json: string; depends_on_json: string }>(
      'SELECT files_json, depends_on_json FROM swarm_tasks WHERE id = ?',
      [taskId],
    );
    expect(JSON.parse(row!.files_json)).toEqual(['src/x.ts']);
    expect(JSON.parse(row!.depends_on_json)).toEqual([]);
  });

  it('keeps messages append-only and protects run history', () => {
    const database = setup();
    const runId = seedRun(database);
    const seatId = seedSeat(database, runId);
    const messageId = '00000000-0000-4000-8000-000000000004';
    database.run(
      `INSERT INTO swarm_messages (id, run_id, seat_id, kind, body, created_at)
       VALUES (?, ?, ?, 'directive', 'wrap up', ?)`,
      [messageId, runId, seatId, '2026-08-25T10:01:00.000Z'],
    );
    expect(() =>
      database.run('UPDATE swarm_messages SET body = ? WHERE id = ?', [
        'rewritten',
        messageId,
      ]),
    ).toThrow(/append-only/);
    expect(() =>
      database.run('DELETE FROM swarm_messages WHERE id = ?', [messageId]),
    ).toThrow(/append-only/);

    // The ledger is append-only history: a run that has messages cannot be
    // deleted, so swarm history survives.
    expect(() => database.run('DELETE FROM swarm_runs WHERE id = ?', [runId])).toThrow();
    expect(
      database.queryOne<{ count: number }>(
        'SELECT COUNT(*) AS count FROM swarm_messages',
      ),
    ).toEqual({ count: 1 });
    expect(
      database.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM swarm_seats'),
    ).toEqual({ count: 1 });
  });
});

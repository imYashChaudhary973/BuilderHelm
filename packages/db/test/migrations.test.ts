import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  migrations,
  openDatabase,
  runMigrations,
  type BuilderHelmDatabase,
} from '../src/index.js';

const openDatabases: BuilderHelmDatabase[] = [];
const temporaryDirectories: string[] = [];

function createTestDatabase(): BuilderHelmDatabase {
  const database = openDatabase(':memory:');
  openDatabases.push(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('migration runner', () => {
  it('migrates a clean database and records the version', () => {
    const database = createTestDatabase();
    const result = runMigrations(database, migrations);

    expect(result).toEqual({
      applied: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      ],
      currentVersion: 21,
    });
    expect(
      database.queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'builderhelm_metadata'",
      ),
    ).toEqual({ count: 1 });
  });

  it('adopts existing cards into a BuilderHelm project board', () => {
    const database = createTestDatabase();
    runMigrations(database, migrations.slice(0, 9));
    database.run(
      `INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        '00000000-0000-4000-8000-000000000001',
        'global',
        'Existing task',
        'idea',
        '2026-08-24T00:00:00.000Z',
      ],
    );

    expect(runMigrations(database, migrations)).toEqual({
      applied: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      currentVersion: 21,
    });
    expect(
      database.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM kanban_projects WHERE id = ?`,
        ['global'],
      ),
    ).toEqual({ id: 'global', name: 'BuilderHelm' });
    for (const column of ['review', 'cancelled'] as const) {
      database.run(
        `INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          column === 'review'
            ? '00000000-0000-4000-8000-000000000002'
            : '00000000-0000-4000-8000-000000000003',
          'global',
          column,
          column,
          '2026-08-24T00:00:01.000Z',
        ],
      );
    }
    expect(
      database
        .queryAll<{ column_name: string }>(
          `SELECT column_name FROM kanban_cards WHERE workspace = ? ORDER BY column_name`,
          ['global'],
        )
        .map((row) => row.column_name),
    ).toEqual(['cancelled', 'idea', 'review']);
  });

  it('adds GitHub source identity without rewriting existing cards', () => {
    const database = createTestDatabase();
    runMigrations(database, migrations.slice(0, 18));
    database.run(
      `INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        '00000000-0000-4000-8000-000000000011',
        'global',
        'Unlinked task',
        'idea',
        '2026-08-31T00:00:00.000Z',
      ],
    );
    expect(runMigrations(database, migrations)).toEqual({
      applied: [19, 20, 21],
      currentVersion: 21,
    });
    expect(
      database.queryOne<{ source_id: string | null; source_provider: string | null }>(
        `SELECT source_id, source_provider FROM kanban_cards WHERE id = ?`,
        ['00000000-0000-4000-8000-000000000011'],
      ),
    ).toEqual({ source_id: null, source_provider: null });
  });

  it('is idempotent after the latest migration', () => {
    const database = createTestDatabase();
    runMigrations(database, migrations);

    expect(runMigrations(database, migrations)).toEqual({
      applied: [],
      currentVersion: 21,
    });
  });

  it('migrates and reopens a clean database file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'builderhelm-db-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'clean.sqlite');
    const first = openDatabase(path);
    runMigrations(first, migrations);
    first.close();

    const reopened = openDatabase(path);
    openDatabases.push(reopened);
    expect(runMigrations(reopened, migrations)).toEqual({
      applied: [],
      currentVersion: 21,
    });
  });

  it('rejects a migration history with a gap', () => {
    const database = createTestDatabase();

    expect(() =>
      runMigrations(database, [
        {
          version: 2,
          name: 'invalid-start',
          up: () => undefined,
        },
      ]),
    ).toThrow('Migration sequence is invalid');
  });

  it('rolls back a failed migration', () => {
    const database = createTestDatabase();

    expect(() =>
      runMigrations(database, [
        {
          version: 1,
          name: 'broken',
          up: (migrationDatabase) => {
            migrationDatabase.execute(
              'CREATE TABLE transient_record (id TEXT PRIMARY KEY)',
            );
            throw new Error('stop');
          },
        },
      ]),
    ).toThrow('Failed to apply migration');
    expect(
      database.queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'transient_record'",
      ),
    ).toEqual({ count: 0 });
  });

  it('keeps voice settings to one row with a known model', () => {
    const database = createTestDatabase();
    runMigrations(database, migrations);

    database.run(
      `INSERT INTO voice_settings (
        id, enabled, dictation_mode, hotkey, microphone_id, model_id, updated_at
      ) VALUES (1, 1, 'hold', 'Alt+Space', NULL, 'parakeet-tdt-v3', ?)`,
      ['2026-08-29T00:00:00.000Z'],
    );

    // A second row would let two installs of the settings disagree.
    expect(() =>
      database.run(
        `INSERT INTO voice_settings (
          id, enabled, dictation_mode, hotkey, updated_at
        ) VALUES (2, 0, 'toggle', 'F5', ?)`,
        ['2026-08-29T00:00:00.000Z'],
      ),
    ).toThrow();
    // An unknown model id would survive to the engine host and fail there.
    expect(() =>
      database.run(`UPDATE voice_settings SET model_id = 'whisper-huge' WHERE id = 1`),
    ).toThrow();
    expect(() =>
      database.run(`UPDATE voice_settings SET dictation_mode = 'wave' WHERE id = 1`),
    ).toThrow();
  });

  it('keeps annotation artifacts on the same revision table', () => {
    const database = createTestDatabase();
    runMigrations(database, migrations);

    database.run(
      `INSERT INTO preview_artifacts (
        id, run_id, head_sha, kind, url, viewport, body_json, png, created_at
      ) VALUES (?, NULL, ?, 'annotation', ?, 'desktop', ?, NULL, ?)`,
      [
        '00000000-0000-4000-8000-0000000000a1',
        'abc1234',
        'http://127.0.0.1:3000/',
        '#1 label is cut off',
        '2026-08-30T00:00:00.000Z',
      ],
    );

    expect(
      database.queryOne<{ kind: string }>(
        `SELECT kind FROM preview_artifacts WHERE id = ?`,
        ['00000000-0000-4000-8000-0000000000a1'],
      ),
    ).toEqual({ kind: 'annotation' });
    // An unknown kind would reach the evidence gallery and render as nothing.
    expect(() =>
      database.run(`UPDATE preview_artifacts SET kind = 'sketch' WHERE id = ?`, [
        '00000000-0000-4000-8000-0000000000a1',
      ]),
    ).toThrow();
  });
});

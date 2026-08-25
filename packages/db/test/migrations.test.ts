import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  migrations,
  openDatabase,
  runMigrations,
  type ZeroDatabase,
} from '../src/index.js';

const openDatabases: ZeroDatabase[] = [];
const temporaryDirectories: string[] = [];

function createTestDatabase(): ZeroDatabase {
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
      applied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      currentVersion: 12,
    });
    expect(
      database.queryOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'zero_metadata'",
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
      applied: [10, 11, 12],
      currentVersion: 12,
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

  it('is idempotent after the latest migration', () => {
    const database = createTestDatabase();
    runMigrations(database, migrations);

    expect(runMigrations(database, migrations)).toEqual({
      applied: [],
      currentVersion: 12,
    });
  });

  it('migrates and reopens a clean database file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zero-db-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'clean.sqlite');
    const first = openDatabase(path);
    runMigrations(first, migrations);
    first.close();

    const reopened = openDatabase(path);
    openDatabases.push(reopened);
    expect(runMigrations(reopened, migrations)).toEqual({
      applied: [],
      currentVersion: 12,
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
});

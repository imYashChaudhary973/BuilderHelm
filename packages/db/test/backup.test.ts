import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  backupDatabaseFile,
  migrations,
  openDatabase,
  restoreDatabaseFile,
  runMigrations,
  type BuilderHelmDatabase,
} from '../src/index.js';

const openDatabases: BuilderHelmDatabase[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('database backup', () => {
  it('restores the pre-migration file and does not reverse-migrate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'builderhelm-db-backup-'));
    temporaryDirectories.push(directory);
    const location = join(directory, 'builderhelm.sqlite');

    const first = openDatabase(location);
    openDatabases.push(first);
    expect(runMigrations(first, migrations.slice(0, 1))).toEqual({
      applied: [1],
      currentVersion: 1,
    });
    first.close();
    openDatabases.pop();

    expect(backupDatabaseFile(location)).toBe(`${location}.bak`);

    const upgraded = openDatabase(location);
    openDatabases.push(upgraded);
    expect(runMigrations(upgraded, migrations).currentVersion).toBe(migrations.length);
    upgraded.close();
    openDatabases.pop();

    restoreDatabaseFile(location);
    const restored = openDatabase(location);
    openDatabases.push(restored);
    expect(
      restored.queryOne<{ version: number }>(
        'SELECT MAX(version) AS version FROM schema_migrations',
      ),
    ).toEqual({ version: 1 });
  });

  it('skips in-memory databases', () => {
    expect(backupDatabaseFile(':memory:')).toBeNull();
  });
});

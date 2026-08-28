import { utcNow, BuilderHelmError } from '@builderhelm/shared';

import type { BuilderHelmDatabase } from './database.js';

export interface MigrationDatabase {
  execute(sql: string): void;
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(database: MigrationDatabase): void;
}

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly currentVersion: number;
}

interface AppliedMigrationRow extends Record<string, unknown> {
  version: number;
  name: string;
}

function validateMigrations(migrations: readonly Migration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion || migration.name.trim().length === 0) {
      throw new BuilderHelmError(
        'MIGRATION_FAILED',
        `Migration sequence is invalid at version ${migration.version}`,
      );
    }
  }
}

export function runMigrations(
  database: BuilderHelmDatabase,
  migrations: readonly Migration[],
): MigrationResult {
  validateMigrations(migrations);
  database.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const existing = database.queryAll<AppliedMigrationRow>(
    'SELECT version, name FROM schema_migrations ORDER BY version ASC',
  );

  for (const row of existing) {
    const expected = migrations[row.version - 1];
    if (expected === undefined || expected.name !== row.name) {
      throw new BuilderHelmError(
        'MIGRATION_FAILED',
        `Applied migration ${row.version} does not match the repository migration history`,
      );
    }
  }

  const applied: number[] = [];
  for (const migration of migrations.slice(existing.length)) {
    try {
      database.transaction(() => {
        migration.up(database);
        database.run(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, utcNow()],
        );
      });
      applied.push(migration.version);
    } catch (cause) {
      throw new BuilderHelmError(
        'MIGRATION_FAILED',
        `Failed to apply migration ${migration.version}: ${migration.name}`,
        { cause, metadata: { version: migration.version, name: migration.name } },
      );
    }
  }

  return {
    applied,
    currentVersion: migrations.at(-1)?.version ?? 0,
  };
}

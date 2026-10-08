import { copyFileSync, existsSync, rmSync } from 'node:fs';

import { BuilderHelmError } from '@builderhelm/shared';

export function databaseBackupPath(location: string): string {
  return `${location}.bak`;
}

/** Copy the live DB (and WAL/SHM if present) before applying migrations. */
export function backupDatabaseFile(location: string): string | null {
  if (location === ':memory:' || !existsSync(location)) return null;
  const backup = databaseBackupPath(location);
  copyFileSync(location, backup);
  for (const suffix of ['-wal', '-shm'] as const) {
    if (existsSync(`${location}${suffix}`)) {
      copyFileSync(`${location}${suffix}`, `${backup}${suffix}`);
    } else {
      rmSync(`${backup}${suffix}`, { force: true });
    }
  }
  return backup;
}

/** Replace the live DB with its backup. There is no reverse-migration path. */
export function restoreDatabaseFile(location: string): void {
  const backup = databaseBackupPath(location);
  if (!existsSync(backup)) {
    throw new BuilderHelmError('DATABASE_FAILED', 'No database backup to restore');
  }
  copyFileSync(backup, location);
  for (const suffix of ['-wal', '-shm'] as const) {
    if (existsSync(`${backup}${suffix}`)) {
      copyFileSync(`${backup}${suffix}`, `${location}${suffix}`);
    } else {
      rmSync(`${location}${suffix}`, { force: true });
    }
  }
}

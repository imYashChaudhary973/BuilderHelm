import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemorySecretStore, ProviderService } from '../../packages/core/src/index.js';
import {
  ProviderRepository,
  migrations,
  openDatabase,
  runMigrations,
} from '../../packages/db/src/index.js';
import { createLogger } from '../../packages/observability/src/index.js';
import { createCorrelationId } from '../../packages/shared/src/index.js';

describe('provider secret persistence boundary', () => {
  it('keeps a credential sentinel out of SQLite, logs, and renderer-safe serialization', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'builderhelm-secret-boundary-'));
    const databasePath = join(directory, 'builderhelm.sqlite');
    const database = openDatabase(databasePath);
    const logs: string[] = [];
    const service = new ProviderService(
      new ProviderRepository(database),
      new MemorySecretStore(),
      createLogger((line) => logs.push(line)),
    );
    runMigrations(database, migrations);
    const sentinel = 'phase-one-credential-never-persist';

    try {
      const summary = await service.create(
        {
          label: 'Boundary check',
          protocol: 'anthropic',
          baseUrl: null,
          headers: [],
          privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
          enabled: true,
          apiKey: sentinel,
        },
        createCorrelationId(),
      );
      const rendererState = JSON.stringify(service.list());
      database.close();

      expect(readFileSync(databasePath).includes(Buffer.from(sentinel))).toBe(false);
      expect(logs.join('\n')).not.toContain(sentinel);
      expect(JSON.stringify(summary)).not.toContain(sentinel);
      expect(rendererState).not.toContain(sentinel);
    } finally {
      try {
        database.close();
      } catch {
        // Already closed after the persistence read.
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { BuilderHelmError, createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountsService } from '../src/accounts/accounts-service.js';
import {
  formatQuotaLine,
  parseClaudeRateLimits,
  parseCodexRateLimits,
} from '../src/accounts/quota.js';
import { BoardService } from '../src/board/board-service.js';

const databases: BuilderHelmDatabase[] = [];
const folders: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function setup(
  readCodex: (executable: string) => Promise<unknown> = async () => {
    throw new Error('skip-codex');
  },
): AccountsService {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  return new AccountsService(
    new SettingsRepository(database),
    new BoardService(database, logger),
    logger,
    readCodex,
  );
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe('quota parsers', () => {
  it('reads Claude statusLine rate_limits windows', () => {
    expect(
      parseClaudeRateLimits(
        {
          rate_limits: {
            five_hour: { used_percentage: 34, resets_at: 1_700_000_000 },
            seven_day: { used_percentage: 94, resets_at: '2026-09-01T00:00:00.000Z' },
          },
        },
        '2026-08-31T00:00:00.000Z',
      ),
    ).toMatchObject({
      fiveHour: { usedPercent: 34 },
      sevenDay: { usedPercent: 94, resetsAt: '2026-09-01T00:00:00.000Z' },
      source: 'statusline',
    });
  });

  it('reads Codex app-server primary and secondary windows', () => {
    expect(
      parseCodexRateLimits(
        {
          rateLimits: {
            primary: {
              usedPercent: 100,
              resetsAt: 1_700_000_000,
              windowDurationMins: 300,
            },
            secondary: {
              usedPercent: 32,
              resetsAt: 1_700_500_000,
              windowDurationMins: 10_080,
            },
          },
          rateLimitResetCredits: { availableCount: 0 },
        },
        '2026-08-31T00:00:00.000Z',
      ),
    ).toEqual({
      fiveHour: {
        usedPercent: 100,
        resetsAt: new Date(1_700_000_000 * 1000).toISOString(),
      },
      sevenDay: {
        usedPercent: 32,
        resetsAt: new Date(1_700_500_000 * 1000).toISOString(),
      },
      source: 'app-server',
      occurredAt: '2026-08-31T00:00:00.000Z',
      resetCreditsAvailable: 0,
    });
  });

  it('formats a status line from stored windows', () => {
    expect(
      formatQuotaLine({
        fiveHour: { usedPercent: 34, resetsAt: null },
        sevenDay: { usedPercent: 94, resetsAt: null },
        source: 'statusline',
        occurredAt: '2026-08-31T00:00:00.000Z',
      }),
    ).toBe('34% 5h · 94% wk');
  });
});

describe('AccountsService', () => {
  it('keeps Claude ingest and lists only subscription providers', async () => {
    const accounts = setup();
    const ingested = accounts.ingestClaude({
      rate_limits: { five_hour: { used_percentage: 12, resets_at: 1_700_000_000 } },
    });
    expect(ingested?.fiveHour?.usedPercent).toBe(12);
    const snapshot = await accounts.snapshot();
    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['claude', 'codex', 'grok']);
    expect(snapshot.agents.find((agent) => agent.id === 'claude')?.quota?.source).toBe(
      'statusline',
    );
    expect(snapshot.agents.find((agent) => agent.id === 'grok')?.quota).toBeNull();
  });

  it('stores Codex windows without probing the CLI', async () => {
    let probed = false;
    const accounts = setup(async () => {
      probed = true;
      return {};
    });
    expect(
      accounts.ingestCodex({
        rateLimits: {
          primary: { usedPercent: 8, resetsAt: 1_700_000_000, windowDurationMins: 300 },
          secondary: {
            usedPercent: 1,
            resetsAt: 1_700_500_000,
            windowDurationMins: 10_080,
          },
        },
      })?.fiveHour?.usedPercent,
    ).toBe(8);
    const snapshot = await accounts.snapshot();
    expect(probed).toBe(false);
    expect(snapshot.agents.find((agent) => agent.id === 'codex')?.quota).toMatchObject({
      fiveHour: { usedPercent: 8 },
      sevenDay: { usedPercent: 1 },
      source: 'app-server',
    });
  });

  it('keeps stored Codex windows when a live probe fails', async () => {
    const accounts = setup(async () => {
      throw new Error('probed');
    });
    accounts.ingestCodex({
      rateLimits: {
        primary: { usedPercent: 8, resetsAt: 1_700_000_000, windowDurationMins: 300 },
        secondary: {
          usedPercent: 1,
          resetsAt: 1_700_500_000,
          windowDurationMins: 10_080,
        },
      },
    });
    const snapshot = await accounts.snapshot(true);
    expect(snapshot.agents.find((agent) => agent.id === 'codex')?.quota).toMatchObject({
      fiveHour: { usedPercent: 8 },
      source: 'app-server',
    });
  });

  it('rejects unsupported config-root switches and non-folders', async () => {
    const accounts = setup();
    await expect(
      accounts.setRoot('cursor', '/tmp', createCorrelationId()),
    ).rejects.toBeInstanceOf(BuilderHelmError);
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-account-file-'));
    folders.push(dir);
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'nope');
    await expect(
      accounts.setRoot('codex', file, createCorrelationId()),
    ).rejects.toBeInstanceOf(BuilderHelmError);
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'builderhelm-account-')));
    folders.push(root);
    const after = await accounts.setRoot('claude', root, createCorrelationId());
    expect(after.agents.find((agent) => agent.id === 'claude')?.configRoot).toBe(root);
  });
});

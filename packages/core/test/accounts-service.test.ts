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
import { BuilderHelmError } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountsService, readGrokEmail } from '../src/accounts/accounts-service.js';
import {
  parseClaudeRateLimits,
  parseCodexRateLimits,
  formatQuotaLine,
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
  readCodex: (
    executable: string,
    env: Record<string, string>,
  ) => Promise<unknown> = async () => {
    throw new Error('skip-codex');
  },
): AccountsService {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'builderhelm-accounts-')));
  folders.push(root);
  return new AccountsService(
    new SettingsRepository(database),
    new BoardService(database, logger),
    logger,
    root,
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

  it('maps renamed session and weekly keys for newer Claude Code', () => {
    expect(
      parseClaudeRateLimits(
        {
          rate_limits: {
            current_session: { used_percentage: 100, resets_at: 1_700_000_000 },
            seven_day_all_models: { used_percentage: 19, resets_at: 1_700_500_000 },
            seven_day_opus: { used_percentage: 60, resets_at: 1_700_500_000 },
          },
        },
        '2026-08-31T00:00:00.000Z',
      ),
    ).toMatchObject({
      fiveHour: { usedPercent: 100 },
      sevenDay: { usedPercent: 19 },
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
    ).toMatchObject({
      fiveHour: { usedPercent: 100 },
      sevenDay: { usedPercent: 32 },
      source: 'app-server',
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

describe('readGrokEmail', () => {
  it('returns only the email field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-grok-'));
    folders.push(dir);
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({
        'https://auth.x.ai::x': {
          email: 'dev@example.com',
          refresh_token: 'secret-token-value',
          key: 'also-secret',
        },
      }),
    );
    expect(readGrokEmail(dir)).toBe('dev@example.com');
  });
});

describe('AccountsService', () => {
  it('keeps Claude ingest on the snapshot', async () => {
    const accounts = setup();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      accounts.ingestClaude({
        rate_limits: { five_hour: { used_percentage: 12, resets_at: future } },
      })?.fiveHour?.usedPercent,
    ).toBe(12);
    const snapshot = await accounts.snapshot();
    expect(snapshot.providers.map((provider) => provider.id)).toEqual([
      'claude',
      'codex',
      'grok',
    ]);
    expect(
      snapshot.providers.find((provider) => provider.id === 'claude')?.quota?.source,
    ).toBe('statusline');
  });

  it('hides a window whose reset has passed instead of faking a limit', async () => {
    const accounts = setup();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    accounts.ingestClaude({
      rate_limits: {
        five_hour: { used_percentage: 100, resets_at: past },
        seven_day: { used_percentage: 19, resets_at: future },
      },
    });
    const snapshot = await accounts.snapshot();
    const claude = snapshot.providers.find((provider) => provider.id === 'claude');
    expect(claude?.quota?.fiveHour).toBeNull();
    expect(claude?.quota?.sevenDay?.usedPercent).toBe(19);
  });

  it('adds an isolated home and points cliEnv at it', async () => {
    const accounts = setup();
    const after = await accounts.add('claude');
    const extra = after.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((home) => home.id !== 'system');
    expect(extra?.active).toBe(true);
    expect(extra?.configRoot).toMatch(/claude/);
    expect(accounts.cliEnv().CLAUDE_CONFIG_DIR).toBe(extra?.configRoot);
    expect(accounts.claudeHookRoots()).toEqual([extra?.configRoot]);
  });

  it('refuses to delete the system default', async () => {
    const accounts = setup();
    await expect(accounts.remove('codex', 'system')).rejects.toBeInstanceOf(
      BuilderHelmError,
    );
  });
});

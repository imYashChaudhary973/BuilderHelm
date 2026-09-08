import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

import {
  AccountsService,
  parseAccountRef,
  readGrokEmail,
} from '../src/accounts/accounts-service.js';
import {
  parseClaudeOAuthUsage,
  parseClaudeRateLimits,
  parseCodexRateLimits,
  formatQuotaLine,
} from '../src/accounts/quota.js';
import { readGrokBilling } from '../src/accounts/grok-usage.js';
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

  it('maps the OAuth usage endpoint response with utilization percent', () => {
    expect(
      parseClaudeOAuthUsage(
        {
          five_hour: {
            utilization: 100.0,
            resets_at: '2026-09-02T19:10:00.071442+00:00',
          },
          seven_day: {
            utilization: 19.0,
            resets_at: '2026-09-02T16:00:00.071463+00:00',
          },
          seven_day_opus: null,
        },
        '2026-08-31T00:00:00.000Z',
      ),
    ).toMatchObject({
      fiveHour: { usedPercent: 100 },
      sevenDay: { usedPercent: 19 },
      source: 'oauth',
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

describe('readGrokBilling', () => {
  it('reads the freshest billing entry and drops stale ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-grok-billing-'));
    folders.push(dir);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const fresh = new Date(Date.now() - 60_000).toISOString();
    const stale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const entry = (ts: string, percent: number): string =>
      `${JSON.stringify({
        ts,
        msg: 'billing: fetched credits config',
        ctx: {
          subscriptionTier: 'X Premium+',
          config: {
            creditUsagePercent: percent,
            currentPeriod: {
              type: 'USAGE_PERIOD_TYPE_WEEKLY',
              end: '2026-09-05T16:36:20.827756+00:00',
            },
          },
        },
      })}\n`;
    writeFileSync(
      join(dir, 'logs', 'unified.jsonl'),
      `${entry(stale, 40)}${entry(fresh, 100)}`,
    );
    const billing = readGrokBilling(dir);
    expect(billing?.usedPercent).toBe(100);
    expect(billing?.tier).toBe('X Premium+');
    expect(billing?.periodEnd).toBe('2026-09-05T16:36:20.827756+00:00');
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

  it('keeps a home whose login is still writing, and drops an untouched one', async () => {
    const accounts = setup();
    const added = await accounts.add('claude');
    const home = added.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((entry) => entry.id !== 'system');
    const configRoot = home?.configRoot ?? '';
    // A login that wrote something but has no identity yet must survive.
    writeFileSync(join(configRoot, 'partial.json'), '{}');
    const kept = await accounts.confirmLogin('claude', home?.id ?? '');
    expect(
      kept.providers
        .find((provider) => provider.id === 'claude')
        ?.homes.some((entry) => entry.id === home?.id),
    ).toBe(true);
    rmSync(join(configRoot, 'partial.json'));
    const rolled = await accounts.confirmLogin('claude', home?.id ?? '');
    expect(
      rolled.providers
        .find((provider) => provider.id === 'claude')
        ?.homes.some((entry) => entry.id === home?.id),
    ).toBe(false);
  });

  it('relabels a stored home to its login email without dropping it', async () => {
    const accounts = setup();
    const added = await accounts.add('claude');
    const home = added.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((entry) => entry.id !== 'system');
    writeFileSync(
      join(home?.configRoot ?? '', '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'user@example.com' } }),
    );
    const first = await accounts.snapshot();
    const second = await accounts.snapshot();
    for (const snapshot of [first, second]) {
      const rows = snapshot.providers.find((provider) => provider.id === 'claude')?.homes;
      expect(rows?.length).toBe(2);
      expect(rows?.find((entry) => entry.id === home?.id)?.label).toBe(
        'user@example.com',
      );
    }
  });

  it('reports a pending login as pending until the identity lands', async () => {
    const accounts = setup();
    const added = await accounts.add('claude');
    const home = added.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((entry) => entry.id !== 'system');
    const id = home?.id ?? '';
    expect(accounts.accountEmail('claude', id)).toBeNull();
    writeFileSync(
      join(home?.configRoot ?? '', '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'late@example.com' } }),
    );
    expect(accounts.accountEmail('claude', id)).toBe('late@example.com');
    const confirmed = await accounts.confirmLogin('claude', id);
    expect(
      confirmed.providers
        .find((provider) => provider.id === 'claude')
        ?.homes.find((entry) => entry.id === id)?.label,
    ).toBe('late@example.com');
  });

  it('makes the home it just created the active one', async () => {
    const accounts = setup();
    await accounts.add('grok');
    const second = await accounts.add('grok');
    const homes =
      second.providers.find((provider) => provider.id === 'grok')?.homes ?? [];
    const active = homes.filter((home) => home.active);
    expect(active).toHaveLength(1);
    expect(active[0]?.configRoot).not.toBeNull();
  });

  it('refuses to delete the system default', async () => {
    const accounts = setup();
    await expect(accounts.remove('codex', 'system')).rejects.toBeInstanceOf(
      BuilderHelmError,
    );
  });

  it('binds a named accountRef for new runs without changing other providers', async () => {
    const accounts = setup();
    const added = await accounts.add('codex');
    const home = added.providers
      .find((provider) => provider.id === 'codex')
      ?.homes.find((entry) => entry.id !== 'system');
    expect(home?.configRoot).toBeTruthy();
    expect(parseAccountRef(`codex:${home!.id}`)).toEqual({
      provider: 'codex',
      id: home!.id,
    });
    expect(accounts.cliEnvFor(`codex:${home!.id}`).CODEX_HOME).toBe(home!.configRoot);
    expect(accounts.cliEnvFor('codex:system').CODEX_HOME).toBeUndefined();
  });

  it('names conflicting credential paths without reading their contents', async () => {
    const accounts = setup();
    const first = await accounts.add('codex');
    const homeA = first.providers
      .find((provider) => provider.id === 'codex')
      ?.homes.find((entry) => entry.configRoot !== null);
    const payload = Buffer.from(JSON.stringify({ email: 'a@example.com' })).toString(
      'base64url',
    );
    writeFileSync(
      join(homeA!.configRoot!, 'auth.json'),
      JSON.stringify({ tokens: { id_token: `x.${payload}.x` } }),
    );
    await accounts.confirmLogin('codex', homeA!.id);
    const second = await accounts.add('codex');
    const homeB = second.providers
      .find((provider) => provider.id === 'codex')
      ?.homes.find((entry) => entry.id !== homeA?.id && entry.configRoot !== null);
    writeFileSync(join(homeB!.configRoot!, 'auth.json'), '{"do-not-read":true}');
    const conflicts = accounts.diagnoseAuth().filter((row) => row.provider === 'codex');
    const isolated =
      conflicts[0]?.sources.filter((source) => source.kind === 'isolated-home') ?? [];
    expect(isolated.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(conflicts)).not.toContain('do-not-read');
    const snapshot = await accounts.snapshot();
    expect(snapshot.authConflicts.some((row) => row.provider === 'codex')).toBe(true);
  });
});

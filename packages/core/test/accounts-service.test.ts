import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AccountsService,
  parseAccountRef,
  readGrokEmail,
} from '../src/accounts/accounts-service.js';
import {
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

function setupWith(
  readCodex: (
    executable: string,
    env: Record<string, string>,
  ) => Promise<unknown> = async () => {
    throw new Error('skip-codex');
  },
): {
  accounts: AccountsService;
  settings: SettingsRepository;
  board: BoardService;
  root: string;
} {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const root = tempFolder('builderhelm-accounts-');
  const settings = new SettingsRepository(database);
  const board = new BoardService(database, logger);
  const accounts = new AccountsService(settings, board, logger, root, readCodex);
  return { accounts, settings, board, root };
}

function setup(...args: Parameters<typeof setupWith>): AccountsService {
  return setupWith(...args).accounts;
}

function tempFolder(prefix: string): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  folders.push(folder);
  return folder;
}

/** A Claude config folder the person signed in with outside BuilderHelm. */
function signedInClaudeFolder(email: string): string {
  const folder = tempFolder('claude-personal-');
  writeFileSync(
    join(folder, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: email } }),
  );
  return folder;
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
      windows: [
        { id: 'session', kind: 'session', usedPercent: 34 },
        {
          id: 'weekly',
          kind: 'weekly',
          usedPercent: 94,
          resetsAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      source: 'statusline',
    });
  });

  it('maps renamed keys and keeps a per-model weekly limit as its own window', () => {
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
      windows: [
        { id: 'session', usedPercent: 100 },
        { id: 'weekly', usedPercent: 19, scope: null },
        { id: 'weekly:opus', label: 'Weekly · Opus', scope: 'Opus', usedPercent: 60 },
      ],
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
      windows: [
        { id: 'session', usedPercent: 100 },
        { id: 'weekly', usedPercent: 32 },
      ],
      source: 'app-server',
      resetCreditsAvailable: 0,
    });
  });

  it('names a lone Codex window by its length, not its slot', () => {
    // Codex 0.161 reports a ChatGPT plan's weekly limit as `primary` alone.
    const quota = parseCodexRateLimits(
      {
        rateLimitsByLimitId: {
          codex: {
            limitId: 'codex',
            primary: {
              usedPercent: 0,
              windowDurationMins: 10_080,
              resetsAt: 1_792_048_808,
            },
            secondary: null,
            planType: 'prolite',
          },
        },
        rateLimitResetCredits: { availableCount: 1 },
      },
      '2026-10-08T00:00:00.000Z',
    );
    expect(quota).toMatchObject({
      windows: [{ id: 'weekly', label: 'Weekly', kind: 'weekly', usedPercent: 0 }],
      plan: 'prolite',
      resetCreditsAvailable: 1,
    });
    expect(quota?.windows).toHaveLength(1);
  });

  it('formats a status line from stored windows', () => {
    expect(
      formatQuotaLine({
        windows: [
          {
            id: 'session',
            label: 'Session',
            kind: 'session',
            scope: null,
            usedPercent: 34,
            resetsAt: null,
          },
          {
            id: 'weekly',
            label: 'Weekly',
            kind: 'weekly',
            scope: null,
            usedPercent: 94,
            resetsAt: null,
          },
        ],
        source: 'statusline',
        occurredAt: '2026-08-31T00:00:00.000Z',
        plan: null,
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
  it('keeps Claude ingest on the login that reported it', async () => {
    const accounts = setup();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      accounts.ingestClaude('claude:system', {
        rate_limits: { five_hour: { used_percentage: 12, resets_at: future } },
      })?.windows[0]?.usedPercent,
    ).toBe(12);
    const snapshot = await accounts.snapshot();
    expect(snapshot.providers.map((provider) => provider.id)).toEqual([
      'claude',
      'codex',
      'grok',
      'opencode',
    ]);
    expect(
      snapshot.providers.find((provider) => provider.id === 'claude')?.homes[0]?.quota
        ?.source,
    ).toBe('statusline');
  });

  it('reports a window whose reset has passed as fresh, not as its old figure', async () => {
    const accounts = setup();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    accounts.ingestClaude('claude:system', {
      rate_limits: {
        five_hour: { used_percentage: 100, resets_at: past },
        seven_day: { used_percentage: 19, resets_at: future },
      },
    });
    const snapshot = await accounts.snapshot();
    const quota = snapshot.providers.find((provider) => provider.id === 'claude')
      ?.homes[0]?.quota;
    expect(quota?.windows.find((w) => w.id === 'session')).toMatchObject({
      usedPercent: 0,
      resetsAt: null,
    });
    expect(quota?.windows.find((w) => w.id === 'weekly')?.usedPercent).toBe(19);
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
    expect(accounts.claudeHookTargets()).toEqual([
      { configRoot: extra?.configRoot, accountRef: `claude:${extra?.id}` },
    ]);
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

  it('attaches a signed-in folder, binds runs to it, and only forgets it on remove', async () => {
    const accounts = setup();
    const folder = signedInClaudeFolder('work@example.com');
    const after = await accounts.attach('claude', folder);
    const home = after.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((entry) => entry.kind === 'attached');
    expect(home).toMatchObject({
      label: 'work@example.com',
      configRoot: folder,
      active: false,
    });
    expect(accounts.cliEnvFor(`claude:${home!.id}`).CLAUDE_CONFIG_DIR).toBe(folder);
    // Not BuilderHelm's folder, so no statusLine without consent.
    const roots = (): string[] =>
      accounts.claudeHookTargets().map((target) => target.configRoot);
    expect(roots()).not.toContain(folder);
    accounts.setHookSystemDefault(true);
    expect(accounts.claudeHookTargets()).toContainEqual({
      configRoot: folder,
      accountRef: `claude:${home!.id}`,
    });
    await accounts.remove('claude', home!.id);
    expect(existsSync(join(folder, '.claude.json'))).toBe(true);
  });

  it('refuses folders that hold no login, the home folder, its own homes, and repeats', async () => {
    const { accounts, root } = setupWith();
    const empty = tempFolder('claude-empty-');
    await expect(accounts.attach('claude', empty)).rejects.toThrow(/No Claude login/);
    await expect(accounts.attach('claude', homedir())).rejects.toThrow(/home folder/);
    await expect(accounts.attach('claude', 'relative/path')).rejects.toThrow(/full path/);
    const managed = join(root, 'claude', 'x');
    mkdirSync(managed, { recursive: true });
    writeFileSync(join(managed, '.claude.json'), '{}');
    await expect(accounts.attach('claude', managed)).rejects.toThrow(/already manages/);
    const folder = signedInClaudeFolder('dup@example.com');
    await accounts.attach('claude', folder);
    await expect(accounts.attach('claude', folder)).rejects.toThrow(/already attached/);
  });

  it('never deletes a stored home outside its accounts root', async () => {
    const { accounts, settings, root } = setupWith();
    // Shares the accounts root as a string prefix but is a different folder.
    const sibling = `${root}-sibling`;
    mkdirSync(sibling);
    folders.push(sibling);
    writeFileSync(join(sibling, 'keep.txt'), 'keep');
    settings.write(
      'accounts.homes',
      JSON.stringify({ claude: [{ id: 'old', label: 'Claude 1', configRoot: sibling }] }),
      new Date().toISOString(),
    );
    await accounts.remove('claude', 'old');
    expect(existsSync(join(sibling, 'keep.txt'))).toBe(true);
  });

  it('keeps a chosen name instead of relabelling it to the email', async () => {
    const accounts = setup();
    const folder = signedInClaudeFolder('me@example.com');
    const attached = await accounts.attach('claude', folder);
    const id =
      attached.providers
        .find((provider) => provider.id === 'claude')
        ?.homes.find((entry) => entry.kind === 'attached')?.id ?? '';
    await accounts.rename('claude', id, '  Personal  ');
    const snapshot = await accounts.snapshot();
    const home = snapshot.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((entry) => entry.id === id);
    expect(home).toMatchObject({ label: 'Personal', email: 'me@example.com' });
    await expect(accounts.rename('claude', id, 'Claude 3')).rejects.toThrow(/signing in/);
    await expect(accounts.rename('claude', 'system', 'Main')).rejects.toThrow(/email/);
  });

  it('lists OpenCode with one login and no isolated homes', async () => {
    const accounts = setup();
    const snapshot = await accounts.snapshot();
    const opencode = snapshot.providers.find((provider) => provider.id === 'opencode');
    expect(opencode).toMatchObject({ multiAccount: false });
    expect(opencode?.homes.map((home) => home.kind)).toEqual(['system']);
    await expect(accounts.add('opencode')).rejects.toThrow(/opencode auth login/);
    await expect(accounts.attach('opencode', tempFolder('oc-'))).rejects.toThrow(
      /opencode auth login/,
    );
    expect(accounts.cliEnvFor('opencode:system')).toEqual(accounts.cliEnv());
  });

  it('keeps each Claude login’s limits apart and drops them with the login', async () => {
    const accounts = setup();
    const folder = signedInClaudeFolder('team@example.com');
    const attached = await accounts.attach('claude', folder);
    const team = attached.providers
      .find((provider) => provider.id === 'claude')
      ?.homes.find((home) => home.kind === 'attached');
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const report = (used: number) => ({
      rate_limits: { five_hour: { used_percentage: used, resets_at: future } },
    });
    accounts.ingestClaude('claude:system', report(70));
    accounts.ingestClaude(`claude:${team!.id}`, report(5));
    // A login BuilderHelm does not know, or another provider's ref, is ignored.
    expect(accounts.ingestClaude('claude:unknown', report(99))).toBeNull();
    expect(accounts.ingestClaude('codex:system', report(99))).toBeNull();
    const used = async (): Promise<(number | undefined)[]> =>
      (await accounts.snapshot()).providers
        .find((provider) => provider.id === 'claude')!
        .homes.map((home) => home.quota?.windows[0]?.usedPercent);
    expect(await used()).toEqual([70, 5]);
    await accounts.remove('claude', team!.id);
    await accounts.attach('claude', folder);
    expect(await used()).toEqual([70, undefined]);
  });

  it('asks Codex for every signed-in login under its own CODEX_HOME', async () => {
    const asked: string[] = [];
    const { accounts, board } = setupWith(async (_executable, env) => {
      asked.push(env.CODEX_HOME ?? '');
      const used = env.CODEX_HOME?.includes('codex-b') === true ? 80 : 10;
      return {
        rateLimits: {
          primary: { usedPercent: used, windowDurationMins: 300, resetsAt: null },
        },
      };
    });
    vi.spyOn(board, 'detectAgents').mockResolvedValue([
      { id: 'codex', available: true, path: '/usr/bin/codex' } as never,
    ]);
    const signedIn = (name: string): string => {
      const folder = tempFolder(name);
      writeFileSync(join(folder, 'auth.json'), '{}');
      return folder;
    };
    const a = signedIn('codex-a-');
    const b = signedIn('codex-b-');
    await accounts.attach('codex', a);
    await accounts.attach('codex', b);
    const snapshot = await accounts.snapshot(true);
    expect(asked).toEqual(expect.arrayContaining([a, b]));
    const homes = snapshot.providers.find((provider) => provider.id === 'codex')!.homes;
    expect(
      homes
        .filter((home) => home.kind === 'attached')
        .map((home) => home.quota?.windows[0]?.usedPercent),
    ).toEqual([10, 80]);
  });

  it('gives two folders signed into one account the same key, and explains missing limits', async () => {
    const accounts = setup();
    const signedIn = (email: string, uuid: string): string => {
      const folder = tempFolder('claude-id-');
      writeFileSync(
        join(folder, '.claude.json'),
        JSON.stringify({
          oauthAccount: {
            emailAddress: email,
            accountUuid: uuid,
            organizationUuid: '11111111-2222-3333-4444-555555555555',
          },
        }),
      );
      return folder;
    };
    await accounts.attach(
      'claude',
      signedIn('a@example.com', 'aaaaaaaa-0000-0000-0000-000000000001'),
    );
    await accounts.attach(
      'claude',
      signedIn('a@example.com', 'aaaaaaaa-0000-0000-0000-000000000001'),
    );
    const snapshot = await accounts.attach(
      'claude',
      signedIn('b@example.com', 'bbbbbbbb-0000-0000-0000-000000000002'),
    );
    const attached = snapshot.providers
      .find((provider) => provider.id === 'claude')!
      .homes.filter((home) => home.kind === 'attached');
    const keys = attached.map((home) => home.accountKey);
    expect(keys[0]).not.toBeNull();
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    // The key is a hash, never the raw identity.
    expect(JSON.stringify(snapshot)).not.toContain('aaaaaaaa-0000');
    expect(attached[0]?.limits).toMatchObject({
      state: 'unknown',
      message: expect.stringMatching(/status line/),
    });
    const opencode = snapshot.providers.find((provider) => provider.id === 'opencode')!;
    expect(opencode.homes[0]?.limits).toMatchObject({
      state: 'unavailable',
      message: expect.stringMatching(/^Limits unavailable for this account/),
    });
  });

  it('keeps a failed Codex read out of the message and rate-limits repeat reads', async () => {
    let calls = 0;
    const { accounts, board } = setupWith(async () => {
      calls += 1;
      throw new Error('token sk-secret-123 rejected for user@example.com');
    });
    vi.spyOn(board, 'detectAgents').mockResolvedValue([
      { id: 'codex', available: true, path: '/usr/bin/codex' } as never,
    ]);
    const folder = tempFolder('codex-err-');
    writeFileSync(join(folder, 'auth.json'), '{}');
    await accounts.attach('codex', folder);
    const first = await accounts.snapshot(true);
    const afterFirst = calls;
    await accounts.snapshot(true);
    // Inside the minimum interval, no login is asked again.
    expect(afterFirst).toBeGreaterThan(0);
    expect(calls).toBe(afterFirst);
    const home = first.providers
      .find((provider) => provider.id === 'codex')!
      .homes.find((entry) => entry.kind === 'attached');
    expect(home?.limits.state).toBe('error');
    expect(JSON.stringify(first)).not.toMatch(/sk-secret|user@example/);
  });
});

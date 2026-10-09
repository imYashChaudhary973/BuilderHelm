import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { afterEach, describe, expect, it } from 'vitest';

import type { LoginLocation } from '../src/accounts/accounts-service.js';
import { PricingService } from '../src/usage/pricing.js';
import { UsageService } from '../src/usage/usage-service.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const databases: BuilderHelmDatabase[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function line(id: string, model: string, input: number, output: number): string {
  return `${JSON.stringify({
    type: 'assistant',
    requestId: `req-${id}`,
    sessionId: 'session-1',
    cwd: '/w/app',
    timestamp: new Date().toISOString(),
    message: {
      id,
      model,
      usage: { input_tokens: input, output_tokens: output, speed: 'standard' },
    },
  })}\n`;
}

function claudeHome(name: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), `usage-${name}-`));
  folders.push(root);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(root, 'projects', 'p'), { recursive: true });
    writeFileSync(join(root, 'projects', 'p', file), body);
  }
  return root;
}

function setup(
  logins: LoginLocation[],
  openCodeDataDir = join(tmpdir(), 'no-opencode-here'),
): {
  usage: UsageService;
  pricing: PricingService;
} {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const pricing = new PricingService(new SettingsRepository(database));
  const usage = new UsageService(
    database,
    { logins: () => logins },
    pricing,
    logger,
    openCodeDataDir,
  );
  return { usage, pricing };
}

const login = (root: string, identity: string | null, ref: string): LoginLocation => ({
  provider: 'claude',
  accountRef: ref,
  label: `${ref} label`,
  root,
  identity,
});

describe('UsageService', () => {
  it('counts one account once across two folders and keeps distinct accounts apart', async () => {
    const shared = line('m1', 'claude-opus-5-5', 1_000, 100);
    const a = claudeHome('a', { 's.jsonl': shared });
    // The same account attached through a second folder holding a copy.
    const aCopy = claudeHome('a2', { 's.jsonl': shared });
    const b = claudeHome('b', { 's.jsonl': line('m2', 'claude-opus-5-5', 500, 50) });
    const { usage } = setup([
      login(a, 'acct-a:org', 'claude:system'),
      login(aCopy, 'acct-a:org', 'claude:copy'),
      login(b, 'acct-b:org', 'claude:team'),
    ]);
    const report = await usage.report({ range: 'all', environment: null });
    expect(report.totals.tokens).toMatchObject({
      uncachedInput: 1_500,
      output: 150,
      records: 2,
    });
    expect(report.byAccount).toHaveLength(2);
    expect(report.totals.pricing).toBe('priced');
    expect(report.totals.cost.estimatedUsd).toBeCloseTo((1_500 * 4 + 150 * 20) / 1e6, 10);
  });

  it('reads only what was appended, and survives a rewritten file without doubling', async () => {
    const root = claudeHome('inc', { 's.jsonl': line('m1', 'claude-opus-5-5', 10, 1) });
    const { usage } = setup([login(root, 'acct', 'claude:system')]);
    await usage.report({ range: 'all', environment: null, rescan: true });
    const file = join(root, 'projects', 'p', 's.jsonl');
    appendFileSync(file, line('m2', 'claude-opus-5-5', 20, 2));
    // A half-written line is left for the next scan.
    appendFileSync(file, '{"type":"assistant","partial');
    let report = await usage.report({ range: 'all', environment: null, rescan: true });
    expect(report.totals.tokens.records).toBe(2);
    expect(
      report.sources.find((source) => source.kind === 'claude-transcript')?.skipped,
    ).toBe(0);
    // A tool that rewrites the file from scratch: same events, new inode.
    rmSync(file);
    writeFileSync(
      file,
      line('m1', 'claude-opus-5-5', 10, 1) + line('m2', 'claude-opus-5-5', 20, 2),
    );
    report = await usage.report({ range: 'all', environment: null, rescan: true });
    expect(report.totals.tokens.records).toBe(2);
  });

  it('shows unknown models as unpriced, and an override re-prices them', async () => {
    const root = claudeHome('price', {
      's.jsonl':
        line('m1', 'claude-opus-5-5', 1_000, 0) + line('m2', 'claude-next-9', 1_000, 0),
    });
    const { usage, pricing } = setup([login(root, 'acct', 'claude:system')]);
    let report = await usage.report({ range: 'all', environment: null });
    expect(report.totals.pricing).toBe('partial');
    expect(report.totals.cost.unpricedTokens).toBe(1_000);
    const unknown = report.byModel.find((row) => row.label === 'claude-next-9');
    expect(unknown).toMatchObject({ pricing: 'unpriced', cost: { estimatedUsd: null } });
    await pricing.update({
      action: 'set-override',
      model: 'claude-next-9',
      standard: {
        input: 1,
        cacheRead: 0.1,
        cacheWrite: 1.25,
        cacheWrite1h: 2,
        output: 5,
      },
      fast: null,
    });
    report = await usage.report({ range: 'all', environment: null });
    expect(report.totals.pricing).toBe('priced');
    expect(report.totals.cost.estimatedUsd).toBeCloseTo(
      (1_000 * 4 + 1_000 * 1) / 1e6,
      10,
    );
  });

  it('marks a vanished file missing and keeps its history', async () => {
    const root = claudeHome('gone', { 's.jsonl': line('m1', 'claude-opus-5-5', 10, 1) });
    const { usage } = setup([login(root, 'acct', 'claude:system')]);
    await usage.report({ range: 'all', environment: null, rescan: true });
    rmSync(join(root, 'projects'), { recursive: true });
    const report = await usage.report({ range: 'all', environment: null, rescan: true });
    expect(report.totals.tokens.records).toBe(1);
    expect(
      report.sources.find((source) => source.kind === 'claude-transcript')?.state,
    ).toBe('missing');
    expect(report.sources.find((source) => source.provider === 'grok')?.state).toBe(
      'unavailable',
    );
  });
});

it('reads OpenCode message models and days, replaces live counters, and preserves cursor ties', async () => {
  const root = mkdtempSync(join(tmpdir(), 'usage-oc-'));
  folders.push(root);
  const db = new DatabaseSync(join(root, 'opencode.db'));
  db.exec(
    `CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT, directory TEXT); CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, time_updated INTEGER, data TEXT); INSERT INTO session_v2 VALUES ('session', 'Two models', '/w/app');`,
  );
  const write = (
    id: string,
    model: string,
    input: number,
    created: number,
    updated: number,
  ) => {
    db.prepare('INSERT OR REPLACE INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      'session',
      'assistant',
      created,
      updated,
      JSON.stringify({
        model: { id: model },
        tokens: { input, output: 30, reasoning: 5, cache: { read: 10, write: 0 } },
        cost: 0.42,
        content: [{ text: 'This prompt never enters the usage ledger' }],
      }),
    );
  };
  write('m1', 'first-model', 100, Date.parse('2026-10-01T10:00:00Z'), 1000);
  write('m2', 'second-model', 200, Date.parse('2026-10-02T10:00:00Z'), 1000);
  const { usage } = setup(
    [
      {
        provider: 'opencode',
        accountRef: 'opencode:system',
        label: 'OpenCode',
        root,
        identity: null,
      },
    ],
    root,
  );
  try {
    let report = await usage.report({ range: 'all', environment: null, rescan: true });
    expect(report.totals.tokens.total).toBe(390);
    expect(report.byModel.map((row) => row.label)).toEqual([
      'second-model',
      'first-model',
    ]);
    expect(report.byDay).toHaveLength(2);
    expect(report.sources.find((source) => source.provider === 'opencode')?.state).toBe(
      'ok',
    );
    write('m1', 'first-model', 150, Date.parse('2026-10-01T10:00:00Z'), 1000);
    report = await usage.report({ range: 'all', environment: null, rescan: true });
    expect(report.totals.tokens.records).toBe(2);
    expect(report.totals.tokens.total).toBe(440);
    expect(report.totals.cost.reportedUsd).toBeCloseTo(0.84);
  } finally {
    db.close();
  }
});

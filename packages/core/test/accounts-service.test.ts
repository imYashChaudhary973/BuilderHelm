import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
  SwarmRepository,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { BuilderHelmError, createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountsService } from '../src/accounts/accounts-service.js';
import { BoardService } from '../src/board/board-service.js';

const databases: BuilderHelmDatabase[] = [];
const folders: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function setup(): AccountsService {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const swarm = new SwarmRepository(database);
  const runId = createCorrelationId();
  swarm.createRun(
    {
      id: runId,
      name: 'usage',
      folderPath: '/tmp',
      mission: 'report tokens',
      launchMode: 'auto',
      presetId: 'skiff',
      skillIds: [],
      boardSessionId: null,
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
      budgetMs: 60_000,
    },
    [
      {
        id: createCorrelationId(),
        runId,
        role: 'builder',
        agentId: 'claude',
        mode: 'auto',
        paneId: null,
        worktreePath: null,
        branch: null,
        status: 'idle',
        tokensUsed: 40,
        costUsd: 0.12,
      },
    ],
  );
  return new AccountsService(
    new SettingsRepository(database),
    swarm,
    new BoardService(database, logger),
    logger,
  );
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe('AccountsService', () => {
  it('surfaces Swarm-reported usage and isolated config roots', async () => {
    const accounts = setup();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'builderhelm-account-')));
    folders.push(root);
    const before = await accounts.snapshot();
    const claude = before.agents.find((agent) => agent.id === 'claude');
    expect(claude?.usage).toEqual({
      tokensUsed: 40,
      costUsd: 0.12,
      source: 'swarm',
      occurredAt: '2026-01-01T00:01:00.000Z',
    });
    expect(claude?.configDirEnv).toBe('CLAUDE_CONFIG_DIR');
    expect(claude?.configRoot).toBeNull();

    const after = await accounts.setRoot('claude', root, createCorrelationId());
    expect(after.agents.find((agent) => agent.id === 'claude')?.configRoot).toBe(root);
    expect(accounts.cliEnv()).toEqual({ CLAUDE_CONFIG_DIR: root });

    await accounts.setRoot('claude', null, createCorrelationId());
    expect(accounts.cliEnv()).toEqual({});
  });

  it('rejects unsupported CLIs and files that are not folders', async () => {
    const accounts = setup();
    await expect(
      accounts.setRoot('gemini', '/tmp', createCorrelationId()),
    ).rejects.toBeInstanceOf(BuilderHelmError);
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-account-file-'));
    folders.push(dir);
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'nope');
    await expect(
      accounts.setRoot('codex', file, createCorrelationId()),
    ).rejects.toBeInstanceOf(BuilderHelmError);
  });
});

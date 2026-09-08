import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations, openDatabase, runMigrations } from '@builderhelm/db';

import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceStore } from '../src/board/workspace-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'builderhelm-workspace-store-'));
  temporaryDirectories.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Fixture User'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'start fixture'], { cwd: repo });
  return repo;
}

function createStore(): WorkspaceStore {
  const database = openDatabase(':memory:');
  runMigrations(database, migrations);
  return new WorkspaceStore(database);
}

const input = (folderPath: string) => ({
  correlationId: '11111111-2222-4333-8444-555555555555',
  folderPath,
  paneCount: 1,
  isolation: 'worktree' as const,
  panes: [{ slot: 0, agentId: 'shell' as const }],
});

describe('WorkspaceStore', () => {
  it('rejects worktree isolation outside a Git repository instead of falling back', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'builderhelm-plain-folder-'));
    temporaryDirectories.push(plain);
    const store = createStore();

    await expect(store.begin(input(plain))).rejects.toThrow(
      'Isolated runs need a Git repository',
    );
  });

  it('rejects a missing folder instead of launching anywhere else', async () => {
    const store = createStore();
    const missing = join(tmpdir(), 'builderhelm-missing-folder-9f8e7d6c');

    await expect(store.begin(input(missing))).rejects.toThrow(
      'Choose an existing project folder.',
    );
  });

  it('records the base revision and durable intent for a Git project', async () => {
    const repo = createRepository();
    const store = createStore();

    const record = await store.begin(input(repo));
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

    expect(record.baseSha).toBe(head);
    expect(record.state).toBe('provisioning');
    expect(store.get(record.id).id).toBe(record.id);
  });

  it('marks running workspaces interrupted when the host restarts', async () => {
    const repo = createRepository();
    const store = createStore();
    const record = await store.begin(input(repo));
    store.finish(record.id, {
      sessionId: record.id,
      folderPath: repo,
      paneCount: 1,
      isolation: 'worktree',
      panes: [
        {
          paneId: '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c',
          slot: 0,
          agentId: 'shell',
          title: 'shell',
          status: 'running',
          branch: 'main',
          cwd: repo,
        },
      ],
    });

    expect(store.snapshot().records[0]?.state).toBe('running');
    store.reconcile();
    expect(store.snapshot().records[0]?.state).toBe('interrupted');
  });

  it('imports legacy metadata idempotently', async () => {
    const repo = createRepository();
    const store = createStore();
    const entries = [{ root: repo, label: 'Fixture Repo', color: '#7ec8e3' }];

    store.importLegacy(entries);
    store.importLegacy(entries);

    const metadata = store.snapshot().metadata;
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      root: repo,
      label: 'Fixture Repo',
      color: '#7ec8e3',
    });
  });

  it('restores drafts without overwriting a newer disk edit', async () => {
    const repo = createRepository();
    const store = createStore();
    const path = 'example.ts';
    writeFileSync(join(repo, path), 'disk v1\n');

    store.draft({ root: repo, path, text: 'draft v1\n', baseText: 'disk v1\n' });
    // The file changed on disk after the draft was written.
    writeFileSync(join(repo, path), 'disk v2\n');

    const drafts = store.drafts(repo);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ text: 'draft v1\n', baseText: 'disk v1\n' });
    // Rebased on the newer disk version, the draft survives with an updated base.
    store.saved(repo, path, 'disk v2\n');
    expect(store.drafts(repo)[0]).toMatchObject({
      text: 'draft v1\n',
      baseText: 'disk v2\n',
    });

    // Choosing the disk version makes the draft identical to its base: gone.
    store.draft({ root: repo, path, text: 'disk v2\n', baseText: 'disk v2\n' });
    expect(store.drafts(repo)).toHaveLength(0);
  });
  it('never persists a draft identical to its disk base', () => {
    const repo = createRepository();
    const store = createStore();

    store.draft({ root: repo, path: 'a.txt', text: 'same\n', baseText: 'same\n' });

    expect(store.drafts(repo)).toHaveLength(0);
  });
});

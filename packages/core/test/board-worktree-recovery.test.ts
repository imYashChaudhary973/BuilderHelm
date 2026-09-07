import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrations, openDatabase, runMigrations } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardService } from '../src/board/board-service.js';

const temporaryDirectories: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

function createRepository(): string {
  // The parent holds both the repo and its `-worktrees` sibling directory.
  const parent = mkdtempSync(join(tmpdir(), 'builderhelm-worktree-'));
  temporaryDirectories.push(parent);
  const root = join(parent, 'repo');
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Fixture User']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'start fixture']);
  return root;
}

function service(): BoardService {
  const database = openDatabase(':memory:');
  runMigrations(database, migrations);
  return new BoardService(database, logger);
}

const branches = (root: string): string[] =>
  git(root, ['branch', '--format=%(refname:short)'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

describe('pane worktree teardown', () => {
  it('removes the worktree and its branch when nothing was committed', async () => {
    const root = createRepository();
    const board = service();
    const correlationId = createCorrelationId();

    const created = await board.createWorktree(root, 'p1-abc123', correlationId);
    expect(existsSync(created.path)).toBe(true);
    expect(branches(root)).toContain('builderhelm/p1-abc123');

    await board.removePaneWorktree(root, created.path, created.branch, correlationId);

    expect(existsSync(created.path)).toBe(false);
    expect(branches(root)).not.toContain('builderhelm/p1-abc123');
  });

  it('keeps a branch that still holds unlanded commits', async () => {
    const root = createRepository();
    const board = service();
    const correlationId = createCorrelationId();

    const created = await board.createWorktree(root, 'p2-abc123', correlationId);
    // Work an agent committed but never landed.
    writeFileSync(join(created.path, 'agent.txt'), 'work\n');
    git(created.path, ['add', 'agent.txt']);
    git(created.path, ['commit', '-m', 'agent work']);

    await board.removePaneWorktree(root, created.path, created.branch, correlationId);

    // The directory is reclaimed, the commits are not thrown away.
    expect(existsSync(created.path)).toBe(false);
    expect(branches(root)).toContain('builderhelm/p2-abc123');
  });
});

describe('pane worktree recovery', () => {
  it('lists only worktrees BuilderHelm created', async () => {
    const root = createRepository();
    const board = service();
    const correlationId = createCorrelationId();

    const ours = await board.createWorktree(root, 'p1-abc123', correlationId);
    // A developer's own checkout, in the same parent directory.
    const theirs = join(root, '..', 'repo-worktrees', 'my-feature');
    git(root, ['worktree', 'add', '-b', 'feat/my-feature', theirs]);

    const listed = await board.listPaneWorktrees(root);
    // git reports resolved paths; the constructed path differs by a symlink.
    expect(listed.map((entry) => entry.path)).toEqual([realpathSync(ours.path)]);
    expect(listed[0]!.branch).toBe('builderhelm/p1-abc123');
  });

  it('reclaims clean strays and preserves dirty ones', async () => {
    const root = createRepository();
    const board = service();
    const correlationId = createCorrelationId();

    const clean = await board.createWorktree(root, 'p1-abc123', correlationId);
    const dirty = await board.createWorktree(root, 'p2-abc123', correlationId);
    const live = await board.createWorktree(root, 'p3-abc123', correlationId);
    // Uncommitted output from a crashed run: the only copy of that work.
    writeFileSync(join(dirty.path, 'scratch.txt'), 'unsaved\n');
    // Resolve before reconciling; the clean one stops existing.
    const cleanReal = realpathSync(clean.path);
    const dirtyReal = realpathSync(dirty.path);

    const result = await board.reconcilePaneWorktrees(root, [live.path], correlationId);

    expect(result.removed).toEqual([cleanReal]);
    expect(result.keptDirty).toEqual([dirtyReal]);
    expect(existsSync(clean.path)).toBe(false);
    expect(existsSync(dirty.path)).toBe(true);
    // Still owned by a live session, so it must survive untouched.
    expect(existsSync(live.path)).toBe(true);
    expect(branches(root)).toContain('main');
    // Reclaimed, so its branch went with it.
    expect(branches(root)).not.toContain('builderhelm/p1-abc123');
    // Kept because the work is uncommitted, and because it is still live.
    expect(branches(root)).toContain('builderhelm/p2-abc123');
    expect(branches(root)).toContain('builderhelm/p3-abc123');
  });

  it('leaves a repository with no pane worktrees alone', async () => {
    const root = createRepository();
    const board = service();
    const result = await board.reconcilePaneWorktrees(root, [], createCorrelationId());
    expect(result).toEqual({ removed: [], keptDirty: [] });
    expect(branches(root)).toEqual(['main']);
  });

  it('still lists pane worktrees on the retired exeum/ prefix', async () => {
    const root = createRepository();
    const board = service();
    const legacy = join(root, '..', 'repo-worktrees', 'legacy-pane');
    git(root, ['worktree', 'add', '-b', 'exeum/p1-legacy', legacy]);

    const listed = await board.listPaneWorktrees(root);
    expect(listed.map((entry) => entry.branch)).toEqual(['exeum/p1-legacy']);
  });
});

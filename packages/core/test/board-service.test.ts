import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { migrations, openDatabase, runMigrations } from '@zero/db';
import type { Logger } from '@zero/observability';
import { createCorrelationId } from '@zero/shared';
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

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'zero-board-git-'));
  temporaryDirectories.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'start fixture'], { cwd: root });
  return root;
}

describe('BoardService worktrees', () => {
  it('creates an isolated branch and reports it', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);

    const worktree = await service.createWorktree(repo, 'p1-test', createCorrelationId());

    expect(worktree.branch).toBe('exeum/p1-test');
    expect(basename(worktree.path)).toBe('p1-test');
    expect(await service.readBranch(worktree.path)).toBe('exeum/p1-test');
    expect(await service.readBranch(repo)).toBe('main');
    database.close();
  });
});

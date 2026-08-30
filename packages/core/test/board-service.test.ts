import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'builderhelm-board-git-'));
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

  it('merges a non-overlapping pane branch into main', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const worktree = await service.createWorktree(repo, 'p1-test', createCorrelationId());
    writeFileSync(join(worktree.path, 'extra.md'), 'from pane\n');
    execFileSync('git', ['add', 'extra.md'], { cwd: worktree.path });
    execFileSync('git', ['commit', '-m', 'pane work'], { cwd: worktree.path });

    const result = await service.landBranch(repo, worktree.branch, createCorrelationId());

    expect(result.landed).toBe(true);
    expect(result.head.length).toBeGreaterThanOrEqual(7);
    expect(readFileSync(join(repo, 'extra.md'), 'utf8')).toBe('from pane\n');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    database.close();
  });

  it('refuses land when the reviewed head moved', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const worktree = await service.createWorktree(repo, 'p1-test', createCorrelationId());
    writeFileSync(join(worktree.path, 'extra.md'), 'from pane\n');
    execFileSync('git', ['add', 'extra.md'], { cwd: worktree.path });
    execFileSync('git', ['commit', '-m', 'pane work'], { cwd: worktree.path });
    await expect(
      service.landBranch(repo, worktree.branch, createCorrelationId(), 'a'.repeat(40)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(existsSync(join(repo, 'extra.md'))).toBe(false);
    database.close();
  });

  it('previews a pane branch without merging', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const worktree = await service.createWorktree(repo, 'p1-test', createCorrelationId());
    writeFileSync(join(worktree.path, 'extra.md'), 'from pane\n');
    execFileSync('git', ['add', 'extra.md'], { cwd: worktree.path });
    execFileSync('git', ['commit', '-m', 'pane work'], { cwd: worktree.path });

    const preview = await service.previewLand(
      repo,
      worktree.branch,
      createCorrelationId(),
    );

    expect(preview.ahead).toBe(1);
    expect(preview.files).toEqual(['extra.md']);
    expect(preview.stat).toContain('extra.md');
    expect(existsSync(join(repo, 'extra.md'))).toBe(false);
    database.close();
  });

  it('aborts a conflicting land and leaves main clean', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const worktree = await service.createWorktree(repo, 'p1-test', createCorrelationId());
    writeFileSync(join(worktree.path, 'README.md'), 'pane\n');
    execFileSync('git', ['add', 'README.md'], { cwd: worktree.path });
    execFileSync('git', ['commit', '-m', 'pane readme'], { cwd: worktree.path });
    writeFileSync(join(repo, 'README.md'), 'mainline\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'main readme'], { cwd: repo });

    await expect(
      service.landBranch(repo, worktree.branch, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('mainline\n');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    database.close();
  });

  it('rejects branches that are not exeum pane branches', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    await expect(
      service.landBranch(repo, 'main', createCorrelationId()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    database.close();
  });
});

describe('BoardService ensureRepository', () => {
  it('initializes a plain folder with an empty commit', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'builderhelm-board-plain-'));
    temporaryDirectories.push(folder);
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);

    const first = await service.ensureRepository(folder);
    const second = await service.ensureRepository(folder);

    expect(first.initialized).toBe(true);
    expect(first.branch.length).toBeGreaterThan(0);
    expect(second.initialized).toBe(false);
    expect(second.branch).toBe(first.branch);
    const worktree = await service.createWorktree(
      folder,
      'p1-plain',
      createCorrelationId(),
    );
    expect(worktree.branch).toBe('exeum/p1-plain');
    database.close();
  });

  it('leaves an existing repository untouched', async () => {
    const repo = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);

    const result = await service.ensureRepository(repo);

    expect(result).toEqual({ initialized: false, branch: 'main' });
    database.close();
  });
});

describe('BoardService kanban', () => {
  it('keeps project boards and their tasks isolated', () => {
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const correlationId = createCorrelationId();
    const builderHelm = service.createProject('BuilderHelm', correlationId);
    const zenVoice = service.createProject('ZenVoice', correlationId);
    const builderTask = service.createCard(
      builderHelm.id,
      'Ship multi-project boards',
      correlationId,
    );
    service.createCard(zenVoice.id, 'Refine voice capture', correlationId);

    expect(service.listCards(builderHelm.id).map((card) => card.title)).toEqual([
      'Ship multi-project boards',
    ]);
    expect(service.listCards(zenVoice.id).map((card) => card.title)).toEqual([
      'Refine voice capture',
    ]);
    expect(service.moveCard(builderTask.id, 'review', correlationId).column).toBe(
      'review',
    );
    expect(service.moveCard(builderTask.id, 'cancelled', correlationId).column).toBe(
      'cancelled',
    );
    expect(service.listCards(zenVoice.id)[0]?.column).toBe('idea');
    expect(
      service
        .listProjects()
        .map((project) => ({ name: project.name, taskCount: project.taskCount }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      { name: 'BuilderHelm', taskCount: 1 },
      { name: 'ZenVoice', taskCount: 1 },
    ]);
    const reviewCard = service.createCard(
      builderHelm.id,
      'Review this',
      correlationId,
      'review',
    );
    expect(reviewCard.column).toBe('review');
    expect(service.updateCard(reviewCard.id, 'Reviewed this', correlationId).title).toBe(
      'Reviewed this',
    );
    expect(service.deleteCard(reviewCard.id, correlationId)).toEqual({ deleted: true });
    expect(service.listCards(builderHelm.id).map((card) => card.title)).toEqual([
      'Ship multi-project boards',
    ]);
    expect(() => service.updateCard(reviewCard.id, 'Gone', correlationId)).toThrow(
      'gone',
    );
    expect(() => service.createProject('zenvoice', correlationId)).toThrow(
      'already exists',
    );
    database.close();
  });
});

describe('BoardService agent detection', () => {
  it('probes every catalogued command in a single login shell', async () => {
    const root = mkdtempSync(join(tmpdir(), 'builderhelm-detect-'));
    temporaryDirectories.push(root);
    const invocations = join(root, 'invocations');
    const shell = join(root, 'fake-shell');
    // Records each invocation, then answers for the names it was handed. Args
    // arrive as: -lc <script> <argv0> <command...>, so three are dropped.
    writeFileSync(
      shell,
      [
        '#!/bin/sh',
        `echo invoked >> ${invocations}`,
        'shift 3',
        'for name in "$@"; do',
        '  case "$name" in',
        '    claude) printf \'%s\\t/usr/local/bin/claude\\n\' "$name" ;;',
        '    codex) printf \'%s\\t/opt/homebrew/bin/codex\\n\' "$name" ;;',
        '    *) printf \'%s\\t\\n\' "$name" ;;',
        '  esac',
        'done',
      ].join('\n'),
      { mode: 0o755 },
    );

    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const previousShell = process.env.SHELL;
    process.env.SHELL = shell;
    let detections;
    try {
      detections = await service.detectAgents();
    } finally {
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
    }

    // The point of the change: twelve catalogued commands, one login shell.
    expect(readFileSync(invocations, 'utf8').trim().split('\n')).toHaveLength(1);

    const byId = new Map(detections.map((entry) => [entry.id, entry]));
    expect(byId.get('claude')).toMatchObject({
      available: true,
      path: '/usr/local/bin/claude',
      capabilities: {
        headless: true,
        structuredOutput: 'json-schema',
        swarmModes: ['safe', 'auto', 'full'],
      },
    });
    expect(byId.get('codex')).toMatchObject({
      available: true,
      path: '/opt/homebrew/bin/codex',
    });
    expect(byId.get('grok')).toMatchObject({ available: false, path: null });
    // Terminal and custom panes need no binary on PATH.
    expect(byId.get('shell')).toMatchObject({ available: true, path: null });
    expect(byId.get('custom')).toMatchObject({ available: true, path: null });
    database.close();
  });

  it('reports nothing available when the probe shell fails', async () => {
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new BoardService(database, logger);
    const previousShell = process.env.SHELL;
    process.env.SHELL = join(tmpdir(), 'builderhelm-missing-shell');
    try {
      const detections = await service.detectAgents();
      expect(
        detections.filter((entry) => entry.available).map((entry) => entry.id),
      ).toEqual(['shell', 'custom']);
    } finally {
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
    }
    database.close();
  });
});

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ActionRepository,
  migrations,
  openDatabase,
  ProjectRepositoryStore,
  runMigrations,
} from '@zero/db';
import { createLogger } from '@zero/observability';
import { projectRunTestsResultSchema } from '@zero/protocol/actions';
import { createCorrelationId, createId } from '@zero/shared';
import { createWorkToolRegistry, PermissionEngine } from '@zero/tools';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionService } from '../src/actions/action-service.js';
import { BoardService } from '../src/board/board-service.js';
import type { ModelService } from '../src/models/model-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryDirectories: string[] = [];
const logger = createLogger(() => {});

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function copyCodingBugFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'zero-coding-loop-'));
  temporaryDirectories.push(root);
  cpSync(
    fileURLToPath(new URL('../../../tests/fixtures/coding-bug', import.meta.url)),
    root,
    { recursive: true },
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'coding-bug fixture'], { cwd: root });
  return realpathSync.native(root);
}

describe('phase 6 coding loop', () => {
  it('fails the fixture, shows the fix diff, lands it, then passes', async () => {
    const root = copyCodingBugFixture();
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const actions = new ActionRepository(database);
    const projectRepositories = new ProjectRepositoryStore(database);
    const service = new ActionService(
      actions,
      { async *stream() {} } as unknown as ModelService,
      logger,
      createWorkToolRegistry(),
      new PermissionEngine(),
      projectRepositories,
    );
    const board = new BoardService(database, logger);

    const created = await service.command(
      { requestId: createId(), text: 'Create project Coding Bug', modelRef: null },
      createCorrelationId(),
      new AbortController().signal,
    );
    if (created.kind !== 'approval_required') throw new Error('Expected project approval');
    await service.approve(created.approval.id, createCorrelationId());
    const project = actions.listProjects()[0]!;
    const now = '2026-08-24T00:00:00.000Z';
    projectRepositories.replaceSnapshot(
      {
        id: createId(),
        projectId: project.id,
        rootPath: root,
        directoryName: 'coding-bug',
        branch: 'main',
        headSha: '0'.repeat(40),
        dirtyCount: 0,
        aheadCount: 0,
        behindCount: 0,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      [],
    );

    const failing = await service.command(
      { requestId: createId(), text: 'run tests for Coding Bug', modelRef: null },
      createCorrelationId(),
      new AbortController().signal,
    );
    if (failing.kind !== 'approval_required') throw new Error('Expected test approval');
    const failed = await service.approve(failing.approval.id, createCorrelationId());
    if (failed.kind !== 'executed') throw new Error('Expected executed');
    expect(projectRunTestsResultSchema.parse(failed.receipt.result).passed).toBe(false);

    const worktree = await board.createWorktree(root, 'fix-add', createCorrelationId());
    writeFileSync(join(worktree.path, 'src/add.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
    execFileSync('git', ['add', 'src/add.js'], { cwd: worktree.path });
    execFileSync('git', ['commit', '-m', 'fix add'], { cwd: worktree.path });

    const preview = await board.previewLand(root, worktree.branch, createCorrelationId());
    expect(preview.files).toContain('src/add.js');
    expect(preview.diff).toContain('return a + b');
    expect(preview.diff).toContain('-  return a - b');

    await board.landBranch(root, worktree.branch, createCorrelationId());

    const passing = await service.command(
      { requestId: createId(), text: 'run tests for Coding Bug', modelRef: null },
      createCorrelationId(),
      new AbortController().signal,
    );
    if (passing.kind !== 'approval_required') throw new Error('Expected test approval');
    const passed = await service.approve(passing.approval.id, createCorrelationId());
    if (passed.kind !== 'executed') throw new Error('Expected executed');
    expect(projectRunTestsResultSchema.parse(passed.receipt.result).passed).toBe(true);
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WebContents } from 'electron';

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

import { BoardPtyManager } from '../src/main/board-pty-manager.js';

const temporaryDirectories: string[] = [];
const correlationId = '11111111-2222-4333-8444-555555555555';

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

function createRepository(): string {
  const parent = mkdtempSync(join(tmpdir(), 'builderhelm-rollback-'));
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

const branches = (root: string): string[] =>
  git(root, ['branch', '--format=%(refname:short)'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const worktreeCount = (root: string): number =>
  git(root, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree ')).length;

const sender = {
  isDestroyed: () => false,
  send: () => undefined,
} as unknown as WebContents;

describe('failed session creation preserves provisioned worktrees', () => {
  it('stops spawned panes but retains every checkout when a later pane fails', async () => {
    const root = createRepository();
    const manager = new BoardPtyManager();
    const worktrees = join(root, '..', 'repo-worktrees');
    mkdirSync(worktrees, { recursive: true });

    let slotsLocated = 0;
    await expect(
      manager.createSession(
        {
          correlationId,
          folderPath: root,
          isolation: 'worktree',
          paneCount: 3,
          panes: [
            { slot: 0, agentId: 'shell' },
            { slot: 1, agentId: 'shell' },
            { slot: 2, agentId: 'shell' },
          ],
        },
        async (slot) => {
          if (slot === 2) throw new Error('worktree creation failed');
          slotsLocated += 1;
          const label = `p${slot + 1}-rollback`;
          const path = join(worktrees, label);
          git(root, ['worktree', 'add', '-b', `builderhelm/${label}`, path]);
          return { cwd: path, branch: `builderhelm/${label}` };
        },
        sender,
        '11111111-2222-4333-8444-555555555556',
      ),
    ).rejects.toThrow('worktree creation failed');

    expect(slotsLocated).toBe(2);
    expect(existsSync(join(worktrees, 'p1-rollback'))).toBe(true);
    expect(existsSync(join(worktrees, 'p2-rollback'))).toBe(true);
    expect(worktreeCount(root)).toBe(3);
    expect(manager.hasSession('11111111-2222-4333-8444-555555555556')).toBe(false);

    manager.dispose();
  });

  it('keeps a worktree whose branch holds unlanded commits', async () => {
    const root = createRepository();
    const manager = new BoardPtyManager();
    const worktrees = join(root, '..', 'repo-worktrees');
    mkdirSync(worktrees, { recursive: true });

    await expect(
      manager.createSession(
        {
          correlationId,
          folderPath: root,
          isolation: 'worktree',
          paneCount: 2,
          panes: [
            { slot: 0, agentId: 'shell' },
            { slot: 1, agentId: 'shell' },
          ],
        },
        async (slot) => {
          if (slot === 1) throw new Error('worktree creation failed');
          const label = 'p1-committed';
          const path = join(worktrees, label);
          git(root, ['worktree', 'add', '-b', `builderhelm/${label}`, path]);
          writeFileSync(join(path, 'agent.txt'), 'work\n');
          git(path, ['add', 'agent.txt']);
          git(path, ['commit', '-m', 'agent work']);
          return { cwd: path, branch: `builderhelm/${label}` };
        },
        sender,
        '11111111-2222-4333-8444-555555555557',
      ),
    ).rejects.toThrow('worktree creation failed');

    expect(existsSync(join(worktrees, 'p1-committed'))).toBe(true);
    expect(branches(root)).toContain('builderhelm/p1-committed');
    expect(manager.hasSession('11111111-2222-4333-8444-555555555557')).toBe(false);

    manager.dispose();
  });
});

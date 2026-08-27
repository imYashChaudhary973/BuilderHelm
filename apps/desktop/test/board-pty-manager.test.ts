import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCorrelationId } from '@zero/shared';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnControl = vi.hoisted(() => ({
  count: 0,
  failWhen: () => false,
  startedAt: [] as number[],
  pids: [] as number[],
  reset() {
    this.count = 0;
    this.failWhen = () => false;
    this.startedAt = [];
    this.pids = [];
  },
}));

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return false;
    }
    show() {}
  },
}));

vi.mock('node-pty', async () => {
  const actual = (await vi.importActual('node-pty')) as {
    spawn: (
      file: string,
      args: string[],
      options: object,
    ) => { pid: number; kill: () => void };
  };
  return {
    spawn(file: string, args: string[], options: object) {
      spawnControl.count += 1;
      spawnControl.startedAt.push(Date.now());
      if (spawnControl.failWhen(spawnControl.count)) {
        throw new Error(`forced spawn failure ${String(spawnControl.count)}`);
      }
      const pty = actual.spawn(file, args, options);
      spawnControl.pids.push(pty.pid);
      return pty;
    },
  };
});

import { BoardPtyManager } from '../src/main/board-pty-manager.js';

const sender = { isDestroyed: () => true, send() {} } as unknown as WebContents;
const sleepArgv = { binary: '/bin/sleep', args: ['60'] };

describe('BoardPtyManager.createSession launch', () => {
  let folder: string;
  let manager: BoardPtyManager;

  beforeEach(() => {
    spawnControl.reset();
    folder = mkdtempSync(join(tmpdir(), 'zero-board-pty-'));
    manager = new BoardPtyManager();
  });

  afterEach(() => {
    manager.dispose();
    for (const pid of spawnControl.pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    rmSync(folder, { recursive: true, force: true });
  });

  function input(paneCount: 3 | 12) {
    return {
      correlationId: createCorrelationId(),
      folderPath: folder,
      paneCount,
      isolation: 'shared' as const,
      panes: Array.from({ length: paneCount }, (_, slot) => ({
        slot,
        agentId: 'shell' as const,
        argv: sleepArgv,
      })),
    };
  }

  it('locates serially then spawns, preserving slot order', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const locateStarted: number[] = [];
    const locateFinishedAt: number[] = [];
    const summary = await manager.createSession(
      input(3),
      async (slot) => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        locateStarted.push(slot);
        await Promise.resolve();
        inflight -= 1;
        locateFinishedAt.push(Date.now());
        return { cwd: folder, branch: null };
      },
      sender,
    );
    expect(maxInflight).toBe(1);
    expect(locateStarted).toEqual([0, 1, 2]);
    expect(summary.panes.map((pane) => pane.slot)).toEqual([0, 1, 2]);
    expect(Math.min(...spawnControl.startedAt)).toBeGreaterThanOrEqual(
      Math.max(...locateFinishedAt),
    );
  });

  it('kills every spawned pane when one spawn fails', async () => {
    spawnControl.failWhen = (n) => n === 2;
    await expect(
      manager.createSession(
        input(3),
        async () => ({ cwd: folder, branch: null }),
        sender,
      ),
    ).rejects.toThrow(/forced spawn failure 2/);
    // Real PTYs: kill() is async in the kernel; fake timers cannot reap PIDs.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && spawnControl.pids.some(alive)) {
      await Promise.resolve();
    }
    expect(spawnControl.pids.filter(alive), 'leaked child processes').toEqual([]);
    await expect(
      manager.addPane('missing', 'shell', undefined, undefined, async () => ({
        cwd: folder,
        branch: null,
      })),
    ).rejects.toThrow(/Unknown pane session/);
  });

  it('kills nothing and retains no session when every spawn fails', async () => {
    spawnControl.failWhen = () => true;
    await expect(
      manager.createSession(
        input(3),
        async () => ({ cwd: folder, branch: null }),
        sender,
      ),
    ).rejects.toThrow(/forced spawn failure/);
    expect(spawnControl.pids).toEqual([]);
    await expect(
      manager.addPane('missing', 'shell', undefined, undefined, async () => ({
        cwd: folder,
        branch: null,
      })),
    ).rejects.toThrow(/Unknown pane session/);
  });

  it('opens 12 panes in under 3s', async () => {
    const started = Date.now();
    const summary = await manager.createSession(
      input(12),
      async () => ({ cwd: folder, branch: null }),
      sender,
    );
    expect(summary.paneCount).toBe(12);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

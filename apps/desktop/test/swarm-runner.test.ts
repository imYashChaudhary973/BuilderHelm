import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCorrelationId } from '@zero/shared';

import type { SwarmExecuteInput } from '@zero/core';
import { SWARM_NUDGE } from '@zero/protocol';

import type { BoardPaneCloseInput, BoardPaneSummary } from '@zero/protocol';
import type { WebContents } from 'electron';

import { BoardPtyManager } from '../src/main/board-pty-manager.js';
import { PtySwarmRunner } from '../src/main/swarm-runner.js';

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return false;
    }
    show() {}
  },
}));

const runId = '11111111-1111-4111-8111-111111111111';
const seatId = '22222222-2222-4222-8222-222222222222';
const paneId = '33333333-3333-4333-8333-333333333333';

function executeInput(): SwarmExecuteInput {
  return {
    run: { id: runId } as SwarmExecuteInput['run'],
    seat: {
      id: seatId,
      agentId: 'claude',
      mode: 'auto',
    } as SwarmExecuteInput['seat'],
    task: { id: '44444444-4444-4444-8444-444444444444' } as SwarmExecuteInput['task'],
    worktreePath: '/tmp/swarm-seat',
    branch: 'exeum/swarm-test',
    directives: [],
    prompt: 'implement the task',
  };
}

function fakeManager(): BoardPtyManager & {
  readonly closed: string[];
  readonly writes: string[];
  readonly started: Promise<void>;
  lastSeen: number;
} {
  const closed: string[] = [];
  const writes: string[] = [];
  const started = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<{ exitCode: number; output: string }>();
  const manager = {
    closed,
    writes,
    started: started.promise,
    lastSeen: Date.now(),
    createEmptySession() {
      return '11111111-1111-4111-8111-111111111110';
    },
    async addPane(): Promise<BoardPaneSummary> {
      return {
        paneId,
        slot: 0,
        agentId: 'claude',
        title: 'claude',
        status: 'running',
        branch: 'exeum/swarm-test',
        cwd: '/tmp/swarm-seat',
      };
    },
    async closePane(input: BoardPaneCloseInput): Promise<void> {
      closed.push(input.paneId);
      exit.resolve({ exitCode: 1, output: '' });
    },
    waitForPaneExit(): Promise<{ exitCode: number; output: string }> {
      started.resolve();
      return exit.promise;
    },
    lastDataAt(): number {
      return manager.lastSeen;
    },
    async write(input: { data: string }): Promise<void> {
      writes.push(input.data);
    },
  };
  return manager as unknown as BoardPtyManager & {
    readonly closed: string[];
    readonly writes: string[];
    readonly started: Promise<void>;
    lastSeen: number;
  };
}
describe('PtySwarmRunner stop', () => {
  it('kills every seat pane on release', async () => {
    const manager = fakeManager();
    const runner = new PtySwarmRunner(manager);
    runner.openSession(runId, '/tmp', 'worktree', {} as WebContents);
    const panes: string[] = [];
    const executing = runner.execute({
      ...executeInput(),
      onPane: (id) => panes.push(id),
    });
    await manager.started;
    expect(panes).toEqual([paneId]);
    await runner.release(runId);
    const outcome = await executing;
    expect(manager.closed).toEqual([paneId]);
    expect(outcome.status).toBe('failed');
  });
  it('kills one seat pane on stopSeat', async () => {
    const manager = fakeManager();
    const runner = new PtySwarmRunner(manager);
    runner.openSession(runId, '/tmp', 'worktree', {} as WebContents);
    const executing = runner.execute(executeInput());
    await manager.started;
    await runner.stopSeat(seatId);
    const outcome = await executing;
    expect(manager.closed).toEqual([paneId]);
    expect(outcome.status).toBe('failed');
  });
});

describe('PtySwarmRunner silence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('nudges a silent seat then stops it', async () => {
    vi.useFakeTimers();
    const manager = fakeManager();
    manager.lastSeen = Date.now() - 200_000;
    const runner = new PtySwarmRunner(manager);
    runner.openSession(runId, '/tmp', 'worktree', {} as WebContents);
    const executing = runner.execute(executeInput());
    await manager.started;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.writes.some((item) => item.includes(SWARM_NUDGE))).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    const outcome = await executing;
    expect(manager.closed).toEqual([paneId]);
    expect(outcome.status).toBe('failed');
  });
});

describe('BoardPtyManager closePane', () => {
  it('resolves waitForPaneExit when closePane is called even if onExit is silent', async () => {
    const manager = new BoardPtyManager();
    const sessionId = manager.createEmptySession('/tmp', 'shared', {
      isDestroyed: () => true,
    } as WebContents);
    // Test seam: private session map is the only way to attach a silent pty.
    const internals: {
      sessions: Map<string, { panes: Map<string, object> }>;
    } = manager as never;
    internals.sessions.get(sessionId)!.panes.set(paneId, {
      slot: 0,
      agentId: 'claude',
      title: 'silent',
      status: 'running',
      branch: null,
      cwd: '/tmp',
      output: 'partial',
      lastDataAt: Date.now(),
      acked: new Set(),
      pty: { kill() {} },
    });
    const waiting = manager.waitForPaneExit(sessionId, paneId);
    await manager.closePane({
      correlationId: createCorrelationId(),
      sessionId,
      paneId,
    });
    await expect(waiting).resolves.toEqual({ exitCode: 1, output: 'partial' });
  });

  it('does not throw when the pane is already gone', async () => {
    const manager = new BoardPtyManager();
    await expect(
      manager.closePane({
        correlationId: createCorrelationId(),
        sessionId: '11111111-1111-4111-8111-111111111110',
        paneId,
      }),
    ).resolves.toBeUndefined();
  });
});

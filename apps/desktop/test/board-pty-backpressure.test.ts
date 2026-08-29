import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardPaneEventEnvelope } from '@builderhelm/protocol';
import type { WebContents } from 'electron';

const ptyMock = vi.hoisted(() => {
  let data: ((chunk: string) => void) | undefined;
  const pause = vi.fn();
  const resume = vi.fn();
  return {
    pause,
    resume,
    emit(chunk: string) {
      data?.(chunk);
    },
    reset() {
      data = undefined;
      pause.mockClear();
      resume.mockClear();
    },
    pty: {
      pid: 4321,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause,
      resume,
      onData(callback: (chunk: string) => void) {
        data = callback;
      },
      onExit() {},
    },
  };
});

vi.mock('node-pty', () => ({ spawn: () => ptyMock.pty }));
vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

import { BoardPtyManager } from '../src/main/board-pty-manager.js';

const correlationId = '11111111-2222-4333-8444-555555555555';
const HIGH_WATER = 2 * 1024 * 1024;

async function openPane(events: BoardPaneEventEnvelope[]) {
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, payload: BoardPaneEventEnvelope) => events.push(payload),
  } as unknown as WebContents;
  const manager = new BoardPtyManager();
  const session = await manager.createSession(
    {
      correlationId,
      folderPath: process.cwd(),
      isolation: 'shared',
      paneCount: 1,
      panes: [{ slot: 0, agentId: 'shell' }],
    },
    () => Promise.resolve({ cwd: process.cwd(), branch: null }),
    sender,
  );
  return { manager, sessionId: session.sessionId, paneId: session.panes[0]!.paneId };
}

describe('pane backpressure', () => {
  afterEach(() => {
    vi.useRealTimers();
    ptyMock.reset();
  });

  it('leaves a renderer that never acknowledges unthrottled', async () => {
    vi.useFakeTimers();
    const events: BoardPaneEventEnvelope[] = [];
    const { manager } = await openPane(events);

    // Far past the high-water mark, with no ack ever reported.
    for (let i = 0; i < 4; i += 1) {
      ptyMock.emit('x'.repeat(HIGH_WATER));
      await vi.advanceTimersByTimeAsync(10);
    }

    // Throughput benchmarks and headless probes consume nothing and must not
    // deadlock, so pressure only applies to a renderer that reports progress.
    expect(ptyMock.pause).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('pauses the pty once an acknowledging renderer falls behind', async () => {
    vi.useFakeTimers();
    const events: BoardPaneEventEnvelope[] = [];
    const { manager, sessionId, paneId } = await openPane(events);

    // Establish that this renderer acknowledges at all.
    ptyMock.emit('hello');
    await vi.advanceTimersByTimeAsync(10);
    manager.ackPane({ correlationId, sessionId, paneId, offset: 5 });
    expect(ptyMock.pause).not.toHaveBeenCalled();

    // Now outrun it.
    ptyMock.emit('y'.repeat(HIGH_WATER));
    await vi.advanceTimersByTimeAsync(10);
    expect(ptyMock.pause).toHaveBeenCalledTimes(1);

    // Still behind: no premature resume.
    manager.ackPane({ correlationId, sessionId, paneId, offset: 5 + 1024 });
    expect(ptyMock.resume).not.toHaveBeenCalled();

    // Caught up past the low-water mark.
    manager.ackPane({ correlationId, sessionId, paneId, offset: 5 + HIGH_WATER });
    expect(ptyMock.resume).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('ignores a stale or over-reaching acknowledgement', async () => {
    vi.useFakeTimers();
    const events: BoardPaneEventEnvelope[] = [];
    const { manager, sessionId, paneId } = await openPane(events);

    ptyMock.emit('hello');
    await vi.advanceTimersByTimeAsync(10);
    // Claiming more than was ever sent must not create negative in-flight, and
    // going backwards must not undo progress.
    manager.ackPane({ correlationId, sessionId, paneId, offset: 10_000_000 });
    manager.ackPane({ correlationId, sessionId, paneId, offset: 1 });

    ptyMock.emit('y'.repeat(HIGH_WATER));
    await vi.advanceTimersByTimeAsync(10);
    // In-flight is measured from what was actually sent, so this still trips.
    expect(ptyMock.pause).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
});

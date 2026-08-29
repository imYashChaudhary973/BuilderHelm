import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardPaneEventEnvelope } from '@builderhelm/protocol';
import type { WebContents } from 'electron';

const ptyMock = vi.hoisted(() => {
  let data: ((chunk: string) => void) | undefined;
  let exit: ((event: { exitCode: number }) => void) | undefined;
  return {
    emitData(chunk: string) {
      data?.(chunk);
    },
    emitExit(exitCode: number) {
      exit?.({ exitCode });
    },
    reset() {
      data = undefined;
      exit = undefined;
    },
    pty: {
      pid: 123,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData(callback: (chunk: string) => void) {
        data = callback;
      },
      onExit(callback: (event: { exitCode: number }) => void) {
        exit = callback;
      },
    },
  };
});

vi.mock('node-pty', () => ({
  spawn: () => ptyMock.pty,
}));

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

import { BoardPtyManager } from '../src/main/board-pty-manager.js';

const correlationId = '11111111-2222-4333-8444-555555555555';

describe('BoardPtyManager output batching', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    ptyMock.reset();
  });

  it('coalesces data and flushes it before the exit status', async () => {
    vi.useFakeTimers();
    const events: BoardPaneEventEnvelope[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, payload: BoardPaneEventEnvelope) => events.push(payload),
    };
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
      sender as unknown as WebContents,
    );

    ptyMock.emitData('one');
    ptyMock.emitData('-two');
    expect(events).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(8);
    expect(events).toHaveLength(1);
    expect(Buffer.from(events[0]!.event.data, 'base64').toString('utf8')).toBe('one-two');

    ptyMock.emitData('-final');
    ptyMock.emitExit(0);
    expect(events.map(({ event }) => event.type)).toEqual(['data', 'data', 'status']);
    expect(Buffer.from(events[1]!.event.data, 'base64').toString('utf8')).toBe('-final');
    expect(events[2]!.event).toMatchObject({ status: 'exited', exitCode: 0 });

    manager.dispose();
    expect(session.panes).toHaveLength(1);
  });
});

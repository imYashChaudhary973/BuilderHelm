import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WebContents } from 'electron';

const ptyMock = vi.hoisted(() => ({
  pty: {
    pid: 321,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData() {},
    onExit() {},
  },
}));

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

const sender = {
  isDestroyed: () => false,
  send: () => undefined,
} as unknown as WebContents;

async function openClaudePane(
  manager: BoardPtyManager,
): Promise<{ sessionId: string; paneId: string }> {
  const session = await manager.createSession(
    {
      correlationId,
      folderPath: process.cwd(),
      paneCount: 1,
      isolation: 'shared',
      panes: [{ slot: 0, agentId: 'claude', command: 'claude' }],
    },
    () => Promise.resolve({ cwd: process.cwd(), branch: null }),
    sender,
  );
  return { sessionId: session.sessionId, paneId: session.panes[0]!.paneId };
}

/**
 * An agent that starts before the renderer has fitted the pane paints its
 * banner at the spawn size, takes SIGWINCH, and paints it again: Claude Code
 * re-emits its static header instead of rewriting it, so both copies stay in
 * the scrollback at two different widths.
 */
describe('BoardPtyManager agent launch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('waits for the pane size to settle before typing the command', async () => {
    vi.useFakeTimers();
    const manager = new BoardPtyManager();
    const { sessionId, paneId } = await openClaudePane(manager);

    expect(ptyMock.pty.write, 'nothing may run at the spawn size').not.toHaveBeenCalled();

    await manager.resize({ correlationId, sessionId, paneId, cols: 46, rows: 20 });
    await vi.advanceTimersByTimeAsync(120);
    expect(
      ptyMock.pty.write,
      'a fit still in flight must not launch',
    ).not.toHaveBeenCalled();

    await manager.resize({ correlationId, sessionId, paneId, cols: 150, rows: 40 });
    await vi.advanceTimersByTimeAsync(180);
    expect(ptyMock.pty.write.mock.calls).toEqual([['claude\r']]);

    // The spawn-time fallback must not fire a second launch afterwards.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ptyMock.pty.write.mock.calls).toEqual([['claude\r']]);
    manager.dispose();
  });

  it('still launches for a consumer that never resizes', async () => {
    vi.useFakeTimers();
    const manager = new BoardPtyManager();
    await openClaudePane(manager);

    await vi.advanceTimersByTimeAsync(899);
    expect(ptyMock.pty.write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(ptyMock.pty.write.mock.calls).toEqual([['claude\r']]);
    manager.dispose();
  });

  it('never types into a pane closed while the launch was pending', async () => {
    vi.useFakeTimers();
    const manager = new BoardPtyManager();
    const { sessionId, paneId } = await openClaudePane(manager);

    await manager.closePane({ correlationId, sessionId, paneId });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ptyMock.pty.write).not.toHaveBeenCalled();
    manager.dispose();
  });
});

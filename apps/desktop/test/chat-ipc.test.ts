import type { CoreRuntime } from '@builderhelm/core';
import { ipcChannels } from '@builderhelm/protocol/ipc';
import { createCorrelationId } from '@builderhelm/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<
  string,
  (event: { sender: ReturnType<typeof sender> }, input: unknown) => unknown
>();

vi.mock('electron', async () => {
  const { electronSession } = await import('./electron-mock.js');
  return {
    ipcMain: {
      handle: (
        channel: string,
        handler: (
          event: { sender: ReturnType<typeof sender> },
          input: unknown,
        ) => unknown,
      ) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    session: electronSession,
  };
});

import { registerIpcHandlers } from '../src/main/ipc.js';

const unregisterCallbacks: Array<() => void> = [];

function sender(id = 1) {
  return {
    id,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
}

function streamRequest(runId = createCorrelationId()) {
  return {
    correlationId: createCorrelationId(),
    runId,
    input: {
      threadId: createCorrelationId(),
      modelRef: `${createCorrelationId()}:gpt-stream`,
      text: 'Hello',
    },
  };
}

beforeEach(() => handlers.clear());

afterEach(() => {
  while (unregisterCallbacks.length > 0) unregisterCallbacks.pop()?.();
});

describe('chat IPC boundary', () => {
  it('rejects unknown and credential-shaped fields before invoking core', () => {
    const stream = vi.fn();
    unregisterCallbacks.push(
      registerIpcHandlers({ chats: { stream } } as unknown as CoreRuntime),
    );
    const request = streamRequest();

    const result = handlers.get(ipcChannels.chatStreamStart)!(
      { sender: sender() },
      {
        ...request,
        input: { ...request.input, apiKey: 'must-not-cross-ipc' },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(stream).not.toHaveBeenCalled();
  });

  it('sends only normalized events over the fixed main-to-renderer channel', async () => {
    const stream = vi.fn(async function* () {
      yield { type: 'text.delta' as const, text: 'Hello' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    });
    unregisterCallbacks.push(
      registerIpcHandlers({ chats: { stream } } as unknown as CoreRuntime),
    );
    const request = streamRequest();
    const renderer = sender();

    expect(
      handlers.get(ipcChannels.chatStreamStart)!({ sender: renderer }, request),
    ).toEqual({ ok: true, value: { runId: request.runId } });

    await vi.waitFor(() => expect(renderer.send).toHaveBeenCalledTimes(2));
    expect(renderer.send.mock.calls).toEqual([
      [
        ipcChannels.chatStreamEvent,
        { runId: request.runId, event: { type: 'text.delta', text: 'Hello' } },
      ],
      [
        ipcChannels.chatStreamEvent,
        { runId: request.runId, event: { type: 'done', finishReason: 'stop' } },
      ],
    ]);
    expect(stream).toHaveBeenCalledWith(
      request.input,
      request.correlationId,
      expect.any(AbortSignal),
    );
  });

  it('cancels only streams owned by the requesting renderer', async () => {
    const stream = vi.fn(async function* (
      _input: unknown,
      _correlationId: unknown,
      signal: AbortSignal,
    ) {
      yield { type: 'text.delta' as const, text: 'Partial' };
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      yield { type: 'done' as const, finishReason: 'cancelled' as const };
    });
    unregisterCallbacks.push(
      registerIpcHandlers({ chats: { stream } } as unknown as CoreRuntime),
    );
    const request = streamRequest();
    const owner = sender(11);
    const other = sender(12);
    handlers.get(ipcChannels.chatStreamStart)!({ sender: owner }, request);
    await vi.waitFor(() => expect(owner.send).toHaveBeenCalledTimes(1));

    expect(
      handlers.get(ipcChannels.chatStreamCancel)!(
        { sender: other },
        {
          correlationId: createCorrelationId(),
          input: { runId: request.runId },
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(
      handlers.get(ipcChannels.chatStreamCancel)!(
        { sender: owner },
        {
          correlationId: createCorrelationId(),
          input: { runId: request.runId },
        },
      ),
    ).toEqual({ ok: true, value: { cancelled: true } });
    await vi.waitFor(() => expect(owner.send).toHaveBeenCalledTimes(2));
    expect(owner.send).toHaveBeenLastCalledWith(ipcChannels.chatStreamEvent, {
      runId: request.runId,
      event: { type: 'done', finishReason: 'cancelled' },
    });
  });

  it('sanitizes unexpected stream failures before notifying the renderer', async () => {
    const sentinel = 'private-path-and-provider-body-sentinel';
    const stream = vi.fn(() => ({
      [Symbol.asyncIterator]() {
        return {
          next: async () => Promise.reject(new Error(sentinel)),
        };
      },
    }));
    unregisterCallbacks.push(
      registerIpcHandlers({ chats: { stream } } as unknown as CoreRuntime),
    );
    const request = streamRequest();
    const renderer = sender();
    handlers.get(ipcChannels.chatStreamStart)!({ sender: renderer }, request);

    await vi.waitFor(() => expect(renderer.send).toHaveBeenCalledTimes(1));
    const payload = renderer.send.mock.calls[0]?.[1];
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(payload).toEqual({
      runId: request.runId,
      event: {
        type: 'error',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The request could not be completed',
          retryable: false,
        },
      },
    });
  });
});

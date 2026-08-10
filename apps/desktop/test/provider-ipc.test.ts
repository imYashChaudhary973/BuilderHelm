import { createCorrelationId, ZeroError } from '@zero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, input: unknown) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

import type { CoreRuntime } from '@zero/core';
import { ipcChannels } from '@zero/protocol/ipc';

import { registerIpcHandlers } from '../src/main/ipc.js';

describe('provider IPC boundary', () => {
  beforeEach(() => handlers.clear());

  it('rejects unrecognized input fields before invoking core', async () => {
    const list = vi.fn(() => []);
    const unregister = registerIpcHandlers({
      providers: { list },
    } as unknown as CoreRuntime);
    const handler = handlers.get(ipcChannels.providerList)!;

    expect(() =>
      handler({}, { correlationId: createCorrelationId(), extra: true }),
    ).toThrow();
    expect(list).not.toHaveBeenCalled();
    unregister();
  });

  it('passes a validated create request to the core service', async () => {
    const create = vi.fn(async () => ({ id: 'result' }));
    registerIpcHandlers({ providers: { create } } as unknown as CoreRuntime);
    const correlationId = createCorrelationId();
    const input = {
      label: 'Example',
      protocol: 'openai',
      baseUrl: null,
      headers: [],
      privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
      enabled: true,
      apiKey: 'ipc-test-sentinel',
    };

    await handlers.get(ipcChannels.providerCreate)!({}, { correlationId, input });
    expect(create).toHaveBeenCalledWith(input, correlationId);
  });

  it('passes connection and discovery requests through sanitized result envelopes', async () => {
    const testConnection = vi.fn(async () => ({ ok: true as const, latencyMs: 12 }));
    const discover = vi.fn(async () => []);
    registerIpcHandlers({
      models: { testConnection, discover },
    } as unknown as CoreRuntime);
    const correlationId = createCorrelationId();
    const providerId = createCorrelationId();

    await expect(
      handlers.get(ipcChannels.providerTestConnection)!(
        {},
        {
          correlationId,
          input: { providerId },
        },
      ),
    ).resolves.toEqual({ ok: true, value: { ok: true, latencyMs: 12 } });
    await expect(
      handlers.get(ipcChannels.modelDiscover)!(
        {},
        {
          correlationId,
          input: { providerId },
        },
      ),
    ).resolves.toEqual({ ok: true, value: [] });
    expect(testConnection).toHaveBeenCalledWith(providerId, correlationId);
    expect(discover).toHaveBeenCalledWith(providerId, correlationId);
  });

  it('does not expose unexpected main-process error details to the renderer', async () => {
    const sentinel = 'private-path-and-provider-body-sentinel';
    const testConnection = vi.fn(async () => {
      throw new Error(sentinel);
    });
    registerIpcHandlers({ models: { testConnection } } as unknown as CoreRuntime);

    const result = await handlers.get(ipcChannels.providerTestConnection)!(
      {},
      {
        correlationId: createCorrelationId(),
        input: { providerId: createCorrelationId() },
      },
    );
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed',
        retryable: false,
      },
    });
  });

  it('preserves safe stable errors returned by the model boundary', async () => {
    const testConnection = vi.fn(async () => {
      throw new ZeroError('AUTH_FAILED', 'Provider authentication failed');
    });
    registerIpcHandlers({ models: { testConnection } } as unknown as CoreRuntime);

    await expect(
      handlers.get(ipcChannels.providerTestConnection)!(
        {},
        {
          correlationId: createCorrelationId(),
          input: { providerId: createCorrelationId() },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTH_FAILED', message: 'Provider authentication failed' },
    });
  });
});

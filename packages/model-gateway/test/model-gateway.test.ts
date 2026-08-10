import type {
  ChatStreamEvent,
  ModelRecord,
  ModelRequest,
  ModelResponse,
} from '@zero/protocol';
import { createId, utcNow } from '@zero/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  ModelGateway,
  normalizeProviderError,
  type ProviderAdapter,
} from '../src/index.js';

function fixture(): {
  providerId: string;
  model: ModelRecord;
  request: ModelRequest;
  adapter: ProviderAdapter;
} {
  const providerId = createId();
  const model: ModelRecord = {
    ref: `${providerId}:example-model`,
    providerId,
    modelId: 'example-model',
    label: 'Example model',
    capabilities: {
      text: true,
      vision: false,
      audioInput: false,
      toolCalling: false,
      parallelTools: false,
      structuredOutput: false,
      streaming: true,
      reasoningControls: false,
      serverWebSearch: false,
      serverMcp: false,
      contextWindow: 8_192,
      maxOutputTokens: 2_048,
    },
    privacyClass: 'remote',
    tags: ['test'],
  };
  const response: ModelResponse = { text: 'Hello', toolCalls: [], finishReason: 'stop' };
  const adapter: ProviderAdapter = {
    protocol: 'openai',
    invoke: vi.fn(async () => response),
    async *stream(): AsyncIterable<ChatStreamEvent> {
      yield { type: 'text.delta', text: 'Hel' };
      yield { type: 'text.delta', text: 'lo' };
      yield { type: 'done', finishReason: 'stop' };
    },
    discoverModels: vi.fn(async () => [model]),
    testConnection: vi.fn(async () => ({ ok: true, latencyMs: 4 })),
  };
  return {
    providerId,
    model,
    adapter,
    request: {
      modelRef: model.ref,
      messages: [
        {
          id: createId(),
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: utcNow(),
        },
      ],
      dataClassifications: ['public'],
      stream: false,
    },
  };
}

function register(
  values: ReturnType<typeof fixture>,
  resolve = vi.fn(async () => 'fake-test-credential'),
): { gateway: ModelGateway; resolve: ReturnType<typeof vi.fn> } {
  const gateway = new ModelGateway({ resolve });
  gateway.registerProvider(
    {
      id: values.providerId,
      protocol: 'openai',
      baseUrl: 'https://api.example.test/v1',
      secretRef: `zero.provider.${values.providerId}.api-key`,
      headers: [],
      privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
      enabled: true,
    },
    values.adapter,
  );
  gateway.replaceModels(values.providerId, [values.model]);
  return { gateway, resolve };
}

describe('model gateway', () => {
  it('routes normalized requests and validates normalized responses', async () => {
    const values = fixture();
    const { gateway } = register(values);

    await expect(
      gateway.invoke(values.request, new AbortController().signal),
    ).resolves.toEqual({
      text: 'Hello',
      toolCalls: [],
      finishReason: 'stop',
    });
    expect(values.adapter.invoke).toHaveBeenCalledWith(
      values.request,
      expect.objectContaining({ providerId: values.providerId }),
    );
  });

  it('blocks privacy and capability mismatches before resolving credentials', async () => {
    const values = fixture();
    const { gateway, resolve } = register(values);

    await expect(
      gateway.invoke(
        { ...values.request, dataClassifications: ['health'] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      gateway.invoke(
        {
          ...values.request,
          tools: [
            { name: 'lookup', description: 'Lookup', inputSchema: { type: 'object' } },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'MODEL_CAPABILITY_MISMATCH' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses to send credentials over non-loopback HTTP', async () => {
    const values = fixture();
    const resolve = vi.fn(async () => 'fake-test-credential');
    const gateway = new ModelGateway({ resolve });
    gateway.registerProvider(
      {
        id: values.providerId,
        protocol: 'openai',
        baseUrl: 'http://api.example.test/v1',
        secretRef: `zero.provider.${values.providerId}.api-key`,
        headers: [],
        privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
        enabled: true,
      },
      values.adapter,
    );
    gateway.replaceModels(values.providerId, [values.model]);

    await expect(
      gateway.invoke(values.request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('supports validated streaming and cancellation', async () => {
    const values = fixture();
    const { gateway } = register(values);
    const events: ChatStreamEvent[] = [];
    for await (const event of gateway.stream(
      { ...values.request, stream: true },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      'text.delta',
      'text.delta',
      'done',
    ]);

    const controller = new AbortController();
    controller.abort();
    await expect(gateway.invoke(values.request, controller.signal)).rejects.toMatchObject(
      {
        code: 'CANCELLED',
      },
    );
  });

  it('discovers models and tests connections through the registered adapter', async () => {
    const values = fixture();
    const { gateway } = register(values);
    await expect(
      gateway.discoverModels(values.providerId, new AbortController().signal),
    ).resolves.toEqual([values.model]);
    await expect(
      gateway.testConnection(values.providerId, new AbortController().signal),
    ).resolves.toEqual({ ok: true, latencyMs: 4 });
  });
});

describe('provider error mapping', () => {
  it.each([
    [401, 'AUTH_FAILED'],
    [429, 'RATE_LIMITED'],
    [404, 'MODEL_UNAVAILABLE'],
    [413, 'CONTEXT_TOO_LARGE'],
    [503, 'MODEL_UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s', (status, code) => {
    expect(normalizeProviderError({ status })).toMatchObject({ code });
  });

  it('maps aborts without leaking provider error bodies', () => {
    const error = Object.assign(new Error('sensitive provider body'), {
      name: 'AbortError',
    });
    expect(normalizeProviderError(error)).toMatchObject({
      code: 'CANCELLED',
      message: 'Model request was cancelled',
    });
  });

  it('maps request deadlines to a retryable timeout without leaking details', () => {
    const error = Object.assign(new Error('sensitive timeout detail'), {
      name: 'TimeoutError',
    });
    expect(normalizeProviderError(error)).toMatchObject({
      code: 'INTEGRATION_OFFLINE',
      message: 'Provider request timed out',
      retryable: true,
    });
  });
});

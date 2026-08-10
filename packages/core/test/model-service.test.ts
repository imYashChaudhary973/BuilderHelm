import type { GatewayFetch } from '@zero/model-gateway';
import { createCorrelationId } from '@zero/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapCore,
  MemorySecretStore,
  type CoreRuntime,
  type SecretStore,
} from '../src/index.js';

const runtimes: CoreRuntime[] = [];

function providerInput(apiKey: string, overrides: Record<string, unknown> = {}) {
  return {
    label: 'OpenAI',
    protocol: 'openai' as const,
    baseUrl: 'https://api.example.test/v1',
    headers: [],
    privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
    enabled: true,
    apiKey,
    ...overrides,
  };
}

afterEach(() => {
  while (runtimes.length > 0) runtimes.pop()?.close();
});

describe('model service', () => {
  it('tests a saved connection and persists a discovered catalog without leaking secrets', async () => {
    const sentinel = 'model-service-secret-sentinel';
    const logs: string[] = [];
    const fetcher = vi.fn<GatewayFetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${sentinel}`);
      return new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-z', owned_by: 'openai' },
            { id: 'gpt-a', owned_by: 'openai' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
      logSink: (line) => logs.push(line),
      modelGatewayFetch: fetcher,
    });
    runtimes.push(runtime);
    const provider = await runtime.providers.create(
      providerInput(sentinel),
      createCorrelationId(),
    );

    await expect(
      runtime.models.testConnection(provider.id, createCorrelationId()),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runtime.models.discover(provider.id, createCorrelationId()),
    ).resolves.toHaveLength(2);
    expect(runtime.models.list(provider.id).map((model) => model.modelId)).toEqual([
      'gpt-a',
      'gpt-z',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(provider)).not.toContain(sentinel);
    expect(logs.join('\n')).not.toContain(sentinel);
  });

  it('blocks unavailable, unsupported, and insecure providers before reading a credential', async () => {
    const get = vi.fn(async () => 'must-not-be-resolved');
    const secrets: SecretStore = {
      set: vi.fn(async () => undefined),
      get,
      delete: vi.fn(async () => undefined),
    };
    const fetcher = vi.fn<GatewayFetch>();
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: secrets,
      modelGatewayFetch: fetcher,
    });
    runtimes.push(runtime);
    const disabled = await runtime.providers.create(
      providerInput('stored', { enabled: false }),
      createCorrelationId(),
    );
    const insecure = await runtime.providers.create(
      providerInput('stored', {
        label: 'Insecure',
        baseUrl: 'http://api.example.test/v1',
      }),
      createCorrelationId(),
    );
    const unsupported = await runtime.providers.create(
      providerInput('stored', {
        label: 'Anthropic',
        protocol: 'anthropic',
      }),
      createCorrelationId(),
    );

    await expect(
      runtime.models.testConnection(disabled.id, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    await expect(
      runtime.models.testConnection(insecure.id, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      runtime.models.testConnection(unsupported.id, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(get).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves the last catalog when discovery returns duplicate model IDs', async () => {
    let duplicate = false;
    const fetcher = vi.fn<GatewayFetch>(async () =>
      Response.json({
        data: duplicate ? [{ id: 'stable' }, { id: 'stable' }] : [{ id: 'stable' }],
      }),
    );
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
      modelGatewayFetch: fetcher,
    });
    runtimes.push(runtime);
    const provider = await runtime.providers.create(
      providerInput('fake-test-key'),
      createCorrelationId(),
    );
    await runtime.models.discover(provider.id, createCorrelationId());
    duplicate = true;

    await expect(
      runtime.models.discover(provider.id, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(runtime.models.list(provider.id).map((model) => model.modelId)).toEqual([
      'stable',
    ]);
  });
});

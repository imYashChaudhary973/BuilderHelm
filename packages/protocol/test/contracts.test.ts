import { createCorrelationId } from '@zero/shared';
import { describe, expect, it } from 'vitest';

import {
  createEvent,
  createProviderInputSchema,
  modelCapabilityOverrideUpdateRequestSchema,
  modelListIpcResponseSchema,
  providerTestConnectionRequestSchema,
  systemHealthRequestSchema,
  systemHealthResponseSchema,
  zeroEventSchema,
} from '../src/index.js';

describe('event envelope', () => {
  it('creates a validated event with correlation metadata', () => {
    const event = createEvent({
      type: 'core.started',
      correlationId: createCorrelationId(),
      payload: { migrated: true },
    });

    expect(zeroEventSchema.parse(event)).toEqual(event);
  });

  it('rejects non-JSON payload values', () => {
    expect(() =>
      zeroEventSchema.parse({
        id: createCorrelationId(),
        type: 'unsafe.payload',
        occurredAt: new Date().toISOString(),
        correlationId: createCorrelationId(),
        payload: { callback: () => undefined },
      }),
    ).toThrow();
  });
});

describe('IPC contracts', () => {
  it('rejects malformed renderer arguments', () => {
    expect(
      systemHealthRequestSchema.safeParse({ correlationId: '../../etc/passwd' }).success,
    ).toBe(false);
  });

  it('rejects privileged details in a health response', () => {
    expect(
      systemHealthResponseSchema.safeParse({
        status: 'ok',
        database: 'ready',
        occurredAt: new Date().toISOString(),
        correlationId: createCorrelationId(),
        databasePath: '/Users/example/private.sqlite',
      }).success,
    ).toBe(false);
  });

  it('validates provider operations and sanitized IPC failures', () => {
    const providerId = createCorrelationId();
    expect(
      providerTestConnectionRequestSchema.parse({
        correlationId: createCorrelationId(),
        input: { providerId },
      }),
    ).toMatchObject({ input: { providerId } });
    expect(
      providerTestConnectionRequestSchema.safeParse({
        correlationId: createCorrelationId(),
        input: { providerId, apiKey: 'must-not-cross' },
      }).success,
    ).toBe(false);
    expect(
      modelListIpcResponseSchema.parse({
        ok: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Provider authentication failed',
          retryable: false,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
  });

  it('requires explicit remote routing while allowing credential-free local Ollama', () => {
    const common = {
      label: 'Provider',
      headers: [],
      privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
      enabled: true,
    };
    expect(
      createProviderInputSchema.safeParse({
        ...common,
        protocol: 'openai-compatible',
        baseUrl: null,
        apiKey: 'secret',
      }).success,
    ).toBe(false);
    expect(
      createProviderInputSchema.parse({
        ...common,
        protocol: 'ollama',
        baseUrl: null,
        apiKey: '',
      }),
    ).toMatchObject({ protocol: 'ollama', apiKey: '' });
    expect(
      createProviderInputSchema.safeParse({
        ...common,
        protocol: 'openai',
        baseUrl: null,
        apiKey: '',
      }).success,
    ).toBe(false);
  });

  it('accepts only known per-model capability override fields', () => {
    const request = {
      correlationId: createCorrelationId(),
      input: {
        modelRef: `${createCorrelationId()}:model`,
        overrides: { toolCalling: true, contextWindow: 32_768 },
      },
    };
    expect(modelCapabilityOverrideUpdateRequestSchema.parse(request)).toEqual(request);
    expect(
      modelCapabilityOverrideUpdateRequestSchema.safeParse({
        ...request,
        input: { ...request.input, overrides: { apiKey: 'must-not-cross' } },
      }).success,
    ).toBe(false);
  });
});

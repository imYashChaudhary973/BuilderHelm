import { createId, utcNow } from '@builderhelm/shared';
import { describe, expect, it } from 'vitest';

import {
  chatStreamEventSchema,
  modelRequestSchema,
  modelResponseSchema,
} from '../src/index.js';

describe('normalized model contracts', () => {
  it('accepts provider-independent messages and rejects credential-shaped extras', () => {
    const providerId = createId();
    const request = {
      modelRef: `${providerId}:example-model`,
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
    };

    expect(modelRequestSchema.parse(request)).toEqual(request);
    expect(
      modelRequestSchema.safeParse({ ...request, apiKey: 'must-not-cross' }).success,
    ).toBe(false);
  });

  it('keeps provider continuation optional rather than canonical', () => {
    expect(
      modelResponseSchema.parse({
        text: 'Hello',
        toolCalls: [],
        finishReason: 'stop',
      }),
    ).toEqual({ text: 'Hello', toolCalls: [], finishReason: 'stop' });
  });

  it('validates every stream event variant independently', () => {
    expect(chatStreamEventSchema.parse({ type: 'text.delta', text: 'Hi' })).toEqual({
      type: 'text.delta',
      text: 'Hi',
    });
    expect(
      chatStreamEventSchema.safeParse({
        type: 'usage',
        usage: { inputTokens: -1, outputTokens: 0 },
      }).success,
    ).toBe(false);
  });
});

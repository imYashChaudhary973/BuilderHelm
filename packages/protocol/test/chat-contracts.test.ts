import { createId } from '@zero/shared';
import { describe, expect, it } from 'vitest';

import {
  appendChatTurnInputSchema,
  chatClientStreamEventSchema,
  chatStreamStartRequestSchema,
} from '../src/index.js';

describe('canonical chat contracts', () => {
  it('defaults non-assistant response metadata to null', () => {
    const threadId = createId();
    expect(
      appendChatTurnInputSchema.parse({
        threadId,
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      }),
    ).toEqual({
      threadId,
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      modelRef: null,
      finishReason: null,
      providerContinuation: null,
      usage: null,
    });
  });

  it('accepts normalized assistant usage and matching continuation metadata', () => {
    const providerId = createId();
    const input = {
      threadId: createId(),
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Hello back' }],
      modelRef: `${providerId}:gpt-example`,
      finishReason: 'stop' as const,
      providerContinuation: { providerId, responseId: 'response-123' },
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cachedInputTokens: 3,
        reasoningTokens: 1,
      },
    };

    expect(appendChatTurnInputSchema.parse(input)).toEqual(input);
  });

  it('rejects incomplete, mismatched, and credential-shaped turn data', () => {
    const providerId = createId();
    const base = {
      threadId: createId(),
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      modelRef: `${providerId}:gpt-example`,
      finishReason: 'stop',
    };

    expect(appendChatTurnInputSchema.safeParse({ ...base, modelRef: null }).success).toBe(
      false,
    );
    expect(
      appendChatTurnInputSchema.safeParse({
        ...base,
        providerContinuation: { providerId: createId(), responseId: 'wrong-provider' },
      }).success,
    ).toBe(false);
    expect(
      appendChatTurnInputSchema.safeParse({ ...base, apiKey: 'must-not-persist' })
        .success,
    ).toBe(false);
    expect(
      appendChatTurnInputSchema.safeParse({
        ...base,
        role: 'user',
      }).success,
    ).toBe(false);
  });

  it('strictly validates stream requests before they cross IPC', () => {
    const request = {
      correlationId: createId(),
      runId: createId(),
      input: {
        threadId: createId(),
        modelRef: `${createId()}:gpt-example`,
        text: 'Hello',
      },
    };

    expect(chatStreamStartRequestSchema.safeParse(request).success).toBe(true);
    expect(
      chatStreamStartRequestSchema.safeParse({
        ...request,
        input: { ...request.input, apiKey: 'must-not-cross-ipc' },
      }).success,
    ).toBe(false);
  });

  it('keeps provider continuation identifiers out of renderer stream events', () => {
    expect(
      chatClientStreamEventSchema.safeParse({ type: 'done', finishReason: 'stop' })
        .success,
    ).toBe(true);
    expect(
      chatClientStreamEventSchema.safeParse({
        type: 'done',
        finishReason: 'stop',
        providerContinuation: {
          providerId: createId(),
          responseId: 'private-provider-response-id',
        },
      }).success,
    ).toBe(false);
  });
});

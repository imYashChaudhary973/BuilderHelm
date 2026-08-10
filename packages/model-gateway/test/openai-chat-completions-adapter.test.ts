import type { ModelRequest } from '@zero/protocol';
import { createId, utcNow } from '@zero/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  OpenAIChatCompletionsAdapter,
  type GatewayFetch,
  type ProviderInvocationContext,
} from '../src/index.js';

function context(baseUrl: string | null = 'https://compatible.example.test/v1') {
  return {
    providerId: createId(),
    baseUrl,
    credential: 'compatible-test-secret',
    headers: { 'X-Provider-Tenant': 'contract' },
    signal: new AbortController().signal,
  } satisfies ProviderInvocationContext;
}

function request(providerId: string, stream = false): ModelRequest {
  return {
    modelRef: `${providerId}:example-chat`,
    messages: [
      {
        id: createId(),
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: utcNow(),
      },
    ],
    tools: [
      {
        name: 'lookup',
        description: 'Lookup a value',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ],
    responseSchema: { type: 'object', properties: { answer: { type: 'string' } } },
    reasoning: 'medium',
    dataClassifications: ['public'],
    maxOutputTokens: 300,
    stream,
  };
}

describe('OpenAI-compatible Chat Completions adapter', () => {
  it('uses the configured endpoint and normalizes text, tools, usage, and finish state', async () => {
    const provider = context();
    const fetcher = vi.fn<GatewayFetch>(async (input, init) => {
      expect(String(input)).toBe('https://compatible.example.test/v1/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer compatible-test-secret',
      );
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'example-chat',
        stream: false,
        max_tokens: 300,
        reasoning_effort: 'medium',
        response_format: { type: 'json_schema' },
      });
      return Response.json({
        id: 'chatcmpl-contract',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: 'Checking.',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"query":"hello"}' },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 1 },
        },
      });
    });

    await expect(
      new OpenAIChatCompletionsAdapter(fetcher).invoke(
        request(provider.providerId),
        provider,
      ),
    ).resolves.toEqual({
      text: 'Checking.',
      toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { query: 'hello' } }],
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedInputTokens: 2,
        reasoningTokens: 1,
      },
      finishReason: 'tool_calls',
      providerContinuation: {
        providerId: provider.providerId,
        responseId: 'chatcmpl-contract',
      },
    });
  });

  it('accumulates streamed tool arguments and fails closed without a finish chunk', async () => {
    const provider = context();
    const frames = [
      {
        id: 'chatcmpl-stream',
        choices: [
          {
            delta: {
              content: 'Looking',
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  function: { name: 'lookup', arguments: '{"q' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-stream',
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: 'uery":"x"}' } }] },
          },
        ],
      },
      {
        id: 'chatcmpl-stream',
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      },
      {
        id: 'chatcmpl-stream',
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
    ];
    const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
    const events = [];
    for await (const event of new OpenAIChatCompletionsAdapter(
      async () => new Response(body),
    ).stream(request(provider.providerId, true), provider)) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'text.delta', text: 'Looking' },
      {
        type: 'tool.proposed',
        call: { id: 'call-1', name: 'lookup', arguments: { query: 'x' } },
      },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      {
        type: 'done',
        finishReason: 'tool_calls',
        providerContinuation: {
          providerId: provider.providerId,
          responseId: 'chatcmpl-stream',
        },
      },
    ]);

    const truncated = new OpenAIChatCompletionsAdapter(
      async () =>
        new Response('data: {"id":"partial","choices":[{"delta":{"content":"x"}}]}\n\n'),
    );
    const consume = async () => {
      for await (const event of truncated.stream(
        request(provider.providerId, true),
        provider,
      )) {
        expect(event.type).toBe('text.delta');
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('requires an explicit base URL and discovers conservatively', async () => {
    const provider = context();
    const adapter = new OpenAIChatCompletionsAdapter(async () =>
      Response.json({ data: [{ id: 'example-chat', owned_by: 'vendor' }] }),
    );
    await expect(adapter.discoverModels(provider)).resolves.toMatchObject([
      {
        modelId: 'example-chat',
        privacyClass: 'remote',
        tags: ['owner:vendor'],
        capabilities: { text: true, streaming: true, toolCalling: false },
      },
    ]);
    await expect(adapter.discoverModels(context(null))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

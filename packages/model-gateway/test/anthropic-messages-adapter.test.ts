import type { ModelRequest } from '@builderhelm/protocol';
import { createId, utcNow } from '@builderhelm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  AnthropicMessagesAdapter,
  ProviderHttpError,
  type GatewayFetch,
  type ProviderInvocationContext,
} from '../src/index.js';

function context(
  providerId = createId(),
  overrides: Partial<ProviderInvocationContext> = {},
): ProviderInvocationContext {
  return {
    providerId,
    baseUrl: 'https://api.example.test/v1',
    credential: 'fake-anthropic-contract-credential',
    headers: { 'X-BuilderHelm-Test': 'contract' },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function request(providerId: string, stream = false): ModelRequest {
  return {
    modelRef: `${providerId}:claude-example`,
    messages: [
      {
        id: createId(),
        role: 'system',
        content: [{ type: 'text', text: 'Be concise.' }],
        createdAt: utcNow(),
      },
      {
        id: createId(),
        role: 'user',
        content: [{ type: 'text', text: 'Look this up.' }],
        createdAt: utcNow(),
      },
      {
        id: createId(),
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will check.' },
          {
            type: 'tool_call',
            call: { id: 'toolu_prior', name: 'lookup', arguments: { query: 'prior' } },
          },
        ],
        createdAt: utcNow(),
      },
      {
        id: createId(),
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            callId: 'toolu_prior',
            output: { answer: 42 },
            isError: false,
          },
        ],
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
    reasoning: 'none',
    dataClassifications: ['public'],
    maxOutputTokens: 400,
    stream,
  };
}

describe('Anthropic Messages adapter', () => {
  it('converts normalized messages, tools, response, and usage', async () => {
    const provider = context();
    const fetcher = vi.fn<GatewayFetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        model: 'claude-example',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Look this up.' }],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will check.' },
              {
                type: 'tool_use',
                id: 'toolu_prior',
                name: 'lookup',
                input: { query: 'prior' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_prior',
                content: '{"answer":42}',
                is_error: false,
              },
            ],
          },
        ],
        stream: false,
        system: [{ type: 'text', text: 'Be concise.' }],
        output_config: {
          effort: 'medium',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { answer: { type: 'string' } },
            },
          },
        },
        tools: [
          {
            name: 'lookup',
            description: 'Lookup a value',
            input_schema: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        ],
      });
      return Response.json({
        id: 'msg_contract',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Found it.' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'lookup',
            input: { query: 'current' },
          },
        ],
        model: 'claude-example',
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          cache_read_input_tokens: 5,
          output_tokens_details: { thinking_tokens: 2 },
        },
      });
    });

    await expect(
      new AnthropicMessagesAdapter(fetcher).invoke(
        {
          ...request(provider.providerId),
          reasoning: 'medium',
          responseSchema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
          },
        },
        provider,
      ),
    ).resolves.toEqual({
      text: 'Found it.',
      toolCalls: [{ id: 'toolu_1', name: 'lookup', arguments: { query: 'current' } }],
      usage: {
        inputTokens: 20,
        outputTokens: 8,
        cachedInputTokens: 5,
        reasoningTokens: 2,
      },
      finishReason: 'tool_calls',
      providerContinuation: {
        providerId: provider.providerId,
        responseId: 'msg_contract',
      },
    });

    const [url, init] = fetcher.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe('https://api.example.test/v1/messages');
    expect(headers.get('x-api-key')).toBe('fake-anthropic-contract-credential');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
  });

  it('normalizes streamed text, tool input, final usage, and completion', async () => {
    const provider = context();
    const frames = [
      {
        type: 'message_start',
        message: {
          id: 'msg_stream',
          usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 3 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"hello"}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'ping' },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 9 },
      },
      { type: 'message_stop' },
    ];
    const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
    const fetcher: GatewayFetch = async () =>
      new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    const events = [];

    for await (const event of new AnthropicMessagesAdapter(fetcher).stream(
      request(provider.providerId, true),
      provider,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello' },
      {
        type: 'tool.proposed',
        call: { id: 'toolu_1', name: 'lookup', arguments: { query: 'hello' } },
      },
      {
        type: 'usage',
        usage: { inputTokens: 12, outputTokens: 9, cachedInputTokens: 3 },
      },
      {
        type: 'done',
        finishReason: 'tool_calls',
        providerContinuation: {
          providerId: provider.providerId,
          responseId: 'msg_stream',
        },
      },
    ]);
  });

  it('fails closed on early streams and exposes only HTTP status', async () => {
    const provider = context();
    const truncatedBody = `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_truncated',
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    })}\n\n`;
    const truncated = new AnthropicMessagesAdapter(
      async () => new Response(truncatedBody),
    );
    const consume = async () => {
      for await (const event of truncated.stream(
        request(provider.providerId, true),
        provider,
      )) {
        // Consume the full stream to validate its terminal state.
        void event;
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });

    const rejected = new AnthropicMessagesAdapter(
      async () => new Response('provider-sensitive-error-body', { status: 401 }),
    );
    await expect(rejected.invoke(request(provider.providerId), provider)).rejects.toEqual(
      new ProviderHttpError(401),
    );

    const fetcher = vi.fn<GatewayFetch>();
    await expect(
      new AnthropicMessagesAdapter(fetcher).invoke(
        {
          ...request(provider.providerId),
          tools: [
            {
              name: 'invalid_schema',
              description: 'Invalid fixture',
              inputSchema: { type: 'array' },
            },
          ],
        },
        provider,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the native models endpoint and propagates cancellation', async () => {
    const provider = context(createId(), { baseUrl: null });
    const discoveryFetcher = vi.fn<GatewayFetch>(async (input) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/models?limit=1000');
      return Response.json({
        data: [
          {
            id: 'claude-example',
            display_name: 'Claude Example',
            created_at: '2026-01-01T00:00:00Z',
            max_input_tokens: 200_000,
            max_tokens: 64_000,
            capabilities: {
              image_input: { supported: true },
              structured_outputs: { supported: true },
              effort: { supported: true },
            },
          },
        ],
        has_more: false,
      });
    });
    await expect(
      new AnthropicMessagesAdapter(discoveryFetcher).discoverModels(provider),
    ).resolves.toMatchObject([
      {
        ref: `${provider.providerId}:claude-example`,
        label: 'Claude Example',
        capabilities: {
          text: true,
          streaming: true,
          vision: true,
          toolCalling: false,
          structuredOutput: true,
          reasoningControls: true,
          contextWindow: 200_000,
          maxOutputTokens: 64_000,
        },
        privacyClass: 'remote',
        tags: ['created:2026-01-01T00:00:00Z'],
      },
    ]);

    const controller = new AbortController();
    controller.abort();
    const cancelled = new AnthropicMessagesAdapter(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('cancelled', 'AbortError');
    });
    await expect(
      cancelled.invoke(
        request(provider.providerId),
        context(provider.providerId, { signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('follows bounded model pagination and normalizes stream errors', async () => {
    const provider = context();
    const fetcher = vi.fn<GatewayFetch>(async (input) => {
      const url = new URL(input);
      if (url.searchParams.get('after_id') === null) {
        return Response.json({
          data: [{ id: 'claude-new', display_name: 'Claude New' }],
          has_more: true,
          last_id: 'claude-new',
        });
      }
      expect(url.searchParams.get('after_id')).toBe('claude-new');
      return Response.json({
        data: [{ id: 'claude-old', display_name: 'Claude Old' }],
        has_more: false,
        last_id: 'claude-old',
      });
    });
    await expect(
      new AnthropicMessagesAdapter(fetcher).discoverModels(provider),
    ).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const errorBody = `data: ${JSON.stringify({
      type: 'error',
      error: { type: 'overloaded_error', message: 'provider detail' },
    })}\n\n`;
    const overloaded = new AnthropicMessagesAdapter(async () => new Response(errorBody));
    const consume = async () => {
      for await (const event of overloaded.stream(
        request(provider.providerId, true),
        provider,
      )) {
        void event;
      }
    };
    await expect(consume()).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      retryable: true,
      message: 'Anthropic response stream failed',
    });
  });
});

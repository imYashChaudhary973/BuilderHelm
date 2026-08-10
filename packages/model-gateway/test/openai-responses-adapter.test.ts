import type { ModelRequest } from '@zero/protocol';
import { createId, utcNow } from '@zero/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  OpenAIResponsesAdapter,
  ProviderHttpError,
  type GatewayFetch,
  type ProviderInvocationContext,
} from '../src/index.js';

function context(providerId = createId()): ProviderInvocationContext {
  return {
    providerId,
    baseUrl: 'https://api.example.test/v1',
    credential: 'fake-openai-contract-credential',
    headers: { 'X-Zero-Test': 'contract' },
    signal: new AbortController().signal,
  };
}

function request(providerId: string, stream = false): ModelRequest {
  return {
    modelRef: `${providerId}:gpt-example`,
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
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: utcNow(),
      },
      {
        id: createId(),
        role: 'assistant',
        content: [{ type: 'text', text: 'Prior answer.' }],
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
    maxOutputTokens: 400,
    stream,
  };
}

describe('OpenAI Responses adapter', () => {
  it('converts a normalized request and response without storing provider conversation state', async () => {
    const provider = context();
    const fetcher = vi.fn<GatewayFetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'gpt-example',
        store: false,
        stream: false,
        max_output_tokens: 400,
        reasoning: { effort: 'medium', summary: 'auto' },
      });
      expect(body.input).toEqual([
        {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: 'Be concise.' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Prior answer.' }],
        },
      ]);
      return Response.json({
        id: 'resp_contract',
        status: 'completed',
        output: [
          {
            id: 'message_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hello back.', annotations: [] }],
          },
          {
            id: 'function_1',
            call_id: 'call_1',
            type: 'function_call',
            name: 'lookup',
            arguments: '{"query":"hello"}',
          },
          {
            id: 'reasoning_1',
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Answered directly.' }],
          },
        ],
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens_details: { reasoning_tokens: 2 },
        },
      });
    });
    const adapter = new OpenAIResponsesAdapter(fetcher);

    await expect(adapter.invoke(request(provider.providerId), provider)).resolves.toEqual(
      {
        text: 'Hello back.',
        reasoningSummary: 'Answered directly.',
        toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { query: 'hello' } }],
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          cachedInputTokens: 4,
          reasoningTokens: 2,
        },
        finishReason: 'tool_calls',
        providerContinuation: {
          providerId: provider.providerId,
          responseId: 'resp_contract',
        },
      },
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/v1/responses');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer fake-openai-contract-credential',
    );
  });

  it('normalizes Responses API server-sent events', async () => {
    const provider = context();
    const frames = [
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      {
        type: 'response.function_call_arguments.done',
        item_id: 'call_1',
        name: 'lookup',
        arguments: '{"query":"hello"}',
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_stream',
          status: 'completed',
          output: [],
          usage: { input_tokens: 4, output_tokens: 3 },
        },
      },
    ];
    const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
    const fetcher: GatewayFetch = async () =>
      new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    const events = [];

    for await (const event of new OpenAIResponsesAdapter(fetcher).stream(
      request(provider.providerId, true),
      provider,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text.delta', text: 'Hel' },
      { type: 'text.delta', text: 'lo' },
      {
        type: 'tool.proposed',
        call: { id: 'call_1', name: 'lookup', arguments: { query: 'hello' } },
      },
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 3 } },
      {
        type: 'done',
        finishReason: 'stop',
        providerContinuation: {
          providerId: provider.providerId,
          responseId: 'resp_stream',
        },
      },
    ]);
  });

  it('discovers models conservatively and surfaces HTTP status without response bodies', async () => {
    const provider = context();
    const adapter = new OpenAIResponsesAdapter(async () =>
      Response.json({
        object: 'list',
        data: [{ id: 'gpt-example', object: 'model', owned_by: 'openai' }],
      }),
    );
    await expect(adapter.discoverModels(provider)).resolves.toMatchObject([
      {
        ref: `${provider.providerId}:gpt-example`,
        modelId: 'gpt-example',
        privacyClass: 'remote',
        tags: ['owner:openai'],
      },
    ]);

    const rejected = new OpenAIResponsesAdapter(
      async () => new Response('provider-sensitive-error-body', { status: 401 }),
    );
    await expect(rejected.invoke(request(provider.providerId), provider)).rejects.toEqual(
      new ProviderHttpError(401),
    );
  });
});

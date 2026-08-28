import type { ModelRequest } from '@builderhelm/protocol';
import { createId, utcNow } from '@builderhelm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  OllamaAdapter,
  type GatewayFetch,
  type ProviderInvocationContext,
} from '../src/index.js';

function context(credential = '') {
  return {
    providerId: createId(),
    baseUrl: null,
    credential,
    headers: {},
    signal: new AbortController().signal,
  } satisfies ProviderInvocationContext;
}

function request(providerId: string, stream = false): ModelRequest {
  return {
    modelRef: `${providerId}:qwen3:8b`,
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
    reasoning: 'low',
    dataClassifications: ['public'],
    maxOutputTokens: 200,
    stream,
  };
}

describe('Ollama adapter', () => {
  it('uses the local native chat API without inventing an authorization header', async () => {
    const provider = context();
    const fetcher = vi.fn<GatewayFetch>(async (input, init) => {
      expect(String(input)).toBe('http://127.0.0.1:11434/api/chat');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'qwen3:8b',
        stream: false,
        think: 'low',
        options: { num_predict: 200 },
        format: { type: 'object' },
      });
      return Response.json({
        model: 'qwen3:8b',
        message: {
          role: 'assistant',
          content: 'Checking.',
          thinking: 'private provider reasoning',
          tool_calls: [{ function: { name: 'lookup', arguments: { query: 'hello' } } }],
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 9,
        eval_count: 3,
      });
    });

    await expect(
      new OllamaAdapter(fetcher).invoke(request(provider.providerId), provider),
    ).resolves.toEqual({
      text: 'Checking.',
      toolCalls: [{ id: 'ollama-tool-0', name: 'lookup', arguments: { query: 'hello' } }],
      usage: { inputTokens: 9, outputTokens: 3 },
      finishReason: 'tool_calls',
    });
  });

  it('normalizes native newline-delimited streaming and requires a done record', async () => {
    const provider = context('remote-ollama-token');
    const records = [
      { model: 'qwen3:8b', message: { content: 'Hel' }, done: false },
      { model: 'qwen3:8b', message: { content: 'lo' }, done: false },
      {
        model: 'qwen3:8b',
        message: {
          content: '',
          tool_calls: [{ function: { name: 'lookup', arguments: { query: 'x' } } }],
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 4,
        eval_count: 2,
      },
    ];
    const events = [];
    for await (const event of new OllamaAdapter(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer remote-ollama-token',
      );
      return new Response(records.map((record) => JSON.stringify(record)).join('\n'));
    }).stream(request(provider.providerId, true), provider)) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'text.delta', text: 'Hel' },
      { type: 'text.delta', text: 'lo' },
      {
        type: 'tool.proposed',
        call: { id: 'ollama-tool-0', name: 'lookup', arguments: { query: 'x' } },
      },
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
      { type: 'done', finishReason: 'tool_calls' },
    ]);

    const consume = async () => {
      for await (const event of new OllamaAdapter(
        async () => new Response('{"message":{"content":"partial"},"done":false}\n'),
      ).stream(request(provider.providerId, true), provider)) {
        expect(event.type).toBe('text.delta');
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('discovers local models with useful non-sensitive tags', async () => {
    const provider = context();
    const adapter = new OllamaAdapter(async (input) => {
      expect(String(input)).toBe('http://127.0.0.1:11434/api/tags');
      return Response.json({
        models: [
          {
            name: 'qwen3:8b',
            details: {
              family: 'qwen3',
              parameter_size: '8.2B',
              quantization_level: 'Q4_K_M',
            },
          },
        ],
      });
    });
    await expect(adapter.discoverModels(provider)).resolves.toMatchObject([
      {
        modelId: 'qwen3:8b',
        privacyClass: 'local',
        tags: ['family:qwen3', 'parameters:8.2B', 'quantization:Q4_K_M'],
      },
    ]);
  });
});

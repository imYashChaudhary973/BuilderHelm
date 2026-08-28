import type { GatewayFetch } from '@builderhelm/model-gateway';
import type { ChatClientStreamEvent } from '@builderhelm/protocol';
import { createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapCore, MemorySecretStore, type CoreRuntime } from '../src/index.js';

const runtimes: CoreRuntime[] = [];

function providerInput(apiKey: string) {
  return {
    label: 'OpenAI',
    protocol: 'openai' as const,
    baseUrl: 'https://api.example.test/v1',
    headers: [],
    privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
    enabled: true,
    apiKey,
  };
}

function serverSentEvents(frames: readonly unknown[]): Response {
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

async function configure(runtime: CoreRuntime, apiKey = 'chat-stream-test-key') {
  const provider = await runtime.providers.create(
    providerInput(apiKey),
    createCorrelationId(),
  );
  const [model] = await runtime.models.discover(provider.id, createCorrelationId());
  if (model === undefined) throw new Error('Expected a discovered test model');
  return model;
}

async function collect(
  stream: AsyncIterable<ChatClientStreamEvent>,
): Promise<ChatClientStreamEvent[]> {
  const events: ChatClientStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

afterEach(() => {
  while (runtimes.length > 0) runtimes.pop()?.close();
});

describe('streamed chat service', () => {
  it('streams canonical history and persists the assistant response before completion', async () => {
    const secret = 'stream-secret-sentinel';
    const responseId = 'provider-response-sentinel';
    const prompt = 'private-prompt-sentinel';
    const logs: string[] = [];
    let responseRequest: Record<string, unknown> | undefined;
    const fetcher = vi.fn<GatewayFetch>(async (input, init) => {
      const url = String(input);
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${secret}`);
      if (url.endsWith('/models')) {
        return Response.json({ data: [{ id: 'gpt-stream', owned_by: 'openai' }] });
      }
      responseRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return serverSentEvents([
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Concise answer.' },
        { type: 'response.output_text.delta', delta: 'back.' },
        {
          type: 'response.completed',
          response: {
            id: responseId,
            status: 'completed',
            output: [],
            usage: {
              input_tokens: 7,
              output_tokens: 2,
              input_tokens_details: { cached_tokens: 1 },
            },
          },
        },
      ]);
    });
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
      logSink: (line) => logs.push(line),
      modelGatewayFetch: fetcher,
    });
    runtimes.push(runtime);
    const model = await configure(runtime, secret);
    const thread = runtime.chats.create({ title: 'Streaming' }, createCorrelationId());

    const events = await collect(
      runtime.chats.stream(
        { threadId: thread.id, modelRef: model.ref, text: prompt },
        createCorrelationId(),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello ' },
      { type: 'reasoning.summary', text: 'Concise answer.' },
      { type: 'text.delta', text: 'back.' },
      {
        type: 'usage',
        usage: { inputTokens: 7, outputTokens: 2, cachedInputTokens: 1 },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(JSON.stringify(events)).not.toContain(responseId);
    expect(responseRequest).toMatchObject({
      model: 'gpt-stream',
      store: false,
      stream: true,
    });
    expect(responseRequest?.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ]);

    const transcript = runtime.chats.get(thread.id);
    expect(transcript.turns).toHaveLength(2);
    expect(transcript.turns[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello back.' }],
      modelRef: model.ref,
      finishReason: 'stop',
      providerContinuation: { providerId: model.providerId, responseId },
    });
    expect(transcript.usage).toEqual([
      expect.objectContaining({
        turnId: transcript.turns[1]?.id,
        modelRef: model.ref,
        usage: { inputTokens: 7, outputTokens: 2, cachedInputTokens: 1 },
      }),
    ]);
    expect(logs.join('\n')).not.toContain(secret);
    expect(logs.join('\n')).not.toContain(prompt);
    expect(logs.join('\n')).not.toContain(responseId);
  });

  it('aborts the provider request and persists a partial cancelled response', async () => {
    const encoder = new TextEncoder();
    const fetcher: GatewayFetch = async (input, init) => {
      if (String(input).endsWith('/models')) {
        return Response.json({ data: [{ id: 'gpt-stream' }] });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'response.output_text.delta',
                  delta: 'Partial',
                })}\n\n`,
              ),
            );
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    };
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
      modelGatewayFetch: fetcher,
    });
    runtimes.push(runtime);
    const model = await configure(runtime);
    const thread = runtime.chats.create({}, createCorrelationId());
    const controller = new AbortController();
    const chatStream = runtime.chats.stream(
      { threadId: thread.id, modelRef: model.ref, text: 'Cancel me' },
      createCorrelationId(),
      controller.signal,
    );
    const iterator = chatStream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'text.delta', text: 'Partial' },
    });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'done', finishReason: 'cancelled' },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });

    expect(runtime.chats.get(thread.id).turns).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        content: [{ type: 'text', text: 'Partial' }],
        finishReason: 'cancelled',
      }),
    ]);
  });

  it('returns a stable provider error without exposing its response body', async () => {
    const providerBody = 'provider-private-error-body';
    const logs: string[] = [];
    const fetcher: GatewayFetch = async (input) =>
      String(input).endsWith('/models')
        ? Response.json({ data: [{ id: 'gpt-stream' }] })
        : new Response(providerBody, { status: 500 });
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
      logSink: (line) => logs.push(line),
      modelGatewayFetch: fetcher,
    });
    runtimes.push(runtime);
    const model = await configure(runtime);
    const thread = runtime.chats.create({}, createCorrelationId());

    await expect(
      collect(
        runtime.chats.stream(
          { threadId: thread.id, modelRef: model.ref, text: 'Hello' },
          createCorrelationId(),
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      message: 'The provider is temporarily unavailable',
    });
    expect(runtime.chats.get(thread.id).turns).toEqual([
      expect.objectContaining({ role: 'user' }),
    ]);
    expect(logs.join('\n')).not.toContain(providerBody);
  });
});

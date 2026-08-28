import {
  jsonValueSchema,
  type ChatStreamEvent,
  type FinishReason,
  type JsonValue,
  type ModelContentPart,
  type ModelRecord,
  type ModelRequest,
  type ModelResponse,
  type NormalizedToolCall,
  type TokenUsage,
  type ZeroMessage,
} from '@builderhelm/protocol';
import { BuilderHelmError } from '@builderhelm/shared';
import { z } from 'zod';

import type {
  ProviderAdapter,
  ProviderConnectionResult,
  ProviderInvocationContext,
} from '../adapter.js';
import {
  ProviderHttpError,
  providerEndpoint,
  readServerSentEvents,
  type GatewayFetch,
} from '../http.js';

const usageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z
      .object({ cached_tokens: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
    completion_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const toolCallSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).passthrough(),
  })
  .passthrough();

const responseSchema = z
  .object({
    id: z.string().min(1),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable(),
            message: z
              .object({
                content: z.string().nullable().optional(),
                refusal: z.string().nullable().optional(),
                tool_calls: z.array(toolCallSchema).optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: usageSchema.nullable().optional(),
  })
  .passthrough();

const modelsSchema = z
  .object({
    data: z
      .array(
        z
          .object({ id: z.string().min(1), owned_by: z.string().optional() })
          .passthrough(),
      )
      .max(10_000),
  })
  .passthrough();

const streamChunkSchema = z
  .object({
    id: z.string().min(1),
    choices: z.array(
      z
        .object({
          finish_reason: z.string().nullable().optional(),
          delta: z
            .object({
              content: z.string().nullable().optional(),
              refusal: z.string().nullable().optional(),
              tool_calls: z
                .array(
                  z
                    .object({
                      index: z.number().int().nonnegative(),
                      id: z.string().optional(),
                      function: z
                        .object({
                          name: z.string().optional(),
                          arguments: z.string().optional(),
                        })
                        .passthrough()
                        .optional(),
                    })
                    .passthrough(),
                )
                .optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    usage: usageSchema.nullable().optional(),
  })
  .passthrough();

function endpoint(context: ProviderInvocationContext, path: string): URL {
  if (context.baseUrl === null) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'OpenAI-compatible providers require an explicit base URL',
    );
  }
  return providerEndpoint(context.baseUrl, path);
}

function requestHeaders(context: ProviderInvocationContext): HeadersInit {
  return {
    ...context.headers,
    Authorization: `Bearer ${context.credential}`,
    'Content-Type': 'application/json',
  };
}

function invalidMessage(message: string): never {
  throw new BuilderHelmError('VALIDATION_FAILED', message);
}

function contentPart(part: ModelContentPart, role: ZeroMessage['role']): JsonValue {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'image') {
    if (role !== 'user') return invalidMessage('Images are only valid in user messages');
    if (part.source.kind !== 'url') {
      return invalidMessage('Attachment images must be resolved before invocation');
    }
    return { type: 'image_url', image_url: { url: part.source.url } };
  }
  return invalidMessage('Message content is not valid for this role');
}

function messages(request: ModelRequest): JsonValue[] {
  const result: JsonValue[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool_result') {
          return invalidMessage('Tool messages may only contain tool results');
        }
        result.push({
          role: 'tool',
          tool_call_id: part.callId,
          content: JSON.stringify(part.output),
        });
      }
      continue;
    }

    const content = message.content
      .filter((part) => part.type === 'text' || part.type === 'image')
      .map((part) => contentPart(part, message.role));
    const calls = message.content.filter((part) => part.type === 'tool_call');
    if (message.content.some((part) => part.type === 'tool_result')) {
      return invalidMessage('Tool results must use the tool role');
    }
    if (calls.length > 0 && message.role !== 'assistant') {
      return invalidMessage('Tool calls are only valid in assistant messages');
    }
    result.push({
      role: message.role,
      content: content.length === 0 && calls.length > 0 ? null : content,
      ...(calls.length === 0
        ? {}
        : {
            tool_calls: calls.map((part) => ({
              id: part.call.id,
              type: 'function',
              function: {
                name: part.call.name,
                arguments: JSON.stringify(part.call.arguments),
              },
            })),
          }),
    });
  }
  return result;
}

function requestBody(request: ModelRequest, stream: boolean): JsonValue {
  return {
    model: request.modelRef.slice(request.modelRef.indexOf(':') + 1),
    messages: messages(request),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_tokens: request.maxOutputTokens }),
    ...(request.reasoning === undefined || request.reasoning === 'none'
      ? {}
      : { reasoning_effort: request.reasoning }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }),
    ...(request.responseSchema === undefined
      ? {}
      : {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'builderhelm_response',
              strict: true,
              schema: request.responseSchema,
            },
          },
        }),
  };
}

function parseArguments(value: string): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(value));
  } catch (cause) {
    throw new BuilderHelmError(
      'TOOL_SCHEMA_INVALID',
      'Provider returned invalid tool arguments',
      {
        cause,
      },
    );
  }
}

function usage(value: z.infer<typeof usageSchema>): TokenUsage {
  return {
    inputTokens: value.prompt_tokens,
    outputTokens: value.completion_tokens,
    ...(value.prompt_tokens_details?.cached_tokens === undefined
      ? {}
      : { cachedInputTokens: value.prompt_tokens_details.cached_tokens }),
    ...(value.completion_tokens_details?.reasoning_tokens === undefined
      ? {}
      : { reasoningTokens: value.completion_tokens_details.reasoning_tokens }),
  };
}

function finishReason(value: string | null | undefined): FinishReason {
  if (value === 'stop') return 'stop';
  if (value === 'length') return 'length';
  if (value === 'tool_calls' || value === 'function_call') return 'tool_calls';
  if (value === 'content_filter') return 'content_filter';
  return 'unknown';
}

function normalizeResponse(raw: unknown, providerId: string): ModelResponse {
  const response = responseSchema.parse(raw);
  const choice = response.choices[0]!;
  const toolCalls = (choice.message.tool_calls ?? []).map((call): NormalizedToolCall => ({
    id: call.id,
    name: call.function.name,
    arguments: parseArguments(call.function.arguments),
  }));
  return {
    text: choice.message.content ?? choice.message.refusal ?? '',
    toolCalls,
    ...(response.usage === null || response.usage === undefined
      ? {}
      : { usage: usage(response.usage) }),
    finishReason: finishReason(choice.finish_reason),
    providerContinuation: { providerId, responseId: response.id },
  };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProviderHttpError(response.status);
  return response.json() as Promise<unknown>;
}

interface PendingToolCall {
  id: string | undefined;
  name: string | undefined;
  arguments: string;
}

export class OpenAIChatCompletionsAdapter implements ProviderAdapter {
  readonly protocol = 'openai-compatible' as const;

  constructor(private readonly fetcher: GatewayFetch = fetch) {}

  async invoke(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): Promise<ModelResponse> {
    const response = await this.fetcher(endpoint(context, 'chat/completions'), {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(requestBody(request, false)),
      signal: context.signal,
    });
    return normalizeResponse(await responseJson(response), context.providerId);
  }

  async *stream(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): AsyncIterable<ChatStreamEvent> {
    const response = await this.fetcher(endpoint(context, 'chat/completions'), {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(requestBody(request, true)),
      signal: context.signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);

    const pending = new Map<number, PendingToolCall>();
    let responseId: string | undefined;
    let completed: FinishReason | undefined;
    let normalizedUsage: TokenUsage | undefined;
    for await (const raw of readServerSentEvents(response.body)) {
      const chunk = streamChunkSchema.parse(raw);
      responseId = chunk.id;
      if (chunk.usage !== null && chunk.usage !== undefined)
        normalizedUsage = usage(chunk.usage);
      for (const choice of chunk.choices) {
        if (choice.delta.content !== null && choice.delta.content !== undefined) {
          yield { type: 'text.delta', text: choice.delta.content };
        }
        if (choice.delta.refusal !== null && choice.delta.refusal !== undefined) {
          yield { type: 'text.delta', text: choice.delta.refusal };
        }
        for (const delta of choice.delta.tool_calls ?? []) {
          const call = pending.get(delta.index) ?? {
            id: undefined,
            name: undefined,
            arguments: '',
          };
          call.id = delta.id ?? call.id;
          call.name = delta.function?.name ?? call.name;
          call.arguments += delta.function?.arguments ?? '';
          pending.set(delta.index, call);
        }
        if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
          completed = finishReason(choice.finish_reason);
        }
      }
    }

    if (responseId === undefined || completed === undefined) {
      throw new BuilderHelmError(
        'MODEL_UNAVAILABLE',
        'Provider response stream ended early',
      );
    }
    for (const [index, call] of [...pending].sort(([left], [right]) => left - right)) {
      if (call.id === undefined || call.name === undefined) {
        throw new BuilderHelmError(
          'MODEL_UNAVAILABLE',
          'Provider returned an incomplete tool call',
        );
      }
      yield {
        type: 'tool.proposed',
        call: { id: call.id, name: call.name, arguments: parseArguments(call.arguments) },
      };
      pending.delete(index);
    }
    if (normalizedUsage !== undefined) yield { type: 'usage', usage: normalizedUsage };
    yield {
      type: 'done',
      finishReason: completed,
      providerContinuation: { providerId: context.providerId, responseId },
    };
  }

  async discoverModels(context: ProviderInvocationContext): Promise<ModelRecord[]> {
    const response = await this.fetcher(endpoint(context, 'models'), {
      method: 'GET',
      headers: requestHeaders(context),
      signal: context.signal,
    });
    const models = modelsSchema.parse(await responseJson(response));
    return models.data.map((model) => ({
      ref: `${context.providerId}:${model.id}`,
      providerId: context.providerId,
      modelId: model.id,
      label: model.id,
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
      },
      privacyClass: 'remote',
      tags: model.owned_by === undefined ? [] : [`owner:${model.owned_by}`],
    }));
  }

  async testConnection(
    context: ProviderInvocationContext,
  ): Promise<ProviderConnectionResult> {
    const startedAt = performance.now();
    const response = await this.fetcher(endpoint(context, 'models'), {
      method: 'GET',
      headers: requestHeaders(context),
      signal: context.signal,
    });
    await responseJson(response);
    return {
      ok: true,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}

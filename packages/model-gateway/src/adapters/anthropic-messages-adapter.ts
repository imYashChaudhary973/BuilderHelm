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
} from '@zero/protocol';
import { ZeroError } from '@zero/shared';
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

const anthropicApiBaseUrl = 'https://api.anthropic.com/v1';
const anthropicApiVersion = '2023-06-01';
const defaultMaxOutputTokens = 4_096;
const modelDiscoveryLimit = 10_000;
const modelPageSize = 1_000;

const capabilitySupportSchema = z.object({ supported: z.boolean() }).passthrough();

const anthropicCapabilitiesSchema = z
  .object({
    image_input: capabilitySupportSchema.optional(),
    structured_outputs: capabilitySupportSchema.optional(),
    effort: z.object({ supported: z.boolean() }).passthrough().optional(),
  })
  .passthrough();

const anthropicUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    output_tokens_details: z
      .object({ thinking_tokens: z.number().int().nonnegative() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const anthropicContentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const anthropicResponseSchema = z
  .object({
    id: z.string().min(1),
    content: z.array(anthropicContentBlockSchema),
    stop_reason: z.string().nullable(),
    usage: anthropicUsageSchema,
  })
  .passthrough();

const anthropicModelsSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: z.string().min(1),
            display_name: z.string().min(1).optional(),
            created_at: z.string().optional(),
            max_input_tokens: z.number().int().positive().nullable().optional(),
            max_tokens: z.number().int().positive().nullable().optional(),
            capabilities: anthropicCapabilitiesSchema.nullable().optional(),
          })
          .passthrough(),
      )
      .max(modelDiscoveryLimit),
    has_more: z.boolean().optional().default(false),
    last_id: z.string().min(1).nullable().optional(),
  })
  .passthrough();

const streamEventSchema = z.object({ type: z.string() }).passthrough();
const anthropicToolNameSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

function requestHeaders(context: ProviderInvocationContext): HeadersInit {
  return {
    ...context.headers,
    'x-api-key': context.credential,
    'anthropic-version': anthropicApiVersion,
    'Content-Type': 'application/json',
  };
}

function endpoint(context: ProviderInvocationContext, path: string): URL {
  return providerEndpoint(context.baseUrl ?? anthropicApiBaseUrl, path);
}

function invalidMessage(message: string): never {
  throw new ZeroError('VALIDATION_FAILED', message);
}

function userContent(part: ModelContentPart): JsonValue {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'image') {
    if (part.source.kind !== 'url') {
      return invalidMessage('Attachment images must be resolved before invocation');
    }
    return {
      type: 'image',
      source: { type: 'url', url: part.source.url },
    };
  }
  if (part.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: part.callId,
      content: JSON.stringify(part.output),
      is_error: part.isError,
    };
  }
  return invalidMessage('Tool calls are only valid in assistant messages');
}

function assistantContent(part: ModelContentPart): JsonValue {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'tool_call') {
    return {
      type: 'tool_use',
      id: part.call.id,
      name: anthropicToolNameSchema.parse(part.call.name),
      input: part.call.arguments,
    };
  }
  return invalidMessage('Assistant messages may only contain text and tool calls');
}

function systemContent(messages: readonly ZeroMessage[]): JsonValue[] {
  return messages
    .filter((message) => message.role === 'system')
    .flatMap((message) =>
      message.content.map((part) => {
        if (part.type !== 'text') {
          return invalidMessage('Anthropic system messages may only contain text');
        }
        return { type: 'text', text: part.text } satisfies JsonValue;
      }),
    );
}

function messageContent(message: ZeroMessage): JsonValue[] {
  if (message.role === 'assistant') return message.content.map(assistantContent);

  const toolResults = message.content.filter((part) => part.type === 'tool_result');
  const remaining = message.content.filter((part) => part.type !== 'tool_result');
  return [...toolResults, ...remaining].map(userContent);
}

function toolInputSchema(value: JsonValue): JsonValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value.type !== 'object'
  ) {
    throw new ZeroError(
      'VALIDATION_FAILED',
      'Anthropic tool input schemas must be JSON objects with type object',
    );
  }
  return value;
}

function requestBody(request: ModelRequest, stream: boolean): JsonValue {
  const system = systemContent(request.messages);
  const messages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: messageContent(message),
    }));
  if (messages.length === 0) {
    throw new ZeroError(
      'VALIDATION_FAILED',
      'Anthropic requests require at least one user or assistant message',
    );
  }

  return {
    model: request.modelRef.slice(request.modelRef.indexOf(':') + 1),
    max_tokens: request.maxOutputTokens ?? defaultMaxOutputTokens,
    messages,
    stream,
    ...(system.length === 0 ? {} : { system }),
    ...(request.responseSchema === undefined &&
    (request.reasoning === undefined || request.reasoning === 'none')
      ? {}
      : {
          output_config: {
            ...(request.reasoning === undefined || request.reasoning === 'none'
              ? {}
              : { effort: request.reasoning }),
            ...(request.responseSchema === undefined
              ? {}
              : {
                  format: {
                    type: 'json_schema',
                    schema: request.responseSchema,
                  },
                }),
          },
        }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            name: anthropicToolNameSchema.parse(tool.name),
            description: tool.description,
            input_schema: toolInputSchema(tool.inputSchema),
          })),
        }),
  };
}

function usage(value: z.infer<typeof anthropicUsageSchema>): TokenUsage {
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    ...(value.cache_read_input_tokens === undefined
      ? {}
      : { cachedInputTokens: value.cache_read_input_tokens }),
    ...(value.output_tokens_details?.thinking_tokens === undefined
      ? {}
      : { reasoningTokens: value.output_tokens_details.thinking_tokens }),
  };
}

function finishReason(reason: string | null): FinishReason {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') {
    return 'length';
  }
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'refusal') return 'content_filter';
  return 'unknown';
}

function parseToolInput(value: unknown): JsonValue {
  try {
    return jsonValueSchema.parse(value);
  } catch (cause) {
    throw new ZeroError(
      'TOOL_SCHEMA_INVALID',
      'Provider returned invalid tool arguments',
      { cause },
    );
  }
}

function parsePartialToolInput(value: string): JsonValue {
  try {
    return parseToolInput(JSON.parse(value));
  } catch (cause) {
    if (cause instanceof ZeroError) throw cause;
    throw new ZeroError(
      'TOOL_SCHEMA_INVALID',
      'Provider returned invalid tool arguments',
      { cause },
    );
  }
}

function normalizeResponse(raw: unknown, providerId: string): ModelResponse {
  const response = anthropicResponseSchema.parse(raw);
  const text: string[] = [];
  const toolCalls: NormalizedToolCall[] = [];

  for (const content of response.content) {
    if (content.type === 'text') {
      text.push(z.object({ text: z.string() }).parse(content).text);
    } else if (content.type === 'tool_use') {
      const tool = z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          input: z.unknown(),
        })
        .parse(content);
      toolCalls.push({
        id: tool.id,
        name: tool.name,
        arguments: parseToolInput(tool.input),
      });
    }
  }

  return {
    text: text.join(''),
    toolCalls,
    usage: usage(response.usage),
    finishReason: finishReason(response.stop_reason),
    providerContinuation: { providerId, responseId: response.id },
  };
}

function streamFailure(raw: unknown): ZeroError {
  const type = z
    .object({ error: z.object({ type: z.string() }).passthrough() })
    .safeParse(raw);
  if (!type.success) {
    return new ZeroError('MODEL_UNAVAILABLE', 'Anthropic response stream failed');
  }
  if (type.data.error.type === 'rate_limit_error') {
    return new ZeroError('RATE_LIMITED', 'Provider rate limit reached', {
      retryable: true,
    });
  }
  if (
    type.data.error.type === 'authentication_error' ||
    type.data.error.type === 'permission_error'
  ) {
    return new ZeroError('AUTH_FAILED', 'Provider authentication failed');
  }
  if (type.data.error.type === 'request_too_large') {
    return new ZeroError('CONTEXT_TOO_LARGE', 'The model context is too large');
  }
  return new ZeroError('MODEL_UNAVAILABLE', 'Anthropic response stream failed', {
    retryable:
      type.data.error.type === 'overloaded_error' || type.data.error.type === 'api_error',
  });
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProviderHttpError(response.status);
  return response.json() as Promise<unknown>;
}

interface PendingToolCall {
  readonly id: string;
  readonly name: string;
  readonly initialInput: unknown;
  partialJson: string;
}

export class AnthropicMessagesAdapter implements ProviderAdapter {
  readonly protocol = 'anthropic' as const;

  constructor(private readonly fetcher: GatewayFetch = fetch) {}

  async invoke(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): Promise<ModelResponse> {
    const response = await this.fetcher(endpoint(context, 'messages'), {
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
    const response = await this.fetcher(endpoint(context, 'messages'), {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(requestBody(request, true)),
      signal: context.signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);

    let messageId: string | undefined;
    let finalUsage: TokenUsage | undefined;
    let finalReason: FinishReason = 'unknown';
    let completed = false;
    const pendingTools = new Map<number, PendingToolCall>();

    for await (const raw of readServerSentEvents(response.body)) {
      const event = streamEventSchema.parse(raw);
      if (event.type === 'message_start') {
        const started = z
          .object({
            message: z.object({
              id: z.string().min(1),
              usage: anthropicUsageSchema,
            }),
          })
          .parse(event).message;
        messageId = started.id;
        finalUsage = usage(started.usage);
      } else if (event.type === 'content_block_start') {
        const started = z
          .object({
            index: z.number().int().nonnegative(),
            content_block: anthropicContentBlockSchema,
          })
          .parse(event);
        if (started.content_block.type === 'tool_use') {
          const tool = z
            .object({
              id: z.string().min(1),
              name: z.string().min(1),
              input: z.unknown().optional(),
            })
            .parse(started.content_block);
          pendingTools.set(started.index, {
            id: tool.id,
            name: tool.name,
            initialInput: tool.input ?? {},
            partialJson: '',
          });
        }
      } else if (event.type === 'content_block_delta') {
        const deltaEvent = z
          .object({
            index: z.number().int().nonnegative(),
            delta: z.object({ type: z.string() }).passthrough(),
          })
          .parse(event);
        if (deltaEvent.delta.type === 'text_delta') {
          const text = z.object({ text: z.string() }).parse(deltaEvent.delta).text;
          yield { type: 'text.delta', text };
        } else if (deltaEvent.delta.type === 'input_json_delta') {
          const pending = pendingTools.get(deltaEvent.index);
          if (pending !== undefined) {
            pending.partialJson += z
              .object({ partial_json: z.string() })
              .parse(deltaEvent.delta).partial_json;
          }
        }
      } else if (event.type === 'content_block_stop') {
        const index = z
          .object({ index: z.number().int().nonnegative() })
          .parse(event).index;
        const pending = pendingTools.get(index);
        if (pending !== undefined) {
          yield {
            type: 'tool.proposed',
            call: {
              id: pending.id,
              name: pending.name,
              arguments:
                pending.partialJson.length === 0
                  ? parseToolInput(pending.initialInput)
                  : parsePartialToolInput(pending.partialJson),
            },
          };
          pendingTools.delete(index);
        }
      } else if (event.type === 'message_delta') {
        const changed = z
          .object({
            delta: z.object({ stop_reason: z.string().nullable().optional() }),
            usage: z
              .object({
                output_tokens: z.number().int().nonnegative(),
                output_tokens_details: z
                  .object({ thinking_tokens: z.number().int().nonnegative() })
                  .passthrough()
                  .nullable()
                  .optional(),
              })
              .passthrough(),
          })
          .parse(event);
        finalReason = finishReason(changed.delta.stop_reason ?? null);
        finalUsage = {
          inputTokens: finalUsage?.inputTokens ?? 0,
          outputTokens: changed.usage.output_tokens,
          ...(finalUsage?.cachedInputTokens === undefined
            ? {}
            : { cachedInputTokens: finalUsage.cachedInputTokens }),
          ...(changed.usage.output_tokens_details?.thinking_tokens === undefined
            ? finalUsage?.reasoningTokens === undefined
              ? {}
              : { reasoningTokens: finalUsage.reasoningTokens }
            : {
                reasoningTokens: changed.usage.output_tokens_details.thinking_tokens,
              }),
        };
      } else if (event.type === 'message_stop') {
        if (messageId === undefined) {
          throw new ZeroError('MODEL_UNAVAILABLE', 'Anthropic response stream failed');
        }
        if (pendingTools.size > 0) {
          throw new ZeroError(
            'MODEL_UNAVAILABLE',
            'Anthropic response stream ended with incomplete tool input',
          );
        }
        if (finalUsage !== undefined) yield { type: 'usage', usage: finalUsage };
        completed = true;
        yield {
          type: 'done',
          finishReason: finalReason,
          providerContinuation: {
            providerId: context.providerId,
            responseId: messageId,
          },
        };
      } else if (event.type === 'error') {
        throw streamFailure(event);
      }
    }

    if (!completed) {
      throw new ZeroError('MODEL_UNAVAILABLE', 'Anthropic response stream ended early');
    }
  }

  async discoverModels(context: ProviderInvocationContext): Promise<ModelRecord[]> {
    const discovered: z.infer<typeof anthropicModelsSchema>['data'] = [];
    const cursors = new Set<string>();
    let afterId: string | undefined;

    while (true) {
      const url = endpoint(context, 'models');
      url.searchParams.set('limit', String(modelPageSize));
      if (afterId !== undefined) url.searchParams.set('after_id', afterId);
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: requestHeaders(context),
        signal: context.signal,
      });
      const page = anthropicModelsSchema.parse(await responseJson(response));
      if (discovered.length + page.data.length > modelDiscoveryLimit) {
        throw new ZeroError('VALIDATION_FAILED', 'Provider returned too many models');
      }
      discovered.push(...page.data);
      if (!page.has_more) break;
      if (
        page.last_id === null ||
        page.last_id === undefined ||
        cursors.has(page.last_id)
      ) {
        throw new ZeroError(
          'VALIDATION_FAILED',
          'Provider returned an invalid model pagination cursor',
        );
      }
      cursors.add(page.last_id);
      afterId = page.last_id;
    }

    return discovered.map((model) => ({
      ref: `${context.providerId}:${model.id}`,
      providerId: context.providerId,
      modelId: model.id,
      label: model.display_name ?? model.id,
      capabilities: {
        text: true,
        vision: model.capabilities?.image_input?.supported ?? false,
        audioInput: false,
        toolCalling: false,
        parallelTools: false,
        structuredOutput: model.capabilities?.structured_outputs?.supported ?? false,
        streaming: true,
        reasoningControls: model.capabilities?.effort?.supported ?? false,
        serverWebSearch: false,
        serverMcp: false,
        ...(model.max_input_tokens === null || model.max_input_tokens === undefined
          ? {}
          : { contextWindow: model.max_input_tokens }),
        ...(model.max_tokens === null || model.max_tokens === undefined
          ? {}
          : { maxOutputTokens: model.max_tokens }),
      },
      privacyClass: 'remote',
      tags: model.created_at === undefined ? [] : [`created:${model.created_at}`],
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

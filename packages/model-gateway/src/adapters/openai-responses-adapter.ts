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

const openAIUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({ cached_tokens: z.number().int().nonnegative() })
      .partial()
      .optional(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative() })
      .partial()
      .optional(),
  })
  .passthrough();

const openAIOutputItemSchema = z
  .object({
    id: z.string().optional(),
    call_id: z.string().optional(),
    type: z.string(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    content: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
            refusal: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    summary: z
      .array(z.object({ type: z.string(), text: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();

const openAIResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.string(),
    output: z.array(openAIOutputItemSchema),
    usage: openAIUsageSchema.nullable().optional(),
    incomplete_details: z
      .object({ reason: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const openAIModelsSchema = z
  .object({
    data: z.array(
      z.object({ id: z.string().min(1), owned_by: z.string().optional() }).passthrough(),
    ),
  })
  .passthrough();

const streamEventSchema = z.object({ type: z.string() }).passthrough();

function requestHeaders(context: ProviderInvocationContext): HeadersInit {
  return {
    ...context.headers,
    Authorization: `Bearer ${context.credential}`,
    'Content-Type': 'application/json',
  };
}

function messageContent(part: ModelContentPart): JsonValue | null {
  if (part.type === 'text') return { type: 'input_text', text: part.text };
  if (part.type === 'image') {
    if (part.source.kind !== 'url') {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'Attachment images must be resolved before invocation',
      );
    }
    return { type: 'input_image', image_url: part.source.url };
  }
  return null;
}

function messageItems(message: ZeroMessage): JsonValue[] {
  const items: JsonValue[] = [];
  const content = message.content
    .map(messageContent)
    .filter((part): part is JsonValue => part !== null);
  if (content.length > 0) {
    items.push({ type: 'message', role: message.role, content });
  }
  for (const part of message.content) {
    if (part.type === 'tool_call') {
      items.push({
        type: 'function_call',
        call_id: part.call.id,
        name: part.call.name,
        arguments: JSON.stringify(part.call.arguments),
      });
    } else if (part.type === 'tool_result') {
      items.push({
        type: 'function_call_output',
        call_id: part.callId,
        output: JSON.stringify(part.output),
      });
    }
  }
  return items;
}

function requestBody(request: ModelRequest, stream: boolean): JsonValue {
  const modelId = request.modelRef.slice(request.modelRef.indexOf(':') + 1);
  return {
    model: modelId,
    input: request.messages.flatMap(messageItems),
    store: false,
    stream,
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    ...(request.reasoning === undefined || request.reasoning === 'none'
      ? {}
      : { reasoning: { effort: request.reasoning, summary: 'auto' } }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
        }),
    ...(request.responseSchema === undefined
      ? {}
      : {
          text: {
            format: {
              type: 'json_schema',
              name: 'zero_response',
              schema: request.responseSchema,
              strict: true,
            },
          },
        }),
  };
}

function parseArguments(value: string): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(value));
  } catch (cause) {
    throw new ZeroError(
      'TOOL_SCHEMA_INVALID',
      'Provider returned invalid tool arguments',
      {
        cause,
      },
    );
  }
}

function usage(value: z.infer<typeof openAIUsageSchema>): TokenUsage {
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    ...(value.input_tokens_details?.cached_tokens === undefined
      ? {}
      : { cachedInputTokens: value.input_tokens_details.cached_tokens }),
    ...(value.output_tokens_details?.reasoning_tokens === undefined
      ? {}
      : { reasoningTokens: value.output_tokens_details.reasoning_tokens }),
  };
}

function finishReason(
  response: z.infer<typeof openAIResponseSchema>,
  toolCalls: readonly NormalizedToolCall[],
): FinishReason {
  if (response.status === 'cancelled') return 'cancelled';
  if (response.status === 'failed') return 'error';
  if (response.status === 'incomplete') {
    if (response.incomplete_details?.reason === 'max_output_tokens') return 'length';
    if (response.incomplete_details?.reason === 'content_filter') return 'content_filter';
    return 'unknown';
  }
  return toolCalls.length > 0 ? 'tool_calls' : 'stop';
}

function normalizeResponse(raw: unknown, providerId: string): ModelResponse {
  const response = openAIResponseSchema.parse(raw);
  const text: string[] = [];
  const reasoning: string[] = [];
  const toolCalls: NormalizedToolCall[] = [];

  for (const item of response.output) {
    if (item.type === 'message') {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text' && content.text !== undefined)
          text.push(content.text);
        if (content.type === 'refusal' && content.refusal !== undefined)
          text.push(content.refusal);
      }
    } else if (
      item.type === 'function_call' &&
      item.name !== undefined &&
      item.arguments !== undefined
    ) {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call-${toolCalls.length}`,
        name: item.name,
        arguments: parseArguments(item.arguments),
      });
    } else if (item.type === 'reasoning') {
      reasoning.push(...(item.summary ?? []).map((part) => part.text));
    }
  }

  return {
    text: text.join(''),
    ...(reasoning.length === 0 ? {} : { reasoningSummary: reasoning.join('\n') }),
    toolCalls,
    ...(response.usage === null || response.usage === undefined
      ? {}
      : { usage: usage(response.usage) }),
    finishReason: finishReason(response, toolCalls),
    providerContinuation: { providerId, responseId: response.id },
  };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProviderHttpError(response.status);
  return response.json() as Promise<unknown>;
}

export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly protocol = 'openai' as const;

  constructor(private readonly fetcher: GatewayFetch = fetch) {}

  async invoke(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): Promise<ModelResponse> {
    const response = await this.fetcher(providerEndpoint(context.baseUrl, 'responses'), {
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
    const response = await this.fetcher(providerEndpoint(context.baseUrl, 'responses'), {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(requestBody(request, true)),
      signal: context.signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);

    for await (const raw of readServerSentEvents(response.body)) {
      const event = streamEventSchema.parse(raw);
      if (
        event.type === 'response.output_text.delta' ||
        event.type === 'response.refusal.delta'
      ) {
        const delta = z.object({ delta: z.string() }).parse(event).delta;
        yield { type: 'text.delta', text: delta };
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        const delta = z.object({ delta: z.string() }).parse(event).delta;
        yield { type: 'reasoning.summary', text: delta };
      } else if (event.type === 'response.function_call_arguments.done') {
        const call = z
          .object({ item_id: z.string(), name: z.string(), arguments: z.string() })
          .parse(event);
        yield {
          type: 'tool.proposed',
          call: {
            id: call.item_id,
            name: call.name,
            arguments: parseArguments(call.arguments),
          },
        };
      } else if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete'
      ) {
        const completed = z
          .object({ response: openAIResponseSchema })
          .parse(event).response;
        if (completed.usage !== null && completed.usage !== undefined) {
          yield { type: 'usage', usage: usage(completed.usage) };
        }
        yield {
          type: 'done',
          finishReason: normalizeResponse(completed, context.providerId).finishReason,
        };
      } else if (event.type === 'error' || event.type === 'response.failed') {
        throw new ZeroError('MODEL_UNAVAILABLE', 'OpenAI response stream failed');
      }
    }
  }

  async discoverModels(context: ProviderInvocationContext): Promise<ModelRecord[]> {
    const response = await this.fetcher(providerEndpoint(context.baseUrl, 'models'), {
      method: 'GET',
      headers: requestHeaders(context),
      signal: context.signal,
    });
    const models = openAIModelsSchema.parse(await responseJson(response));
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
    const response = await this.fetcher(providerEndpoint(context.baseUrl, 'models'), {
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

import {
  jsonValueSchema,
  type ChatStreamEvent,
  type FinishReason,
  type JsonValue,
  type ModelRecord,
  type ModelRequest,
  type ModelResponse,
  type NormalizedToolCall,
  type TokenUsage,
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
  readJsonLines,
  type GatewayFetch,
} from '../http.js';

const defaultOllamaBaseUrl = 'http://127.0.0.1:11434';

const toolCallSchema = z
  .object({
    function: z.object({ name: z.string().min(1), arguments: z.unknown() }).passthrough(),
  })
  .passthrough();

const chatResponseSchema = z
  .object({
    model: z.string().optional(),
    created_at: z.string().optional(),
    message: z
      .object({
        content: z.string().default(''),
        thinking: z.string().optional(),
        tool_calls: z.array(toolCallSchema).optional(),
      })
      .passthrough(),
    done: z.boolean(),
    done_reason: z.string().optional(),
    prompt_eval_count: z.number().int().nonnegative().optional(),
    eval_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const tagsSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            name: z.string().min(1),
            model: z.string().min(1).optional(),
            details: z
              .object({
                family: z.string().optional(),
                parameter_size: z.string().optional(),
                quantization_level: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .max(10_000),
  })
  .passthrough();

function endpoint(context: ProviderInvocationContext, path: string): URL {
  return providerEndpoint(context.baseUrl ?? defaultOllamaBaseUrl, path);
}

function requestHeaders(context: ProviderInvocationContext): HeadersInit {
  return {
    ...context.headers,
    ...(context.credential.length === 0
      ? {}
      : { Authorization: `Bearer ${context.credential}` }),
    'Content-Type': 'application/json',
  };
}

function invalidMessage(message: string): never {
  throw new ZeroError('VALIDATION_FAILED', message);
}

function toolNames(request: ModelRequest): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === 'tool_call') names.set(part.call.id, part.call.name);
    }
  }
  return names;
}

function messages(request: ModelRequest): JsonValue[] {
  const names = toolNames(request);
  const result: JsonValue[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool_result') {
          return invalidMessage('Ollama tool messages may only contain tool results');
        }
        const name = names.get(part.callId);
        if (name === undefined) {
          return invalidMessage('Ollama tool results require a matching prior tool call');
        }
        result.push({
          role: 'tool',
          tool_name: name,
          content: JSON.stringify(part.output),
        });
      }
      continue;
    }

    const text: string[] = [];
    const calls: JsonValue[] = [];
    for (const part of message.content) {
      if (part.type === 'text') text.push(part.text);
      else if (part.type === 'tool_call' && message.role === 'assistant') {
        calls.push({
          function: { name: part.call.name, arguments: part.call.arguments },
        });
      } else if (part.type === 'image') {
        return invalidMessage(
          'Ollama image inputs require resolved base64 data and are not available yet',
        );
      } else {
        return invalidMessage('Message content is not valid for this role');
      }
    }
    result.push({
      role: message.role,
      content: text.join(''),
      ...(calls.length === 0 ? {} : { tool_calls: calls }),
    });
  }
  return result;
}

function requestBody(request: ModelRequest, stream: boolean): JsonValue {
  return {
    model: request.modelRef.slice(request.modelRef.indexOf(':') + 1),
    messages: messages(request),
    stream,
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
    ...(request.responseSchema === undefined ? {} : { format: request.responseSchema }),
    ...(request.reasoning === undefined || request.reasoning === 'none'
      ? {}
      : { think: request.reasoning }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { options: { num_predict: request.maxOutputTokens } }),
  };
}

function parseArguments(value: unknown): JsonValue {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return jsonValueSchema.parse(parsed);
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

function toolCalls(
  value: readonly z.infer<typeof toolCallSchema>[],
): NormalizedToolCall[] {
  return value.map((call, index) => ({
    id: `ollama-tool-${index}`,
    name: call.function.name,
    arguments: parseArguments(call.function.arguments),
  }));
}

function usage(value: z.infer<typeof chatResponseSchema>): TokenUsage | undefined {
  if (value.prompt_eval_count === undefined || value.eval_count === undefined) {
    return undefined;
  }
  return { inputTokens: value.prompt_eval_count, outputTokens: value.eval_count };
}

function finishReason(
  value: string | undefined,
  calls: readonly NormalizedToolCall[],
): FinishReason {
  if (calls.length > 0) return 'tool_calls';
  if (value === 'stop') return 'stop';
  if (value === 'length') return 'length';
  if (value === 'cancelled') return 'cancelled';
  return value === undefined ? 'unknown' : 'stop';
}

function normalizeResponse(raw: unknown): ModelResponse {
  const response = chatResponseSchema.parse(raw);
  if (!response.done) {
    throw new ZeroError('MODEL_UNAVAILABLE', 'Ollama returned an incomplete response');
  }
  const calls = toolCalls(response.message.tool_calls ?? []);
  const normalizedUsage = usage(response);
  return {
    text: response.message.content,
    toolCalls: calls,
    ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
    finishReason: finishReason(response.done_reason, calls),
  };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProviderHttpError(response.status);
  return response.json() as Promise<unknown>;
}

export class OllamaAdapter implements ProviderAdapter {
  readonly protocol = 'ollama' as const;

  constructor(private readonly fetcher: GatewayFetch = fetch) {}

  async invoke(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): Promise<ModelResponse> {
    const response = await this.fetcher(endpoint(context, 'api/chat'), {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(requestBody(request, false)),
      signal: context.signal,
    });
    return normalizeResponse(await responseJson(response));
  }

  async *stream(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): AsyncIterable<ChatStreamEvent> {
    const response = await this.fetcher(endpoint(context, 'api/chat'), {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(requestBody(request, true)),
      signal: context.signal,
    });
    if (!response.ok) throw new ProviderHttpError(response.status);

    let final: z.infer<typeof chatResponseSchema> | undefined;
    const pendingCalls: z.infer<typeof toolCallSchema>[] = [];
    for await (const raw of readJsonLines(response.body)) {
      const chunk = chatResponseSchema.parse(raw);
      if (chunk.message.content.length > 0) {
        yield { type: 'text.delta', text: chunk.message.content };
      }
      pendingCalls.push(...(chunk.message.tool_calls ?? []));
      if (chunk.done) final = chunk;
    }
    if (final === undefined) {
      throw new ZeroError('MODEL_UNAVAILABLE', 'Ollama response stream ended early');
    }
    const calls = toolCalls(pendingCalls);
    for (const call of calls) yield { type: 'tool.proposed', call };
    const normalizedUsage = usage(final);
    if (normalizedUsage !== undefined) yield { type: 'usage', usage: normalizedUsage };
    yield { type: 'done', finishReason: finishReason(final.done_reason, calls) };
  }

  async discoverModels(context: ProviderInvocationContext): Promise<ModelRecord[]> {
    const response = await this.fetcher(endpoint(context, 'api/tags'), {
      method: 'GET',
      headers: requestHeaders(context),
      signal: context.signal,
    });
    const tags = tagsSchema.parse(await responseJson(response));
    return tags.models.map((model) => ({
      ref: `${context.providerId}:${model.name}`,
      providerId: context.providerId,
      modelId: model.name,
      label: model.name,
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
      privacyClass: 'local',
      tags: [
        model.details?.family === undefined
          ? undefined
          : `family:${model.details.family}`,
        model.details?.parameter_size === undefined
          ? undefined
          : `parameters:${model.details.parameter_size}`,
        model.details?.quantization_level === undefined
          ? undefined
          : `quantization:${model.details.quantization_level}`,
      ].filter((tag): tag is string => tag !== undefined),
    }));
  }

  async testConnection(
    context: ProviderInvocationContext,
  ): Promise<ProviderConnectionResult> {
    const startedAt = performance.now();
    const response = await this.fetcher(endpoint(context, 'api/tags'), {
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

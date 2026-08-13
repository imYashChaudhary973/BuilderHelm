import { zeroErrorCodes } from '@zero/shared/error';
import { z } from 'zod';

import { jsonValueSchema } from './json.js';

export const modelRefSchema = z
  .string()
  .max(500)
  .regex(/^[^:]+:.+$/);

export const dataClassificationSchema = z.enum([
  'public',
  'personal',
  'sensitive',
  'health',
]);

export const normalizedToolCallSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    arguments: jsonValueSchema,
  })
  .strict();

export const modelContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z
    .object({
      type: z.literal('image'),
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('url'), url: z.url() }).strict(),
        z
          .object({ kind: z.literal('attachment'), attachmentId: z.string().uuid() })
          .strict(),
      ]),
      mediaType: z.string().min(1).max(100),
    })
    .strict(),
  z.object({ type: z.literal('tool_call'), call: normalizedToolCallSchema }).strict(),
  z
    .object({
      type: z.literal('tool_result'),
      callId: z.string().min(1).max(200),
      output: jsonValueSchema,
      isError: z.boolean(),
    })
    .strict(),
]);

export const zeroMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.array(modelContentPartSchema).min(1),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();

export const modelCapabilitiesSchema = z
  .object({
    text: z.boolean(),
    vision: z.boolean(),
    audioInput: z.boolean(),
    toolCalling: z.boolean(),
    parallelTools: z.boolean(),
    structuredOutput: z.boolean(),
    streaming: z.boolean(),
    reasoningControls: z.boolean(),
    serverWebSearch: z.boolean(),
    serverMcp: z.boolean(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

export const modelCapabilityOverridesSchema = z
  .object({
    text: z.boolean().optional(),
    vision: z.boolean().optional(),
    audioInput: z.boolean().optional(),
    toolCalling: z.boolean().optional(),
    parallelTools: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    streaming: z.boolean().optional(),
    reasoningControls: z.boolean().optional(),
    serverWebSearch: z.boolean().optional(),
    serverMcp: z.boolean().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

export const modelCapabilityOverrideRecordSchema = z
  .object({
    modelRef: modelRefSchema,
    overrides: modelCapabilityOverridesSchema,
    updatedAt: z.string().datetime({ offset: false }),
  })
  .strict();

export const modelRecordSchema = z
  .object({
    ref: modelRefSchema,
    providerId: z.string().uuid(),
    modelId: z.string().min(1).max(300),
    label: z.string().min(1).max(300),
    capabilities: modelCapabilitiesSchema,
    privacyClass: z.enum(['local', 'remote']),
    tags: z.array(z.string().min(1).max(100)),
  })
  .strict();

export const toolDefinitionSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4_000),
    inputSchema: jsonValueSchema,
  })
  .strict();

export const modelRequestSchema = z
  .object({
    modelRef: modelRefSchema,
    messages: z.array(zeroMessageSchema).min(1).max(10_000),
    tools: z.array(toolDefinitionSchema).max(128).optional(),
    responseSchema: jsonValueSchema.optional(),
    reasoning: z.enum(['none', 'low', 'medium', 'high']).optional(),
    dataClassifications: z.array(dataClassificationSchema).min(1),
    maxOutputTokens: z.number().int().positive().optional(),
    stream: z.boolean(),
  })
  .strict();

export const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const finishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'cancelled',
  'error',
  'unknown',
]);

export const providerContinuationSchema = z
  .object({
    providerId: z.string().uuid(),
    responseId: z.string().min(1).max(1_000),
  })
  .strict();

export const modelResponseSchema = z
  .object({
    text: z.string(),
    reasoningSummary: z.string().optional(),
    toolCalls: z.array(normalizedToolCallSchema),
    usage: tokenUsageSchema.optional(),
    finishReason: finishReasonSchema,
    providerContinuation: providerContinuationSchema.optional(),
  })
  .strict();

export const modelErrorSchema = z
  .object({
    code: z.enum(zeroErrorCodes),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text.delta'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning.summary'), text: z.string() }).strict(),
  z.object({ type: z.literal('tool.proposed'), call: normalizedToolCallSchema }).strict(),
  z.object({ type: z.literal('usage'), usage: tokenUsageSchema }).strict(),
  z
    .object({
      type: z.literal('done'),
      finishReason: finishReasonSchema,
      providerContinuation: providerContinuationSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('error'), error: modelErrorSchema }).strict(),
]);

export type DataClassification = z.infer<typeof dataClassificationSchema>;
export type NormalizedToolCall = z.infer<typeof normalizedToolCallSchema>;
export type ModelContentPart = z.infer<typeof modelContentPartSchema>;
export type ZeroMessage = z.infer<typeof zeroMessageSchema>;
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export type ModelCapabilityOverrides = z.infer<typeof modelCapabilityOverridesSchema>;
export type ModelCapabilityOverrideRecord = z.infer<
  typeof modelCapabilityOverrideRecordSchema
>;
export type ModelRecord = z.infer<typeof modelRecordSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type FinishReason = z.infer<typeof finishReasonSchema>;
export type ProviderContinuation = z.infer<typeof providerContinuationSchema>;
export type ModelResponse = z.infer<typeof modelResponseSchema>;
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

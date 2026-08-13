import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import {
  finishReasonSchema,
  modelErrorSchema,
  modelContentPartSchema,
  modelRefSchema,
  normalizedToolCallSchema,
  providerContinuationSchema,
  tokenUsageSchema,
} from './model.js';

const chatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
const timestampSchema = z.string().datetime({ offset: false });
const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);
const chatContentSchema = z
  .array(modelContentPartSchema)
  .min(1)
  .max(10_000)
  .refine((content) => JSON.stringify(content).length <= 4_000_000, {
    message: 'Chat turn content exceeds the 4 MB persistence limit',
  });

export const chatThreadSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const chatTurnSchema = z
  .object({
    id: z.string().uuid(),
    threadId: z.string().uuid(),
    ordinal: z.number().int().nonnegative(),
    role: chatRoleSchema,
    content: chatContentSchema,
    modelRef: modelRefSchema.nullable(),
    finishReason: finishReasonSchema.nullable(),
    providerContinuation: providerContinuationSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const chatUsageRecordSchema = z
  .object({
    id: z.string().uuid(),
    threadId: z.string().uuid(),
    turnId: z.string().uuid(),
    providerId: z.string().uuid(),
    modelRef: modelRefSchema,
    usage: tokenUsageSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const chatTranscriptSchema = z
  .object({
    thread: chatThreadSchema,
    turns: z.array(chatTurnSchema),
    usage: z.array(chatUsageRecordSchema),
  })
  .strict();

export const createChatThreadInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict();

export const appendChatTurnInputSchema = z
  .object({
    threadId: z.string().uuid(),
    role: chatRoleSchema,
    content: chatContentSchema,
    modelRef: modelRefSchema.nullable().default(null),
    finishReason: finishReasonSchema.nullable().default(null),
    providerContinuation: providerContinuationSchema.nullable().default(null),
    usage: tokenUsageSchema.nullable().default(null),
  })
  .strict()
  .superRefine((turn, context) => {
    const assistantMetadata = [
      turn.modelRef,
      turn.finishReason,
      turn.providerContinuation,
      turn.usage,
    ];

    if (turn.role === 'assistant') {
      if (turn.modelRef === null) {
        context.addIssue({
          code: 'custom',
          message: 'Assistant turns require the selected model reference',
          path: ['modelRef'],
        });
      } else if (
        !z
          .string()
          .uuid()
          .safeParse(turn.modelRef.slice(0, turn.modelRef.indexOf(':'))).success
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Assistant model references must begin with a provider UUID',
          path: ['modelRef'],
        });
      }
      if (turn.finishReason === null) {
        context.addIssue({
          code: 'custom',
          message: 'Assistant turns require a finish reason',
          path: ['finishReason'],
        });
      }
      if (
        turn.modelRef !== null &&
        turn.providerContinuation !== null &&
        !turn.modelRef.startsWith(`${turn.providerContinuation.providerId}:`)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Continuation provider must match the selected model',
          path: ['providerContinuation', 'providerId'],
        });
      }
      return;
    }

    if (assistantMetadata.some((value) => value !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only assistant turns may include model response metadata',
        path: ['modelRef'],
      });
    }
  });

export const appendedChatTurnSchema = z
  .object({
    turn: chatTurnSchema,
    usage: chatUsageRecordSchema.nullable(),
  })
  .strict();

export const chatStreamInputSchema = z
  .object({
    threadId: z.string().uuid(),
    modelRef: modelRefSchema,
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const chatThreadInputSchema = z.object({ threadId: z.string().uuid() }).strict();
export const chatStreamCancelInputSchema = z
  .object({ runId: z.string().uuid() })
  .strict();

export const chatListRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const chatCreateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: createChatThreadInputSchema })
  .strict();
export const chatGetRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: chatThreadInputSchema })
  .strict();
export const chatStreamStartRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    runId: z.string().uuid(),
    input: chatStreamInputSchema,
  })
  .strict();
export const chatStreamCancelRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: chatStreamCancelInputSchema })
  .strict();

export const chatClientStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text.delta'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning.summary'), text: z.string() }).strict(),
  z.object({ type: z.literal('tool.proposed'), call: normalizedToolCallSchema }).strict(),
  z.object({ type: z.literal('usage'), usage: tokenUsageSchema }).strict(),
  z.object({ type: z.literal('done'), finishReason: finishReasonSchema }).strict(),
  z.object({ type: z.literal('error'), error: modelErrorSchema }).strict(),
]);

export const chatStreamEnvelopeSchema = z
  .object({ runId: z.string().uuid(), event: chatClientStreamEventSchema })
  .strict();

export const chatThreadListResponseSchema = z.array(chatThreadSchema);
export const chatStreamStartResultSchema = z
  .object({ runId: z.string().uuid() })
  .strict();
export const chatStreamCancelResultSchema = z.object({ cancelled: z.boolean() }).strict();

function ipcResponse<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const chatThreadListIpcResponseSchema = ipcResponse(chatThreadListResponseSchema);
export const chatThreadIpcResponseSchema = ipcResponse(chatThreadSchema);
export const chatTranscriptIpcResponseSchema = ipcResponse(chatTranscriptSchema);
export const chatStreamStartIpcResponseSchema = ipcResponse(chatStreamStartResultSchema);
export const chatStreamCancelIpcResponseSchema = ipcResponse(
  chatStreamCancelResultSchema,
);

export type ChatThread = z.infer<typeof chatThreadSchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type ChatUsageRecord = z.infer<typeof chatUsageRecordSchema>;
export type ChatTranscript = z.infer<typeof chatTranscriptSchema>;
export type CreateChatThreadInput = z.input<typeof createChatThreadInputSchema>;
export type AppendChatTurnInput = z.input<typeof appendChatTurnInputSchema>;
export type AppendedChatTurn = z.infer<typeof appendedChatTurnSchema>;
export type ChatStreamInput = z.infer<typeof chatStreamInputSchema>;
export type ChatClientStreamEvent = z.infer<typeof chatClientStreamEventSchema>;
export type ChatStreamEnvelope = z.infer<typeof chatStreamEnvelopeSchema>;

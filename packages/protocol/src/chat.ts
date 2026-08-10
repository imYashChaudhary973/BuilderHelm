import { z } from 'zod';

import {
  finishReasonSchema,
  modelContentPartSchema,
  modelRefSchema,
  providerContinuationSchema,
  tokenUsageSchema,
} from './model.js';

const chatRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
const timestampSchema = z.string().datetime({ offset: false });
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

export type ChatThread = z.infer<typeof chatThreadSchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type ChatUsageRecord = z.infer<typeof chatUsageRecordSchema>;
export type ChatTranscript = z.infer<typeof chatTranscriptSchema>;
export type CreateChatThreadInput = z.input<typeof createChatThreadInputSchema>;
export type AppendChatTurnInput = z.input<typeof appendChatTurnInputSchema>;
export type AppendedChatTurn = z.infer<typeof appendedChatTurnSchema>;

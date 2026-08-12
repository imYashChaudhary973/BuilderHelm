import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { modelErrorSchema, modelRefSchema, tokenUsageSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const knowledgeVaultSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(300),
    noteCount: z.number().int().nonnegative(),
    lastIndexedAt: z.string().datetime({ offset: false }).nullable(),
    createdAt: z.string().datetime({ offset: false }),
    updatedAt: z.string().datetime({ offset: false }),
  })
  .strict();

export const knowledgeCitationSchema = z
  .object({
    sourceId: z.string().uuid(),
    chunkId: z.string().uuid(),
    vaultId: z.string().uuid(),
    notePath: z.string().min(1).max(4_096),
    title: z.string().min(1).max(500),
    heading: z.string().min(1).max(500).nullable(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    excerpt: z.string().min(1).max(4_000),
  })
  .strict()
  .superRefine((citation, context) => {
    if (citation.lineEnd < citation.lineStart) {
      context.addIssue({
        code: 'custom',
        message: 'Citation line range is invalid',
        path: ['lineEnd'],
      });
    }
  });

export const knowledgeSearchResultSchema = z
  .object({
    citation: knowledgeCitationSchema,
    score: z.number().finite(),
  })
  .strict();

export const knowledgeAnswerSchema = z
  .object({
    answer: z.string(),
    citations: z.array(knowledgeCitationSchema).max(20),
    usage: tokenUsageSchema.optional(),
    finishReason: z
      .enum([
        'stop',
        'length',
        'tool_calls',
        'content_filter',
        'cancelled',
        'error',
        'unknown',
      ])
      .optional(),
  })
  .strict();

export const knowledgeSourceViewSchema = z
  .object({
    sourceId: z.string().uuid(),
    chunkId: z.string().uuid(),
    vaultId: z.string().uuid(),
    notePath: z.string().min(1).max(4_096),
    title: z.string().min(1).max(500),
    heading: z.string().min(1).max(500).nullable(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    content: z.string().max(2_000_000),
  })
  .strict();

export const knowledgeVaultListInputSchema = z.object({}).strict();
export const knowledgeVaultSyncInputSchema = z
  .object({ vaultId: z.string().uuid() })
  .strict();
export const knowledgeQueryInputSchema = z
  .object({
    vaultId: z.string().uuid(),
    query: z.string().trim().min(1).max(2_000),
    modelRef: modelRefSchema,
    maxSources: z.number().int().min(1).max(20).default(8),
  })
  .strict();
export const knowledgeSourceInputSchema = z
  .object({ sourceId: z.string().uuid(), chunkId: z.string().uuid() })
  .strict();

export const knowledgeVaultListRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: knowledgeVaultListInputSchema })
  .strict();
export const knowledgeVaultSelectRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const knowledgeVaultSyncRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: knowledgeVaultSyncInputSchema })
  .strict();
export const knowledgeQueryRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: knowledgeQueryInputSchema })
  .strict();
export const knowledgeSourceRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: knowledgeSourceInputSchema })
  .strict();

export const knowledgeVaultListResponseSchema = z.array(knowledgeVaultSchema);
export const knowledgeVaultMutationResponseSchema = knowledgeVaultSchema;
export const knowledgeVaultSelectResponseSchema = knowledgeVaultSchema.nullable();
export const knowledgeAnswerResponseSchema = knowledgeAnswerSchema;
export const knowledgeSourceResponseSchema = knowledgeSourceViewSchema;

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const knowledgeVaultListIpcResponseSchema = ipcResult(
  knowledgeVaultListResponseSchema,
);
export const knowledgeVaultMutationIpcResponseSchema = ipcResult(
  knowledgeVaultMutationResponseSchema,
);
export const knowledgeVaultSelectIpcResponseSchema = ipcResult(
  knowledgeVaultSelectResponseSchema,
);
export const knowledgeAnswerIpcResponseSchema = ipcResult(knowledgeAnswerResponseSchema);
export const knowledgeSourceIpcResponseSchema = ipcResult(knowledgeSourceResponseSchema);

export type KnowledgeVault = z.infer<typeof knowledgeVaultSchema>;
export type KnowledgeCitation = z.infer<typeof knowledgeCitationSchema>;
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchResultSchema>;
export type KnowledgeAnswer = z.infer<typeof knowledgeAnswerSchema>;
export type KnowledgeSourceView = z.infer<typeof knowledgeSourceViewSchema>;
export type KnowledgeVaultListInput = z.infer<typeof knowledgeVaultListInputSchema>;
export type KnowledgeVaultSyncInput = z.infer<typeof knowledgeVaultSyncInputSchema>;
export type KnowledgeQueryInput = z.infer<typeof knowledgeQueryInputSchema>;
export type KnowledgeSourceInput = z.infer<typeof knowledgeSourceInputSchema>;

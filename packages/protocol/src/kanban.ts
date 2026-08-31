import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const kanbanColumnSchema = z.enum([
  'idea',
  'doing',
  'review',
  'shipped',
  'cancelled',
]);
export type KanbanColumn = z.infer<typeof kanbanColumnSchema>;
export const kanbanCardSourceSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('github'),
      id: z.string().min(1).max(200),
      url: z.string().url().max(2_048),
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      number: z.number().int().positive(),
      state: z.enum(['open', 'closed']),
      syncedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      provider: z.literal('linear'),
      id: z.string().min(1).max(200),
      url: z.string().url().max(2_048),
      identifier: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/i),
      number: z.number().int().positive(),
      state: z.enum(['open', 'closed']),
      syncedAt: z.string().datetime(),
    })
    .strict(),
]);
export type KanbanCardSource = z.infer<typeof kanbanCardSourceSchema>;

export const kanbanProjectSchema = z
  .object({
    id: z.string().min(1).max(4096),
    name: z.string().trim().min(1).max(120),
    taskCount: z.number().int().nonnegative(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type KanbanProject = z.infer<typeof kanbanProjectSchema>;

export const kanbanCardSchema = z
  .object({
    id: z.string().uuid(),
    workspace: z.string().min(1).max(4096),
    title: z.string().trim().min(1).max(200),
    detail: z.string().max(10_000).nullable(),
    column: kanbanColumnSchema,
    source: kanbanCardSourceSchema.nullable(),
    linkedRunId: z.string().uuid().nullable(),
    createdAt: z.string().min(1),
  })
  .strict();
export type KanbanCard = z.infer<typeof kanbanCardSchema>;

export const kanbanProjectListInputSchema = z.object({}).strict();
export type KanbanProjectListInput = z.infer<typeof kanbanProjectListInputSchema>;

export const kanbanProjectCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export type KanbanProjectCreateInput = z.infer<typeof kanbanProjectCreateInputSchema>;

export const kanbanListInputSchema = z
  .object({
    workspace: z.string().min(1).max(4096),
  })
  .strict();
export type KanbanListInput = z.infer<typeof kanbanListInputSchema>;

export const kanbanCreateInputSchema = z
  .object({
    workspace: z.string().min(1).max(4096),
    title: z.string().trim().min(1).max(200),
    column: kanbanColumnSchema.optional(),
  })
  .strict();
export type KanbanCreateInput = z.infer<typeof kanbanCreateInputSchema>;

export const kanbanUpdateInputSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type KanbanUpdateInput = z.infer<typeof kanbanUpdateInputSchema>;

export const kanbanDeleteInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
export type KanbanDeleteInput = z.infer<typeof kanbanDeleteInputSchema>;

export const kanbanMoveInputSchema = z
  .object({
    id: z.string().uuid(),
    column: kanbanColumnSchema,
  })
  .strict();
export type KanbanMoveInput = z.infer<typeof kanbanMoveInputSchema>;
export const kanbanLinkRunInputSchema = z
  .object({
    cardId: z.string().uuid(),
    runId: z.string().uuid(),
  })
  .strict();
export type KanbanLinkRunInput = z.infer<typeof kanbanLinkRunInputSchema>;

export const kanbanProjectListRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanProjectListInputSchema,
  })
  .strict();
export const kanbanProjectCreateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanProjectCreateInputSchema,
  })
  .strict();

export const kanbanListRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanListInputSchema,
  })
  .strict();
export const kanbanCreateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanCreateInputSchema,
  })
  .strict();
export const kanbanMoveRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanMoveInputSchema,
  })
  .strict();
export const kanbanUpdateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanUpdateInputSchema,
  })
  .strict();
export const kanbanDeleteRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanDeleteInputSchema,
  })
  .strict();
export const kanbanLinkRunRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: kanbanLinkRunInputSchema,
  })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const kanbanProjectListIpcResponseSchema = ipcResult(z.array(kanbanProjectSchema));
export const kanbanProjectCreateIpcResponseSchema = ipcResult(kanbanProjectSchema);

export const kanbanListIpcResponseSchema = ipcResult(z.array(kanbanCardSchema));
export const kanbanCreateIpcResponseSchema = ipcResult(kanbanCardSchema);
export const kanbanMoveIpcResponseSchema = ipcResult(kanbanCardSchema);
export const kanbanUpdateIpcResponseSchema = ipcResult(kanbanCardSchema);
export const kanbanLinkRunIpcResponseSchema = ipcResult(kanbanCardSchema);
export const kanbanDeleteIpcResponseSchema = ipcResult(
  z.object({ deleted: z.literal(true) }).strict(),
);

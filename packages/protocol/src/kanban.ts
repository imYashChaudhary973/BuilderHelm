import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const kanbanColumnSchema = z.enum(['idea', 'doing', 'shipped']);
export type KanbanColumn = z.infer<typeof kanbanColumnSchema>;

export const kanbanCardSchema = z
  .object({
    id: z.string().uuid(),
    workspace: z.string().min(1).max(4096),
    title: z.string().trim().min(1).max(200),
    column: kanbanColumnSchema,
    createdAt: z.string().min(1),
  })
  .strict();
export type KanbanCard = z.infer<typeof kanbanCardSchema>;

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
  })
  .strict();
export type KanbanCreateInput = z.infer<typeof kanbanCreateInputSchema>;

export const kanbanMoveInputSchema = z
  .object({
    id: z.string().uuid(),
    column: kanbanColumnSchema,
  })
  .strict();
export type KanbanMoveInput = z.infer<typeof kanbanMoveInputSchema>;

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

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const kanbanListIpcResponseSchema = ipcResult(z.array(kanbanCardSchema));
export const kanbanCreateIpcResponseSchema = ipcResult(kanbanCardSchema);
export const kanbanMoveIpcResponseSchema = ipcResult(kanbanCardSchema);

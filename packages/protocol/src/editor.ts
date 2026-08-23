import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const editorFileSchema = z
  .object({
    path: z.string().min(1).max(4096),
    name: z.string().min(1).max(4096),
    text: z.string(),
  })
  .strict();
export type EditorFile = z.infer<typeof editorFileSchema>;

export const editorReadInputSchema = z
  .object({
    path: z.string().min(1).max(4096),
  })
  .strict();
export type EditorReadInput = z.infer<typeof editorReadInputSchema>;

export const editorPickRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
  })
  .strict();

export const editorReadRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorReadInputSchema,
  })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const editorPickIpcResponseSchema = ipcResult(editorFileSchema.nullable());
export const editorReadIpcResponseSchema = ipcResult(editorFileSchema);

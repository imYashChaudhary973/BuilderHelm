import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const noteSchema = z
  .object({
    id: z.string().uuid(),
    workspace: z.string().min(1).max(4_096),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(100_000),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type Note = z.infer<typeof noteSchema>;

export const noteListInputSchema = z
  .object({
    workspace: z.string().min(1).max(4_096),
  })
  .strict();
export type NoteListInput = z.infer<typeof noteListInputSchema>;

export const noteCreateInputSchema = z
  .object({
    workspace: z.string().min(1).max(4_096),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type NoteCreateInput = z.infer<typeof noteCreateInputSchema>;

export const noteSaveInputSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(100_000),
  })
  .strict();
export type NoteSaveInput = z.infer<typeof noteSaveInputSchema>;

export const noteDeleteInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
export type NoteDeleteInput = z.infer<typeof noteDeleteInputSchema>;

export const noteListRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: noteListInputSchema })
  .strict();
export const noteCreateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: noteCreateInputSchema })
  .strict();
export const noteSaveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: noteSaveInputSchema })
  .strict();
export const noteDeleteRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: noteDeleteInputSchema })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const noteListIpcResponseSchema = ipcResult(z.array(noteSchema));
export const noteCreateIpcResponseSchema = ipcResult(noteSchema);
export const noteSaveIpcResponseSchema = ipcResult(noteSchema);
export const noteDeleteIpcResponseSchema = ipcResult(
  z.object({ deleted: z.literal(true) }),
);

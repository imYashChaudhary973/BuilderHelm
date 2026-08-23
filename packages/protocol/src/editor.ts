import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';
import { gitCommitSchema } from './projects.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

const pathSchema = z.string().min(1).max(4096);

export const editorFileSchema = z
  .object({
    path: pathSchema,
    name: pathSchema,
    text: z.string(),
  })
  .strict();
export type EditorFile = z.infer<typeof editorFileSchema>;

export const editorEntrySchema = z
  .object({
    path: pathSchema,
    name: z.string().min(1).max(255),
    kind: z.enum(['file', 'dir']),
  })
  .strict();
export type EditorEntry = z.infer<typeof editorEntrySchema>;

export const editorGitChangeSchema = z
  .object({
    path: pathSchema,
    code: z.string().min(1).max(2),
    staged: z.boolean(),
  })
  .strict();

export const editorGitSchema = z
  .object({
    rootPath: pathSchema,
    directoryName: z.string().min(1).max(255),
    branch: z.string().min(1).max(255),
    headSha: z.string().regex(/^[0-9a-f]{40,64}$/),
    dirtyCount: z.number().int().nonnegative(),
    aheadCount: z.number().int().nonnegative(),
    behindCount: z.number().int().nonnegative(),
    commits: z.array(gitCommitSchema),
    changes: z.array(editorGitChangeSchema),
  })
  .strict();
export type EditorGit = z.infer<typeof editorGitSchema>;

export const editorReadInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema,
  })
  .strict();
export type EditorReadInput = z.infer<typeof editorReadInputSchema>;

export const editorListInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema.optional(),
    hidden: z.boolean().optional(),
  })
  .strict();
export type EditorListInput = z.infer<typeof editorListInputSchema>;

export const editorGitInputSchema = z
  .object({
    root: pathSchema,
  })
  .strict();
export type EditorGitInput = z.infer<typeof editorGitInputSchema>;

export const editorWriteInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema,
    text: z.string().max(1_000_000),
  })
  .strict();
export type EditorWriteInput = z.infer<typeof editorWriteInputSchema>;

export const editorCreateInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema,
    kind: z.enum(['file', 'dir']),
  })
  .strict();
export type EditorCreateInput = z.infer<typeof editorCreateInputSchema>;

export const editorSearchInputSchema = z
  .object({
    root: pathSchema,
    query: z.string().trim().min(1).max(80),
    hidden: z.boolean().optional(),
  })
  .strict();
export type EditorSearchInput = z.infer<typeof editorSearchInputSchema>;

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

export const editorListRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorListInputSchema,
  })
  .strict();

export const editorGitRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorGitInputSchema,
  })
  .strict();

export const editorWriteRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorWriteInputSchema,
  })
  .strict();

export const editorCreateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorCreateInputSchema,
  })
  .strict();

export const editorSearchRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorSearchInputSchema,
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
export const editorListIpcResponseSchema = ipcResult(z.array(editorEntrySchema));
export const editorGitIpcResponseSchema = ipcResult(editorGitSchema.nullable());
export const editorWriteIpcResponseSchema = ipcResult(editorFileSchema);
export const editorCreateIpcResponseSchema = ipcResult(editorEntrySchema);
export const editorSearchIpcResponseSchema = ipcResult(z.array(editorEntrySchema));

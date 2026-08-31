import type { CorrelationId } from '@builderhelm/shared';
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
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();

/** A revision the panel may compare against, or list commits from. */
export const gitRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // No leading dash, no whitespace, no `..`: a ref cannot become a git argument
  // or a range of its own.
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((value) => !value.startsWith('-') && !value.includes('..'), {
    message: 'Not a usable git ref',
  });

export const editorGitSchema = z
  .object({
    rootPath: pathSchema,
    directoryName: z.string().min(1).max(255),
    branch: z.string().min(1).max(255),
    headSha: z.string().regex(/^[0-9a-f]{40,64}$/),
    /** HEAD is not on a branch, so the panel names the commit instead. */
    detached: z.boolean(),
    /** Tracking branch as `remote/name`, or null when the branch is local only. */
    upstream: z.string().min(1).max(255).nullable(),
    dirtyCount: z.number().int().nonnegative(),
    aheadCount: z.number().int().nonnegative(),
    behindCount: z.number().int().nonnegative(),
    /** Reachable commit count, so the list can say "50 +" without loading them. */
    commitTotal: z.number().int().nonnegative(),
    /** Selectable base refs: local branches first, then remote-tracking ones. */
    branches: z.array(gitRefSchema).max(200),
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
/** Files touched by one commit, loaded only when a reviewer expands its row. */
export const editorGitCommitFilesInputSchema = z
  .object({
    root: pathSchema,
    sha: z.string().regex(/^[0-9a-f]{7,64}$/),
  })
  .strict();
export type EditorGitCommitFilesInput = z.infer<typeof editorGitCommitFilesInputSchema>;

export const editorGitCommitFileSchema = z
  .object({
    path: pathSchema,
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();
export type EditorGitCommitFile = z.infer<typeof editorGitCommitFileSchema>;

export const editorGitInputSchema = z
  .object({
    root: pathSchema,
    base: gitRefSchema.nullable().default(null),
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

export const editorGitStageInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema.optional(),
    staged: z.boolean(),
  })
  .strict();
export type EditorGitStageInput = z.infer<typeof editorGitStageInputSchema>;

export const editorGitCommitInputSchema = z
  .object({
    root: pathSchema,
    message: z.string().trim().min(1).max(500),
  })
  .strict();
export type EditorGitCommitInput = z.infer<typeof editorGitCommitInputSchema>;

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

export const editorGitCommitFilesRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorGitCommitFilesInputSchema,
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

export const editorGitStageRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorGitStageInputSchema,
  })
  .strict();

export const editorGitCommitRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: editorGitCommitInputSchema,
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
export const editorGitCommitFilesIpcResponseSchema = ipcResult(
  z.array(editorGitCommitFileSchema).max(500),
);
export const editorWriteIpcResponseSchema = ipcResult(editorFileSchema);
export const editorCreateIpcResponseSchema = ipcResult(editorEntrySchema);
export const editorSearchIpcResponseSchema = ipcResult(z.array(editorEntrySchema));
export const editorGitStageIpcResponseSchema = ipcResult(editorGitSchema);
export const editorGitCommitIpcResponseSchema = ipcResult(editorGitSchema);

import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

const pathSchema = z.string().min(1).max(4096);
export const gitShaSchema = z.string().regex(/^[0-9a-f]{40,64}$/);

export const reviewDiffLineSchema = z
  .object({
    type: z.enum(['ctx', 'add', 'del']),
    oldLine: z.number().int().positive().nullable(),
    newLine: z.number().int().positive().nullable(),
    text: z.string().max(4_000),
  })
  .strict();
export type ReviewDiffLine = z.infer<typeof reviewDiffLineSchema>;

export const reviewDiffHunkSchema = z
  .object({
    header: z.string().max(200),
    oldStart: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    lines: z.array(reviewDiffLineSchema).max(4_000),
  })
  .strict();
export type ReviewDiffHunk = z.infer<typeof reviewDiffHunkSchema>;

export const reviewDiffFileSchema = z
  .object({
    path: pathSchema,
    hunks: z.array(reviewDiffHunkSchema).max(500),
  })
  .strict();
export type ReviewDiffFile = z.infer<typeof reviewDiffFileSchema>;

export const reviewCommentSchema = z
  .object({
    id: z.string().uuid(),
    rootPath: pathSchema,
    headSha: gitShaSchema,
    path: pathSchema,
    side: z.enum(['old', 'new']),
    line: z.number().int().positive(),
    body: z.string().trim().min(1).max(4_000),
    runId: z.string().uuid().nullable(),
    seatId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const reviewCheckSchema = z
  .object({
    id: z.string().uuid(),
    rootPath: pathSchema,
    headSha: gitShaSchema,
    command: z.array(z.string().min(1).max(256)).min(1).max(32),
    exitCode: z.number().int(),
    output: z.string().max(32_000),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
  })
  .strict();
export type ReviewCheck = z.infer<typeof reviewCheckSchema>;

export const reviewConflictKindSchema = z.enum([
  'clean',
  'unmerged',
  'diverged',
  'headMoved',
]);
export type ReviewConflictKind = z.infer<typeof reviewConflictKindSchema>;

export const reviewLandInspectSchema = z
  .object({
    branch: z.string().min(1).max(255),
    base: z.string().min(1).max(255),
    headSha: gitShaSchema,
    reviewedHead: gitShaSchema,
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    unmerged: z.array(pathSchema).max(500),
    kind: reviewConflictKindSchema,
  })
  .strict();
export type ReviewLandInspect = z.infer<typeof reviewLandInspectSchema>;

export const reviewPrSchema = z
  .object({
    title: z.string().min(1).max(256),
    body: z.string().max(10_000),
    base: z.string().min(1).max(255),
    head: z.string().min(1).max(255),
    url: z.string().max(2_000).nullable(),
    draft: z.boolean(),
  })
  .strict();
export type ReviewPr = z.infer<typeof reviewPrSchema>;

export const reviewCiCheckSchema = z
  .object({
    name: z.string().min(1).max(200),
    state: z.string().min(1).max(40),
    url: z.string().max(2_000).nullable(),
  })
  .strict();
export type ReviewCiCheck = z.infer<typeof reviewCiCheckSchema>;

/**
 * CI is read through the pull request for the branch, so the head GitHub
 * tested is not automatically the head that was reviewed. Both are reported
 * and `stale` says they disagree, rather than showing green for a commit
 * nobody looked at.
 */
export const reviewCiSchema = z
  .object({
    reviewedHead: gitShaSchema.nullable(),
    prHead: gitShaSchema.nullable(),
    stale: z.boolean(),
    checks: z.array(reviewCiCheckSchema).max(100),
  })
  .strict();
export type ReviewCi = z.infer<typeof reviewCiSchema>;

export const reviewDiffInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema.optional(),
    base: z.string().min(1).max(255).optional(),
    head: z.string().min(1).max(255).optional(),
  })
  .strict();
export type ReviewDiffInput = z.infer<typeof reviewDiffInputSchema>;

export const reviewCommentCreateInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema,
    side: z.enum(['old', 'new']),
    line: z.number().int().positive(),
    body: z.string().trim().min(1).max(4_000),
    runId: z.string().uuid().nullable().optional(),
    seatId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type ReviewCommentCreateInput = z.infer<typeof reviewCommentCreateInputSchema>;

export const reviewCommentListInputSchema = z
  .object({
    root: pathSchema,
    path: pathSchema.optional(),
  })
  .strict();
export type ReviewCommentListInput = z.infer<typeof reviewCommentListInputSchema>;

export const reviewCheckRunInputSchema = z
  .object({
    root: pathSchema,
    command: z.array(z.string().min(1).max(256)).min(1).max(32),
  })
  .strict();
export type ReviewCheckRunInput = z.infer<typeof reviewCheckRunInputSchema>;

export const reviewCheckListInputSchema = z
  .object({
    root: pathSchema,
  })
  .strict();
export type ReviewCheckListInput = z.infer<typeof reviewCheckListInputSchema>;

export const reviewPrDraftInputSchema = z
  .object({
    root: pathSchema,
    title: z.string().trim().min(1).max(256),
    body: z.string().max(10_000),
    base: z.string().min(1).max(255).optional(),
  })
  .strict();
export type ReviewPrDraftInput = z.infer<typeof reviewPrDraftInputSchema>;

export const reviewCiInputSchema = z
  .object({ root: pathSchema, reviewedHead: gitShaSchema.optional() })
  .strict();
export type ReviewCiInput = z.infer<typeof reviewCiInputSchema>;

export const reviewLandInspectInputSchema = z
  .object({
    root: pathSchema,
    branch: z.string().min(1).max(255),
    reviewedHead: gitShaSchema,
  })
  .strict();
export type ReviewLandInspectInput = z.infer<typeof reviewLandInspectInputSchema>;

function request<T extends z.ZodType>(input: T) {
  return z.object({ correlationId: correlationIdSchema, input }).strict();
}

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const reviewDiffRequestSchema = request(reviewDiffInputSchema);
export const reviewCommentCreateRequestSchema = request(reviewCommentCreateInputSchema);
export const reviewCommentListRequestSchema = request(reviewCommentListInputSchema);
export const reviewCheckRunRequestSchema = request(reviewCheckRunInputSchema);
export const reviewCheckListRequestSchema = request(reviewCheckListInputSchema);
export const reviewPrDraftRequestSchema = request(reviewPrDraftInputSchema);
export const reviewCiRequestSchema = request(reviewCiInputSchema);
export const reviewLandInspectRequestSchema = request(reviewLandInspectInputSchema);

export const reviewDiffIpcResponseSchema = ipcResult(
  z.array(reviewDiffFileSchema).max(200),
);
export const reviewCommentCreateIpcResponseSchema = ipcResult(reviewCommentSchema);
export const reviewCommentListIpcResponseSchema = ipcResult(
  z.array(reviewCommentSchema).max(500),
);
export const reviewCheckRunIpcResponseSchema = ipcResult(reviewCheckSchema);
export const reviewCheckListIpcResponseSchema = ipcResult(
  z.array(reviewCheckSchema).max(100),
);
export const reviewPrDraftIpcResponseSchema = ipcResult(reviewPrSchema);
export const reviewCiIpcResponseSchema = ipcResult(reviewCiSchema);
export const reviewLandInspectIpcResponseSchema = ipcResult(reviewLandInspectSchema);

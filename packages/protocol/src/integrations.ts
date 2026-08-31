import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { kanbanCardSchema } from './kanban.js';
import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);
const githubIssueUrlSchema = z.string().url().max(2_048);

export const githubIssueStateSchema = z.enum(['open', 'closed']);
export type GitHubIssueState = z.infer<typeof githubIssueStateSchema>;

export const githubIssueSchema = z
  .object({
    id: z.string().min(1).max(200),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    number: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(10_000),
    url: githubIssueUrlSchema,
    state: githubIssueStateSchema,
    updatedAt: z.string().datetime(),
    importedCardId: z.string().uuid().nullable(),
    importedWorkspaceId: z.string().min(1).max(4_096).nullable(),
  })
  .strict();
export type GitHubIssue = z.infer<typeof githubIssueSchema>;

export const githubIssueReceiptOutcomeSchema = z.enum([
  'succeeded',
  'failed',
  'outcome_unknown',
]);
export const githubIssueReceiptSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    correlationId: correlationIdSchema,
    cardId: z.string().uuid(),
    issueId: z.string().min(1).max(200),
    issueUrl: githubIssueUrlSchema,
    requestedState: githubIssueStateSchema,
    outcome: githubIssueReceiptOutcomeSchema,
    changed: z.boolean(),
    detail: z.string().min(1).max(500),
    createdAt: z.string().datetime(),
  })
  .strict();
export type GitHubIssueReceipt = z.infer<typeof githubIssueReceiptSchema>;

export const githubIssueListInputSchema = z.object({}).strict();
export type GitHubIssueListInput = z.infer<typeof githubIssueListInputSchema>;
export const githubIssueImportInputSchema = z
  .object({
    workspace: z.string().min(1).max(4_096),
    url: githubIssueUrlSchema,
  })
  .strict();
export type GitHubIssueImportInput = z.infer<typeof githubIssueImportInputSchema>;
export const githubIssueSyncInputSchema = z
  .object({
    cardId: z.string().uuid(),
    state: githubIssueStateSchema,
    requestId: z.string().uuid(),
  })
  .strict();
export type GitHubIssueSyncInput = z.infer<typeof githubIssueSyncInputSchema>;

export const githubIssueSyncResultSchema = z
  .object({
    card: kanbanCardSchema,
    receipt: githubIssueReceiptSchema,
  })
  .strict();
export type GitHubIssueSyncResult = z.infer<typeof githubIssueSyncResultSchema>;

export const githubIssueListRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: githubIssueListInputSchema })
  .strict();
export const githubIssueImportRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: githubIssueImportInputSchema })
  .strict();
export const githubIssueSyncRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: githubIssueSyncInputSchema })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const githubIssueListIpcResponseSchema = ipcResult(z.array(githubIssueSchema));
export const githubIssueImportIpcResponseSchema = ipcResult(kanbanCardSchema);
export const githubIssueSyncIpcResponseSchema = ipcResult(githubIssueSyncResultSchema);

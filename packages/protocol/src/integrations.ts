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

const linearIssueUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const host = new URL(value).hostname;
      return host === 'linear.app' || host.endsWith('.linear.app');
    } catch {
      return false;
    }
  }, 'Use a linear.app issue URL');

export const linearIssueSchema = z
  .object({
    id: z.string().min(1).max(200),
    identifier: z
      .string()
      .regex(/^[A-Z][A-Z0-9]*-\d+$/i, 'Use a Linear identifier such as ENG-41'),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(10_000),
    url: linearIssueUrlSchema,
    state: githubIssueStateSchema,
    updatedAt: z.string().datetime(),
    importedCardId: z.string().uuid().nullable(),
    importedWorkspaceId: z.string().min(1).max(4_096).nullable(),
  })
  .strict();
export type LinearIssue = z.infer<typeof linearIssueSchema>;

export const linearIssueReceiptSchema = githubIssueReceiptSchema;
export type LinearIssueReceipt = GitHubIssueReceipt;

export const linearIssueListInputSchema = z.object({}).strict();
export type LinearIssueListInput = z.infer<typeof linearIssueListInputSchema>;
export const linearIssueImportInputSchema = z
  .object({
    workspace: z.string().min(1).max(4_096),
    url: linearIssueUrlSchema,
  })
  .strict();
export type LinearIssueImportInput = z.infer<typeof linearIssueImportInputSchema>;
export const linearIssueSyncInputSchema = githubIssueSyncInputSchema;
export type LinearIssueSyncInput = GitHubIssueSyncInput;

export const linearIssueSyncResultSchema = z
  .object({
    card: kanbanCardSchema,
    receipt: linearIssueReceiptSchema,
  })
  .strict();
export type LinearIssueSyncResult = z.infer<typeof linearIssueSyncResultSchema>;

export const linearApiKeySchema = z
  .string()
  .trim()
  .min(20)
  .max(500)
  .regex(/^\S+$/, 'The Linear API key cannot contain spaces');
export const linearKeySaveInputSchema = z
  .object({
    key: linearApiKeySchema,
  })
  .strict();
export type LinearKeySaveInput = z.infer<typeof linearKeySaveInputSchema>;
export const linearKeyDeleteInputSchema = z.object({}).strict();
export type LinearKeyDeleteInput = z.infer<typeof linearKeyDeleteInputSchema>;
export const linearStatusSchema = z
  .object({
    configured: z.boolean(),
  })
  .strict();
export type LinearStatus = z.infer<typeof linearStatusSchema>;

export const linearIssueListRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: linearIssueListInputSchema })
  .strict();
export const linearIssueImportRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: linearIssueImportInputSchema })
  .strict();
export const linearIssueSyncRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: linearIssueSyncInputSchema })
  .strict();
export const linearKeySaveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: linearKeySaveInputSchema })
  .strict();
export const linearKeyDeleteRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: linearKeyDeleteInputSchema })
  .strict();
export const linearStatusRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: z.object({}).strict() })
  .strict();

export const linearIssueListIpcResponseSchema = ipcResult(z.array(linearIssueSchema));
export const linearIssueImportIpcResponseSchema = ipcResult(kanbanCardSchema);
export const linearIssueSyncIpcResponseSchema = ipcResult(linearIssueSyncResultSchema);
export const linearStatusIpcResponseSchema = ipcResult(linearStatusSchema);
export const linearKeySaveIpcResponseSchema = ipcResult(linearStatusSchema);
export const linearKeyDeleteIpcResponseSchema = ipcResult(linearStatusSchema);

import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';
import { projectDecisionSchema, projectSchema, taskSchema } from './actions.js';

const timestampSchema = z.string().datetime({ offset: false });
const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const gitCommitSchema = z
  .object({
    sha: z.string().regex(/^[0-9a-f]{40,64}$/),
    shortSha: z.string().regex(/^[0-9a-f]{7,16}$/),
    subject: z.string().trim().min(1).max(500),
    authorName: z.string().trim().min(1).max(200),
    authoredAt: timestampSchema,
  })
  .strict();

export const projectRepositorySchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    rootPath: z.string().min(1).max(4096),
    directoryName: z.string().trim().min(1).max(255),
    branch: z.string().trim().min(1).max(255),
    headSha: z.string().regex(/^[0-9a-f]{40,64}$/),
    dirtyCount: z.number().int().nonnegative(),
    aheadCount: z.number().int().nonnegative(),
    behindCount: z.number().int().nonnegative(),
    lastSyncedAt: timestampSchema,
    commits: z.array(gitCommitSchema).max(30),
  })
  .strict();

export const projectTimelineItemSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(['commit', 'task', 'decision']),
    title: z.string().trim().min(1).max(500),
    detail: z.string().trim().max(1_000).nullable(),
    occurredAt: timestampSchema,
    state: z.string().trim().max(100).nullable(),
  })
  .strict();

export const projectDashboardSchema = z
  .object({
    project: projectSchema,
    tasks: z.array(taskSchema).max(500),
    decisions: z.array(projectDecisionSchema).max(20),
    repository: projectRepositorySchema.nullable(),
    timeline: z.array(projectTimelineItemSchema).max(100),
  })
  .strict();

export const projectDashboardSnapshotSchema = z
  .object({
    generatedAt: timestampSchema,
    projects: z.array(projectDashboardSchema).max(500),
  })
  .strict();

export const projectDashboardInputSchema = z.object({}).strict();
export const projectRepositorySelectInputSchema = z
  .object({ projectId: z.string().uuid() })
  .strict();
export const projectRepositoryRefreshInputSchema = z
  .object({ repositoryId: z.string().uuid() })
  .strict();

export const projectDashboardRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: projectDashboardInputSchema })
  .strict();
export const projectRepositorySelectRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: projectRepositorySelectInputSchema,
  })
  .strict();
export const projectRepositoryRefreshRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: projectRepositoryRefreshInputSchema,
  })
  .strict();

function ipcResponse<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const projectDashboardIpcResponseSchema = ipcResponse(
  projectDashboardSnapshotSchema,
);
export const projectRepositorySelectIpcResponseSchema = ipcResponse(
  projectDashboardSchema.nullable(),
);
export const projectRepositoryRefreshIpcResponseSchema =
  ipcResponse(projectDashboardSchema);

export type GitCommit = z.infer<typeof gitCommitSchema>;
export type ProjectRepository = z.infer<typeof projectRepositorySchema>;
export type ProjectTimelineItem = z.infer<typeof projectTimelineItemSchema>;
export type ProjectDashboard = z.infer<typeof projectDashboardSchema>;
export type ProjectDashboardSnapshot = z.infer<typeof projectDashboardSnapshotSchema>;
export type ProjectRepositorySelectInput = z.infer<
  typeof projectRepositorySelectInputSchema
>;
export type ProjectRepositoryRefreshInput = z.infer<
  typeof projectRepositoryRefreshInputSchema
>;

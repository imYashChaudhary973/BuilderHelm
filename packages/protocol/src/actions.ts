import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { jsonValueSchema } from './json.js';
import { modelErrorSchema, modelRefSchema } from './model.js';

const timestampSchema = z.string().datetime({ offset: false });
const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const permissionLevelSchema = z.enum([
  'read',
  'draft',
  'reversible_write',
  'external_side_effect',
  'destructive_sensitive',
]);
export const permissionPolicyModeSchema = z.enum(['ask', 'auto_approve', 'deny']);
export const workToolIdSchema = z.enum([
  'project.create',
  'project.get_status',
  'project.add_decision',
  'task.list',
  'task.create',
  'task.update',
  'project.run_tests',
]);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high']);
export const taskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
]);
export const projectStatusSchema = z.enum(['active', 'paused', 'completed', 'archived']);

export const resourceRefSchema = z
  .object({
    type: z.enum(['project', 'task', 'decision']),
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(500),
  })
  .strict();

export const projectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4_000).nullable(),
    status: projectStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const taskSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(10_000).nullable(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueAt: timestampSchema.nullable(),
    source: z.enum(['action_chat', 'manual', 'automation']),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const projectDecisionSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    detail: z.string().trim().max(10_000).nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const projectCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4_000).nullable().default(null),
  })
  .strict();
export const projectGetStatusInputSchema = z
  .object({ projectId: z.string().uuid() })
  .strict();
export const projectRunTestsInputSchema = z
  .object({ projectId: z.string().uuid() })
  .strict();
export const projectRunTestsResultSchema = z
  .object({
    exitCode: z.number().int(),
    passed: z.boolean(),
    stdout: z.string().max(8_000),
    stderr: z.string().max(8_000),
  })
  .strict();
export const projectAddDecisionInputSchema = z
  .object({
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    detail: z.string().trim().max(10_000).nullable().default(null),
  })
  .strict();
export const taskListInputSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    status: taskStatusSchema.optional(),
  })
  .strict();
export const taskCreateInputSchema = z
  .object({
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(10_000).nullable().default(null),
    priority: taskPrioritySchema.default('medium'),
    dueAt: timestampSchema.nullable().default(null),
  })
  .strict();
export const taskUpdateInputSchema = z
  .object({
    taskId: z.string().uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueAt: timestampSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.priority !== undefined ||
      value.dueAt !== undefined,
    { message: 'Task update requires at least one changed field' },
  );

export const projectStatusResultSchema = z
  .object({
    project: projectSchema,
    taskCounts: z
      .object({
        todo: z.number().int().nonnegative(),
        inProgress: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        done: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
      })
      .strict(),
    recentDecisions: z.array(projectDecisionSchema).max(20),
  })
  .strict();

export const toolDescriptorSchema = z
  .object({
    id: workToolIdSchema,
    modelName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    description: z.string().min(1).max(4_000),
    risk: permissionLevelSchema,
    dataScopes: z.array(z.enum(['projects', 'tasks'])).min(1),
    timeoutMs: z.number().int().min(100).max(30_000),
    idempotency: z.enum(['none', 'request_id', 'single_use_approval']),
    rollbackSupport: z.enum(['none', 'manual', 'automatic']),
  })
  .strict();

export const permissionPolicySchema = z
  .object({
    toolId: workToolIdSchema,
    mode: permissionPolicyModeSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const approvalStatusSchema = z.enum([
  'pending',
  'denied',
  'executed',
  'expired',
  'failed',
]);
export const approvalRequestSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    toolId: workToolIdSchema,
    summary: z.string().min(1).max(1_000),
    exactArguments: jsonValueSchema,
    risk: permissionLevelSchema,
    affectedResources: z.array(resourceRefSchema).max(100),
    reversible: z.boolean(),
    status: approvalStatusSchema,
    actorType: z.enum(['deterministic_intent', 'model']),
    modelRef: modelRefSchema.nullable(),
    expiresAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const actionReceiptSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    correlationId: correlationIdSchema,
    actorType: z.enum(['deterministic_intent', 'model']),
    actorId: z.string().max(500).nullable(),
    modelRef: modelRefSchema.nullable(),
    toolId: workToolIdSchema,
    requestedAction: z.string().min(1).max(1_000),
    exactArguments: jsonValueSchema,
    approvalState: z.enum(['not_required', 'auto_approved', 'granted']),
    result: jsonValueSchema,
    affectedResources: z.array(resourceRefSchema).max(100),
    rollbackInformation: jsonValueSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const actionCommandOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('approval_required'),
      message: z.string().min(1).max(2_000),
      approval: approvalRequestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('executed'),
      message: z.string().min(1).max(2_000),
      receipt: actionReceiptSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('read_result'),
      message: z.string().min(1).max(20_000),
      toolId: workToolIdSchema,
      result: jsonValueSchema,
    })
    .strict(),
]);

export const actionSnapshotSchema = z
  .object({
    projects: z.array(projectSchema),
    tasks: z.array(taskSchema),
    pendingApprovals: z.array(approvalRequestSchema),
    receipts: z.array(actionReceiptSchema),
    policies: z.array(permissionPolicySchema),
    tools: z.array(toolDescriptorSchema),
  })
  .strict();

export const actionSnapshotInputSchema = z.object({}).strict();
export const actionCommandInputSchema = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().trim().min(1).max(2_000),
    modelRef: modelRefSchema.nullable().default(null),
  })
  .strict();
export const approvalResolveInputSchema = z
  .object({ approvalId: z.string().uuid() })
  .strict();
export const permissionPolicyUpdateInputSchema = z
  .object({ toolId: workToolIdSchema, mode: permissionPolicyModeSchema })
  .strict();

export const actionSnapshotRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: actionSnapshotInputSchema })
  .strict();
export const actionCommandRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: actionCommandInputSchema })
  .strict();
export const approvalResolveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: approvalResolveInputSchema })
  .strict();
export const permissionPolicyUpdateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: permissionPolicyUpdateInputSchema,
  })
  .strict();

function ipcResponse<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const actionSnapshotIpcResponseSchema = ipcResponse(actionSnapshotSchema);
export const actionCommandIpcResponseSchema = ipcResponse(actionCommandOutcomeSchema);
export const approvalResolveIpcResponseSchema = ipcResponse(actionCommandOutcomeSchema);
export const approvalRejectIpcResponseSchema = ipcResponse(approvalRequestSchema);
export const permissionPolicyUpdateIpcResponseSchema =
  ipcResponse(permissionPolicySchema);

export type PermissionLevel = z.infer<typeof permissionLevelSchema>;
export type PermissionPolicyMode = z.infer<typeof permissionPolicyModeSchema>;
export type WorkToolId = z.infer<typeof workToolIdSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ResourceRef = z.infer<typeof resourceRefSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type ProjectDecision = z.infer<typeof projectDecisionSchema>;
export type ProjectCreateInput = z.input<typeof projectCreateInputSchema>;
export type ProjectGetStatusInput = z.infer<typeof projectGetStatusInputSchema>;
export type ProjectRunTestsInput = z.infer<typeof projectRunTestsInputSchema>;
export type ProjectRunTestsResult = z.infer<typeof projectRunTestsResultSchema>;
export type ProjectAddDecisionInput = z.input<typeof projectAddDecisionInputSchema>;
export type TaskListInput = z.infer<typeof taskListInputSchema>;
export type TaskCreateInput = z.input<typeof taskCreateInputSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>;
export type ProjectStatusResult = z.infer<typeof projectStatusResultSchema>;
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ActionReceipt = z.infer<typeof actionReceiptSchema>;
export type ActionCommandOutcome = z.infer<typeof actionCommandOutcomeSchema>;
export type ActionSnapshot = z.infer<typeof actionSnapshotSchema>;
export type ActionSnapshotInput = z.infer<typeof actionSnapshotInputSchema>;
export type ActionCommandInput = z.input<typeof actionCommandInputSchema>;
export type ApprovalResolveInput = z.infer<typeof approvalResolveInputSchema>;
export type PermissionPolicyUpdateInput = z.infer<
  typeof permissionPolicyUpdateInputSchema
>;

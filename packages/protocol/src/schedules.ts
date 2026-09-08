import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const SCHEDULE_LIFETIME = 'desktop-open' as const;
export const scheduleLifetimeSchema = z.literal(SCHEDULE_LIFETIME);

export const scheduleTriggerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('daily'),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    })
    .strict(),
  z
    .object({
      kind: z.literal('interval'),
      everyMinutes: z.number().int().min(1).max(10_080),
    })
    .strict(),
]);
export type ScheduleTrigger = z.infer<typeof scheduleTriggerSchema>;

export const scheduleTaskSchema = z.discriminatedUnion('tool', [
  z
    .object({
      tool: z.literal('apify.research'),
      profileId: z.string().min(1).max(80),
      topic: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(25),
      costLimitUsd: z.number().nonnegative(),
      windowDays: z.number().int().min(1).max(30),
    })
    .strict(),
  z
    .object({
      tool: z.literal('x.publish'),
      profileId: z.string().min(1).max(80),
      text: z.string().min(1).max(280),
      account: z.string().min(1).max(80),
    })
    .strict(),
]);
export type ScheduleTask = z.infer<typeof scheduleTaskSchema>;

export const scheduleStateSchema = z.enum(['active', 'paused']);
export const scheduleRunOutcomeSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
  'needs_approval',
  'outcomeUnknown',
]);
export const scheduleSkipReasonSchema = z.enum([
  'overlap',
  'missed-paid',
  'expired-account',
  'quota',
  'duplicate',
  'paused',
  'host-restart',
]);
export type ScheduleSkipReason = z.infer<typeof scheduleSkipReasonSchema>;

export const scheduleRecordSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    state: scheduleStateSchema,
    lifetime: scheduleLifetimeSchema,
    timezone: z.string().min(1).max(64),
    trigger: scheduleTriggerSchema,
    task: scheduleTaskSchema,
    configVersion: z.number().int().min(1),
    overlapPolicy: z.literal('skip'),
    budgetUsd: z.number().nonnegative(),
    remainingBudgetUsd: z.number().nonnegative(),
    notification: z.literal('in-app'),
    nextRunAt: z.string().datetime().nullable(),
    lastTickAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;

export const scheduleRunSchema = z
  .object({
    id: z.string().uuid(),
    scheduleId: z.string().uuid(),
    configVersion: z.number().int().min(1),
    triggerId: z.string().min(1).max(200),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    outcome: scheduleRunOutcomeSchema,
    skipReason: scheduleSkipReasonSchema.nullable(),
    connectorJobId: z.string().uuid().nullable(),
    remoteJobId: z.string().min(1).max(200).nullable(),
    notice: z.string().max(500).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ScheduleRun = z.infer<typeof scheduleRunSchema>;

export const schedulesSnapshotSchema = z
  .object({
    lifetime: scheduleLifetimeSchema,
    hostMustRemainRunning: z.literal(true),
    schedules: z.array(scheduleRecordSchema),
    runs: z.array(scheduleRunSchema).max(100),
  })
  .strict();
export type SchedulesSnapshot = z.infer<typeof schedulesSnapshotSchema>;

export const scheduleCreateInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    timezone: z.string().min(1).max(64),
    trigger: scheduleTriggerSchema,
    task: scheduleTaskSchema,
    budgetUsd: z.number().nonnegative(),
  })
  .strict();
export type ScheduleCreateInput = z.infer<typeof scheduleCreateInputSchema>;

export const scheduleUpdateInputSchema = z
  .object({
    scheduleId: z.string().uuid(),
    name: z.string().min(1).max(80),
    timezone: z.string().min(1).max(64),
    trigger: scheduleTriggerSchema,
    task: scheduleTaskSchema,
    budgetUsd: z.number().nonnegative(),
  })
  .strict();
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateInputSchema>;

export const scheduleIdInputSchema = z.object({ scheduleId: z.string().uuid() }).strict();
export type ScheduleIdInput = z.infer<typeof scheduleIdInputSchema>;

export const scheduleRunIdInputSchema = z.object({ runId: z.string().uuid() }).strict();
export type ScheduleRunIdInput = z.infer<typeof scheduleRunIdInputSchema>;

const emptyInput = z.object({}).strict();
export const schedulesSnapshotRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: emptyInput })
  .strict();
export const scheduleCreateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: scheduleCreateInputSchema })
  .strict();
export const scheduleUpdateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: scheduleUpdateInputSchema })
  .strict();
export const scheduleIdRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: scheduleIdInputSchema })
  .strict();
export const scheduleRunIdRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: scheduleRunIdInputSchema })
  .strict();

export const schedulesSnapshotIpcResponseSchema = ipcResult(schedulesSnapshotSchema);
export const scheduleRecordIpcResponseSchema = ipcResult(scheduleRecordSchema);
export const scheduleRunIpcResponseSchema = ipcResult(scheduleRunSchema);

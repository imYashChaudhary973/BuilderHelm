import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { boardAgentCapabilitiesSchema, boardAgentIdSchema } from './board.js';
import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const accountAuthStates = ['builtin', 'installed', 'missing'] as const;
export const accountAuthStateSchema = z.enum(accountAuthStates);
export type AccountAuthState = z.infer<typeof accountAuthStateSchema>;

export const accountUsageSchema = z
  .object({
    tokensUsed: z.number().int().min(0),
    costUsd: z.number().min(0),
    source: z.literal('swarm'),
    occurredAt: z.string().min(1),
  })
  .strict();
export type AccountUsage = z.infer<typeof accountUsageSchema>;

export const accountAgentSchema = z
  .object({
    id: boardAgentIdSchema,
    label: z.string().min(1).max(80),
    auth: accountAuthStateSchema,
    path: z.string().max(4_096).nullable(),
    capabilities: boardAgentCapabilitiesSchema,
    configDirEnv: z.string().min(1).max(64).nullable(),
    configRoot: z.string().min(1).max(4_096).nullable(),
    usage: accountUsageSchema.nullable(),
  })
  .strict();
export type AccountAgent = z.infer<typeof accountAgentSchema>;

export const accountSnapshotSchema = z
  .object({
    agents: z.array(accountAgentSchema),
    occurredAt: z.string().min(1),
  })
  .strict();
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;

export const accountSetRootInputSchema = z
  .object({
    agentId: boardAgentIdSchema,
    configRoot: z.string().min(1).max(4_096).nullable(),
  })
  .strict();
export type AccountSetRootInput = z.infer<typeof accountSetRootInputSchema>;

export const accountSnapshotRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: z.object({}).strict() })
  .strict();
export const accountSetRootRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountSetRootInputSchema })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const accountSnapshotIpcResponseSchema = ipcResult(accountSnapshotSchema);
export const accountSetRootIpcResponseSchema = ipcResult(accountSnapshotSchema);

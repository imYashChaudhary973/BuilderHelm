import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { boardAgentCapabilitiesSchema, boardAgentIdSchema } from './board.js';
import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const QUOTA_PROVIDER_IDS = ['claude', 'codex', 'grok'] as const;
export const quotaProviderIdSchema = z.enum(QUOTA_PROVIDER_IDS);
export type QuotaProviderId = z.infer<typeof quotaProviderIdSchema>;

export const accountAuthStates = ['builtin', 'installed', 'missing'] as const;
export const accountAuthStateSchema = z.enum(accountAuthStates);
export type AccountAuthState = z.infer<typeof accountAuthStateSchema>;

export const quotaWindowSchema = z
  .object({
    usedPercent: z.number().min(0).max(100),
    resetsAt: z.string().min(1).nullable(),
  })
  .strict();
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;

export const accountQuotaSchema = z
  .object({
    fiveHour: quotaWindowSchema.nullable(),
    sevenDay: quotaWindowSchema.nullable(),
    source: z.enum(['statusline', 'app-server', 'run']),
    occurredAt: z.string().min(1),
    resetCreditsAvailable: z.number().int().min(0).optional(),
  })
  .strict();
export type AccountQuota = z.infer<typeof accountQuotaSchema>;

export const accountAgentSchema = z
  .object({
    id: quotaProviderIdSchema,
    label: z.string().min(1).max(80),
    auth: accountAuthStateSchema,
    path: z.string().max(4_096).nullable(),
    capabilities: boardAgentCapabilitiesSchema,
    configDirEnv: z.string().min(1).max(64).nullable(),
    configRoot: z.string().min(1).max(4_096).nullable(),
    quota: accountQuotaSchema.nullable(),
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
  .object({
    correlationId: correlationIdSchema,
    input: z.object({ live: z.boolean().optional() }).strict(),
  })
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

import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const QUOTA_PROVIDER_IDS = ['claude', 'codex', 'grok'] as const;
export const quotaProviderIdSchema = z.enum(QUOTA_PROVIDER_IDS);
export type QuotaProviderId = z.infer<typeof quotaProviderIdSchema>;

export const SYSTEM_ACCOUNT_ID = 'system';

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
    source: z.enum(['statusline', 'app-server', 'run', 'oauth']),
    occurredAt: z.string().min(1),
    resetCreditsAvailable: z.number().int().min(0).optional(),
  })
  .strict();
export type AccountQuota = z.infer<typeof accountQuotaSchema>;

export const accountHomeSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    configRoot: z.string().min(1).max(4_096).nullable(),
    email: z.string().min(3).max(200).nullable(),
    active: z.boolean(),
    /** Provider-reported usage for this home; Grok fills it from its billing log. */
    billing: z
      .object({
        usedPercent: z.number().min(0).max(100),
        periodEnd: z.string().min(1).nullable(),
        tier: z.string().min(1).max(80).nullable(),
        /** When the CLI last logged this snapshot, for the "Updated x ago" line. */
        fetchedAt: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const accountProviderSchema = z
  .object({
    id: quotaProviderIdSchema,
    label: z.string().min(1).max(80),
    installed: z.boolean(),
    quota: accountQuotaSchema.nullable(),
    homes: z.array(accountHomeSchema).min(1),
  })
  .strict();
export type AccountProvider = z.infer<typeof accountProviderSchema>;
export type AccountHome = z.infer<typeof accountHomeSchema>;

/** A credential location named without reading its contents. */
export const authSourceSchema = z
  .object({
    kind: z.enum(['system-default', 'isolated-home']),
    path: z.string().min(1).max(4_096),
  })
  .strict();
export type AuthSource = z.infer<typeof authSourceSchema>;

/** Two or more credential sources for one provider. Paths only, never values. */
export const authConflictSchema = z
  .object({
    provider: quotaProviderIdSchema,
    sources: z.array(authSourceSchema).min(2).max(16),
  })
  .strict();
export type AuthConflict = z.infer<typeof authConflictSchema>;

export const accountSnapshotSchema = z
  .object({
    providers: z.array(accountProviderSchema),
    occurredAt: z.string().min(1),
    hookSystemDefault: z.boolean(),
    authConflicts: z.array(authConflictSchema).max(8),
  })
  .strict();
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;

export const accountSnapshotInputSchema = z
  .object({ live: z.boolean().optional() })
  .strict();
export type AccountSnapshotInput = z.infer<typeof accountSnapshotInputSchema>;

export const accountAddInputSchema = z
  .object({ provider: quotaProviderIdSchema })
  .strict();
export type AccountAddInput = z.infer<typeof accountAddInputSchema>;

export const accountRemoveInputSchema = z
  .object({ provider: quotaProviderIdSchema, id: z.string().min(1).max(64) })
  .strict();
export type AccountRemoveInput = z.infer<typeof accountRemoveInputSchema>;

export const accountToggleHookInputSchema = z.object({ enabled: z.boolean() }).strict();
export type AccountToggleHookInput = z.infer<typeof accountToggleHookInputSchema>;

export const accountSetActiveInputSchema = z
  .object({ provider: quotaProviderIdSchema, id: z.string().min(1).max(64) })
  .strict();
export type AccountSetActiveInput = z.infer<typeof accountSetActiveInputSchema>;

export const accountConfirmLoginInputSchema = z
  .object({ provider: quotaProviderIdSchema, id: z.string().min(1).max(64) })
  .strict();
export type AccountConfirmLoginInput = z.infer<typeof accountConfirmLoginInputSchema>;

export const accountLoginTerminalInputSchema = z
  .object({
    provider: quotaProviderIdSchema,
    configRoot: z.string().min(1).max(4_096),
    accountId: z.string().min(1).max(64),
  })
  .strict();
export type AccountLoginTerminalInput = z.infer<typeof accountLoginTerminalInputSchema>;

export const accountLoginTerminalRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountLoginTerminalInputSchema })
  .strict();

export const accountSnapshotRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountSnapshotInputSchema })
  .strict();
export const accountAddRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountAddInputSchema })
  .strict();
export const accountToggleHookRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountToggleHookInputSchema })
  .strict();

export const accountConfirmLoginRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountConfirmLoginInputSchema })
  .strict();
export const accountRemoveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountRemoveInputSchema })
  .strict();
export const accountSetActiveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: accountSetActiveInputSchema })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const accountSnapshotIpcResponseSchema = ipcResult(accountSnapshotSchema);

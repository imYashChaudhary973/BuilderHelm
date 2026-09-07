import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const AUTH_STATUSES = ['signed-out', 'waiting', 'signed-in'] as const;
export const authStatusSchema = z.enum(AUTH_STATUSES);
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const AUTH_PLANS = ['none', 'plus', 'pro', 'ultra'] as const;
export const authPlanSchema = z.enum(AUTH_PLANS);
export type AuthPlan = z.infer<typeof authPlanSchema>;

export const authSessionSchema = z
  .object({
    email: z.string().nullable(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    plan: authPlanSchema,
    expiresAt: z.string(),
  })
  .strict();
export type AuthSession = z.infer<typeof authSessionSchema>;

export const authStateSchema = z
  .object({
    status: authStatusSchema,
    session: authSessionSchema.nullable(),
    error: z.string().nullable(),
    /**
     * The page the gate opened, while a sign-in is in flight. Present so the
     * user can recover a handoff whose browser tab was closed or never
     * appeared; null in every other state.
     */
    signInUrl: z.string().nullable(),
  })
  .strict();
export type AuthState = z.infer<typeof authStateSchema>;

export const authReadRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AuthReadRequest = z.infer<typeof authReadRequestSchema>;

export const authBeginRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AuthBeginRequest = z.infer<typeof authBeginRequestSchema>;

export const authCancelRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AuthCancelRequest = z.infer<typeof authCancelRequestSchema>;

export const authSignOutRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AuthSignOutRequest = z.infer<typeof authSignOutRequestSchema>;

export const authOpenAccountRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AuthOpenAccountRequest = z.infer<typeof authOpenAccountRequestSchema>;

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const authIpcResponseSchema = ipcResult(authStateSchema);

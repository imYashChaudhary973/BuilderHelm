import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const NO_SLEEP_MODES = ['on', 'agent', 'off'] as const;
export const noSleepModeSchema = z.enum(NO_SLEEP_MODES);
export type NoSleepMode = z.infer<typeof noSleepModeSchema>;

/**
 * Full feature state, returned by every call so the renderer can seed its
 * cache from a mutation without a refetch.
 * - `mode`: what the user asked for.
 * - `blockerActive`: whether a powerSaveBlocker is currently held.
 * - `agentActive`: whether any counted agent work is running right now.
 */
export const noSleepStateSchema = z
  .object({
    mode: noSleepModeSchema,
    blockerActive: z.boolean(),
    agentActive: z.boolean(),
  })
  .strict();
export type NoSleepState = z.infer<typeof noSleepStateSchema>;

export const noSleepReadRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type NoSleepReadRequest = z.infer<typeof noSleepReadRequestSchema>;

export const noSleepSetInputSchema = z.object({ mode: noSleepModeSchema }).strict();
export type NoSleepSetInput = z.infer<typeof noSleepSetInputSchema>;

export const noSleepSetRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: noSleepSetInputSchema })
  .strict();
export type NoSleepSetRequest = z.infer<typeof noSleepSetRequestSchema>;

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const noSleepIpcResponseSchema = ipcResult(noSleepStateSchema);

import { z } from 'zod';

export const helmAgentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    brief: z.string().trim().min(1).max(4000),
    engine: z.enum(['claude', 'codex', 'grok']),
    places: z.array(z.string().max(4096)).max(16),
    skillIds: z.array(z.string().max(64)).max(32),
    createdAt: z.string().min(1),
  })
  .strict();
export type HelmAgent = z.infer<typeof helmAgentSchema>;

export const helmRoutineSchema = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    instruction: z.string().trim().min(1).max(4000),
    everyMinutes: z.number().int().min(15).max(10_080),
    paused: z.boolean(),
    lastRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
  })
  .strict();
export type HelmRoutine = z.infer<typeof helmRoutineSchema>;

export const helmPluginSchema = z
  .object({
    id: z.literal('github'),
    connected: z.boolean(),
    account: z.string().max(120).nullable(),
  })
  .strict();
export type HelmPlugin = z.infer<typeof helmPluginSchema>;

export const helmCreateAgentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    brief: z.string().trim().min(1).max(4000),
    engine: z.enum(['claude', 'codex', 'grok']),
    places: z.array(z.string().max(4096)).max(16),
    skillIds: z.array(z.string().max(64)).max(32),
  })
  .strict();

export const helmCreateRoutineInputSchema = z
  .object({
    agentId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    instruction: z.string().trim().min(1).max(4000),
    everyMinutes: z.number().int().min(15).max(10_080),
  })
  .strict();

export const helmConnectPluginInputSchema = z
  .object({
    id: z.literal('github'),
    token: z.string().trim().min(8).max(256),
  })
  .strict();

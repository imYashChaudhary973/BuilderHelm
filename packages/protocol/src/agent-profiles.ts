import { z } from 'zod';

import {
  agentDescriptorSchema,
  correlationIdSchema,
  ipcResult,
  runtimeLaunchSchema,
} from './agent-session.js';

/**
 * A named agent the person owns: a label and a mark for the roster, the CLI
 * that actually runs (ADR 0008 — BuilderHelm hosts agents it does not own),
 * and the project folder its threads default to.
 *
 * The id is namespaced `profile-…` so it can never collide with a KNOWN CLI
 * id in the agent registry.
 */
export const AGENT_PROFILE_MARKS = [
  'circle',
  'diamond',
  'triangle',
  'square',
  'hexagon',
  'star',
  'wave',
  'bolt',
] as const;
export const agentProfileMarkSchema = z.enum(AGENT_PROFILE_MARKS);
export type AgentProfileMark = (typeof AGENT_PROFILE_MARKS)[number];

export const agentProfileSchema = z
  .object({
    id: z
      .string()
      .regex(/^profile-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    name: z.string().trim().min(1).max(80),
    mark: agentProfileMarkSchema,
    agent: agentDescriptorSchema,
    /** Where this profile's new threads run; null until a folder is chosen. */
    defaultCwd: z.string().max(4096).nullable(),
    /**
     * The model, effort, and account this profile launches with. Null fields
     * mean the runtime's own default — never a substituted choice. Absent in
     * older stored profiles; the default keeps them parsing.
     */
    launch: runtimeLaunchSchema.nullable().default(null),
    createdAt: z.string().datetime(),
    lastOpenedAt: z.string().datetime(),
  })
  .strict();
export type AgentProfile = z.infer<typeof agentProfileSchema>;

/** What the renderer may write. The id and timestamps belong to the host. */
export const agentProfileInputSchema = z
  .object({
    /** Omitted on create; present to update an existing profile. */
    id: z
      .string()
      .regex(/^profile-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      .optional(),
    name: z.string().trim().min(1).max(80),
    mark: agentProfileMarkSchema,
    agent: agentDescriptorSchema,
    defaultCwd: z.string().max(4096).nullable(),
    launch: runtimeLaunchSchema.nullable().optional(),
  })
  .strict();
export type AgentProfileInput = z.infer<typeof agentProfileInputSchema>;

export const agentProfileListInputSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AgentProfileListInput = z.infer<typeof agentProfileListInputSchema>;

export const agentProfileUpsertInputSchema = z
  .object({ correlationId: correlationIdSchema, profile: agentProfileInputSchema })
  .strict();
export type AgentProfileUpsertInput = z.infer<typeof agentProfileUpsertInputSchema>;

export const agentProfileDeleteInputSchema = z
  .object({ correlationId: correlationIdSchema, profileId: z.string().max(64) })
  .strict();
export type AgentProfileDeleteInput = z.infer<typeof agentProfileDeleteInputSchema>;

export const agentProfileListIpcResponseSchema = ipcResult(
  z.array(agentProfileSchema).readonly(),
);
export const agentProfileIpcResponseSchema = ipcResult(agentProfileSchema);

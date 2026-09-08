/**
 * The runtime capability contract: one honest record per installed coding
 * agent, consolidating what this machine has, how BuilderHelm can launch it,
 * and how much of that has actually been verified.
 *
 * The plan rule behind the tier ladder: "unavailable" and "untested" are
 * different answers. A binary missing from PATH is unavailable; a binary we
 * found but never exercised through a transport is untested — never advertised
 * as working. Verification evidence lives in code (the declarations the host
 * passes in), so a tier can only rise when a checked path proves it.
 */
import { z } from 'zod';

import { ipcResult } from './agent-session.js';

/** Launch transports BuilderHelm owns: raw PTY panes and ACP structured sessions. */
export const RUNTIME_TRANSPORTS = ['pty', 'acp'] as const;
export const runtimeTransportSchema = z.enum(RUNTIME_TRANSPORTS);
export type RuntimeTransport = (typeof RUNTIME_TRANSPORTS)[number];

/**
 * Support tiers, ordered least to most capable:
 * - `unavailable`: the command does not resolve on this machine.
 * - `untested`: present, but no BuilderHelm-checked path has exercised it.
 * - `terminal`: verified as an interactive PTY pane.
 * - `structured-chat`: verified through ACP structured chat.
 * - `orchestration-ready`: verified headless with structured output, resume,
 *   and usage reporting — the Swarm eligibility bar.
 */
export const RUNTIME_TIERS = [
  'unavailable',
  'untested',
  'terminal',
  'structured-chat',
  'orchestration-ready',
] as const;
export const runtimeTierSchema = z.enum(RUNTIME_TIERS);
export type RuntimeTier = (typeof RUNTIME_TIERS)[number];

/** A launch path BuilderHelm knows for a runtime, and how far it is verified. */
export const runtimeTransportDeclarationSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    transport: runtimeTransportSchema,
    command: z.string().min(1).max(4096),
    args: z.array(z.string().max(4096)).max(64),
    /** Highest tier a checked path has proven for this transport, if any. */
    verified: runtimeTierSchema.nullable(),
    /** How the verification is known, when it is. */
    evidence: z.string().max(200).nullable(),
    /** True when the person configured it, so missing commands stay visible. */
    configured: z.boolean(),
  })
  .strict();
export type RuntimeTransportDeclaration = z.infer<
  typeof runtimeTransportDeclarationSchema
>;

export const runtimeCapabilitySchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    /** Resolved absolute command path, or null when nothing was found. */
    path: z.string().max(4096).nullable(),
    version: z.string().max(120).nullable(),
    transports: z.array(runtimeTransportSchema).max(4),
    tier: runtimeTierSchema,
    /** Honest note, e.g. why a present binary is still untested. */
    detail: z.string().max(300).nullable(),
    checkedAt: z.string(),
  })
  .strict();
export type RuntimeCapability = z.infer<typeof runtimeCapabilitySchema>;

export const runtimeSnapshotSchema = z
  .object({
    runtimes: z.array(runtimeCapabilitySchema).max(64),
    checkedAt: z.string(),
  })
  .strict();
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

/** Response envelope for the desktop capabilities query. */
export const runtimeCapabilitiesIpcResponseSchema = ipcResult(runtimeSnapshotSchema);

/**
 * The contract between the chat surface and an external coding agent.
 *
 * Shaped after the Agent Client Protocol ([ADR 0008](../../../docs/adr/0008-agent-client-protocol-host.md)),
 * because that is the wire format the agents actually speak. Keeping the domain
 * shape close to the wire keeps the adapter thin, which is where fidelity is
 * lost. It is deliberately not identical: ids are ours, snake_case discriminators
 * become dot-namespaced ones to match the rest of this package, and every event
 * carries the session it belongs to so a single stream can serve many threads.
 *
 * The important asymmetry: most of this is one-way notification, but permission
 * is a *request* the agent blocks on. An agent that gets no answer does not
 * proceed, and Claude Code auto-denies rather than waiting, so the answer path
 * is load-bearing rather than decorative.
 */
import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

export const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

/** Opaque to us: the agent mints it and we only ever echo it back. */
export const agentSessionIdSchema = z.string().min(1).max(512);
export type AgentSessionId = z.infer<typeof agentSessionIdSchema>;

export const agentTurnIdSchema = z.string().uuid();
export type AgentTurnId = z.infer<typeof agentTurnIdSchema>;

/** Also agent-minted, and only unique within a session. */
export const agentToolCallIdSchema = z.string().min(1).max(512);
export type AgentToolCallId = z.infer<typeof agentToolCallIdSchema>;

// ── Agent identity ────────────────────────────────────────────────────────────

/**
 * A configured agent. `command` and `args` are the user's, per ADR 0008: we run
 * what they point us at and never install it. Kept as a stable id so a thread
 * still names its agent after that agent is unconfigured.
 */
export const agentDescriptorSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    command: z.string().min(1).max(4096),
    args: z.array(z.string().max(4096)).max(64).readonly(),
  })
  .strict();
export type AgentDescriptor = z.infer<typeof agentDescriptorSchema>;

/**
 * What an agent said it can do at `initialize`. Absent capability is rendered as
 * absent; nothing here is emulated on the agent's behalf.
 */
export const agentCapabilitiesSchema = z
  .object({
    /** Can replay a prior session's history, so a thread can be reopened. */
    loadSession: z.boolean(),
    /** Can restore context without replaying history. */
    resumeSession: z.boolean(),
    promptImage: z.boolean(),
    promptAudio: z.boolean(),
    /** Accepts inline file context, which is what @-mentions compile to. */
    promptEmbeddedContext: z.boolean(),
  })
  .strict();
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

export const AGENT_AUTH_STATES = ['unknown', 'authenticated', 'required'] as const;
export const agentAuthStateSchema = z.enum(AGENT_AUTH_STATES);
export type AgentAuthState = z.infer<typeof agentAuthStateSchema>;

/**
 * An authentication route the agent offers. We display these and nothing more:
 * signing in happens inside the agent's own flow, and BuilderHelm never handles
 * the credential (ADR 0008).
 */
export const agentAuthMethodSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(120),
    description: z.string().max(400).nullable(),
  })
  .strict();
export type AgentAuthMethod = z.infer<typeof agentAuthMethodSchema>;

// ── Config options: model and reasoning effort ────────────────────────────────

/**
 * ACP's reserved config categories. This is how a model and a reasoning level
 * reach an agent, and the only way: BuilderHelm curates no vendor's lineup, so
 * the picker renders whatever arrives here.
 */
export const AGENT_CONFIG_CATEGORIES = [
  'model',
  'model-config',
  'thought-level',
  'mode',
  'other',
] as const;
export const agentConfigCategorySchema = z.enum(AGENT_CONFIG_CATEGORIES);
export type AgentConfigCategory = z.infer<typeof agentConfigCategorySchema>;

export const agentConfigChoiceSchema = z
  .object({
    value: z.string().min(1).max(256),
    label: z.string().min(1).max(160),
    description: z.string().max(400).nullable(),
  })
  .strict();
export type AgentConfigChoice = z.infer<typeof agentConfigChoiceSchema>;

/**
 * Booleans and selects arrive through the same list, so the value is a union and
 * `choices` is empty for a boolean.
 */
export const agentConfigOptionSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
    description: z.string().max(400).nullable(),
    category: agentConfigCategorySchema,
    value: z.union([z.string().max(256), z.boolean()]),
    choices: z.array(agentConfigChoiceSchema).max(2048).readonly(),
  })
  .strict();
export type AgentConfigOption = z.infer<typeof agentConfigOptionSchema>;

// ── Content ───────────────────────────────────────────────────────────────────

export const agentContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z
    .object({
      type: z.literal('image'),
      mimeType: z.string().min(1).max(128),
      data: z.string(),
    })
    .strict(),
  /** A pointer, not the bytes: used for @-mentions of workspace files. */
  z
    .object({
      type: z.literal('resource-link'),
      uri: z.string().min(1).max(4096),
      name: z.string().min(1).max(512),
    })
    .strict(),
]);
export type AgentContent = z.infer<typeof agentContentSchema>;

// ── Tool calls ────────────────────────────────────────────────────────────────

export const AGENT_TOOL_KINDS = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
] as const;
export const agentToolKindSchema = z.enum(AGENT_TOOL_KINDS);
export type AgentToolKind = z.infer<typeof agentToolKindSchema>;

export const AGENT_TOOL_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export const agentToolStatusSchema = z.enum(AGENT_TOOL_STATUSES);
export type AgentToolStatus = z.infer<typeof agentToolStatusSchema>;

/**
 * What a tool call has to show. The `diff` variant is why chat can review code
 * rather than only describe it, so the before text is kept even when the agent
 * omits it and we have to read the file ourselves.
 */
export const agentToolContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: agentContentSchema }).strict(),
  z
    .object({
      type: z.literal('diff'),
      path: z.string().min(1).max(4096),
      oldText: z.string().nullable(),
      newText: z.string(),
    })
    .strict(),
  /** A live terminal BuilderHelm owns; the id addresses our own PTY. */
  z
    .object({ type: z.literal('terminal'), terminalId: z.string().min(1).max(128) })
    .strict(),
]);
export type AgentToolContent = z.infer<typeof agentToolContentSchema>;

export const agentToolCallSchema = z
  .object({
    toolCallId: agentToolCallIdSchema,
    title: z.string().max(512),
    kind: agentToolKindSchema,
    status: agentToolStatusSchema,
    content: z.array(agentToolContentSchema).max(64).readonly(),
    /** Files this call concerns, so the UI can reveal them. */
    paths: z.array(z.string().max(4096)).max(64).readonly(),
  })
  .strict();
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

// ── Plans ─────────────────────────────────────────────────────────────────────

export const AGENT_PLAN_STATUSES = ['pending', 'running', 'completed'] as const;
export const agentPlanStatusSchema = z.enum(AGENT_PLAN_STATUSES);

export const agentPlanEntrySchema = z
  .object({
    content: z.string().min(1).max(2048),
    status: agentPlanStatusSchema,
  })
  .strict();
export type AgentPlanEntry = z.infer<typeof agentPlanEntrySchema>;

// ── Permission ────────────────────────────────────────────────────────────────

/**
 * The decisions a person can take. `allow-always` and `reject-always` persist as
 * BuilderHelm rules, per workspace, because an agent that forgets them between
 * processes would otherwise ask forever.
 *
 * Not every agent offers every option. The adapter degrades rather than inventing
 * one: an agent without `allow_always` gets `allow-once` when the person chose
 * always, and BuilderHelm remembers the rule on its own side.
 */
export const AGENT_PERMISSION_DECISIONS = [
  'allow-once',
  'allow-always',
  'reject-once',
  'reject-always',
  'cancelled',
] as const;
export const agentPermissionDecisionSchema = z.enum(AGENT_PERMISSION_DECISIONS);
export type AgentPermissionDecision = z.infer<typeof agentPermissionDecisionSchema>;

export const agentPermissionOptionSchema = z
  .object({
    /** Agent-defined and echoed back verbatim; never interpreted. */
    optionId: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
    decision: agentPermissionDecisionSchema,
  })
  .strict();
export type AgentPermissionOption = z.infer<typeof agentPermissionOptionSchema>;

export const agentPermissionRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    sessionId: agentSessionIdSchema,
    toolCall: agentToolCallSchema,
    options: z.array(agentPermissionOptionSchema).min(1).max(16).readonly(),
  })
  .strict();
export type AgentPermissionRequest = z.infer<typeof agentPermissionRequestSchema>;

export const agentPermissionResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: agentPermissionDecisionSchema,
    /** Present unless the decision is `cancelled`. */
    optionId: z.string().min(1).max(128).nullable(),
  })
  .strict();
export type AgentPermissionResponse = z.infer<typeof agentPermissionResponseSchema>;

// ── Turn completion ───────────────────────────────────────────────────────────

export const AGENT_STOP_REASONS = [
  'end-turn',
  'max-tokens',
  'max-turn-requests',
  'refusal',
  'cancelled',
] as const;
export const agentStopReasonSchema = z.enum(AGENT_STOP_REASONS);
export type AgentStopReason = z.infer<typeof agentStopReasonSchema>;

export const agentUsageSchema = z
  .object({
    usedTokens: z.number().int().nonnegative().nullable(),
    contextWindow: z.number().int().positive().nullable(),
  })
  .strict();
export type AgentUsage = z.infer<typeof agentUsageSchema>;

// ── The event stream ──────────────────────────────────────────────────────────

/**
 * One union for every agent. Per-agent differences belong in adapters and in
 * capability flags, never in a branch in a view.
 *
 * `raw` is retained on the events that carry agent-authored payloads so a
 * fidelity bug can be diagnosed without reproducing it: the adapter's mapping is
 * the thing most likely to be wrong, and the original is the only evidence.
 */
export const agentSessionEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('session.started'),
      sessionId: agentSessionIdSchema,
      capabilities: agentCapabilitiesSchema,
      configOptions: z.array(agentConfigOptionSchema).max(64).readonly(),
    })
    .strict(),
  z
    .object({
      type: z.literal('session.config.updated'),
      sessionId: agentSessionIdSchema,
      configOptions: z.array(agentConfigOptionSchema).max(64).readonly(),
    })
    .strict(),
  z
    .object({
      type: z.literal('session.auth.required'),
      sessionId: agentSessionIdSchema,
      methods: z.array(agentAuthMethodSchema).max(16).readonly(),
    })
    .strict(),
  /** The agent process ended, expectedly or not. The thread outlives it. */
  z
    .object({
      type: z.literal('session.exited'),
      /** Empty when the process died before the handshake minted an id. */
      sessionId: z.string().max(512),
      code: z.number().int().nullable(),
      message: z.string().max(2048).nullable(),
    })
    .strict(),

  z
    .object({
      type: z.literal('turn.started'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('message.user'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('message.delta'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      text: z.string(),
    })
    .strict(),
  /** Reasoning, kept separate so it can be collapsed independently. */
  z
    .object({
      type: z.literal('thought.delta'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.updated'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      call: agentToolCallSchema,
      raw: z.string().max(65536).nullable(),
    })
    .strict(),
  /** Full replacement, matching ACP: a plan is never patched. */
  z
    .object({
      type: z.literal('plan.updated'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      entries: z.array(agentPlanEntrySchema).max(128).readonly(),
    })
    .strict(),
  z
    .object({
      type: z.literal('usage.updated'),
      sessionId: agentSessionIdSchema,
      usage: agentUsageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('permission.requested'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      request: agentPermissionRequestSchema,
    })
    .strict(),
  /** Emitted however it resolved, including by a stored rule or a cancel. */
  z
    .object({
      type: z.literal('permission.resolved'),
      sessionId: agentSessionIdSchema,
      requestId: z.string().uuid(),
      decision: agentPermissionDecisionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('turn.completed'),
      sessionId: agentSessionIdSchema,
      turnId: agentTurnIdSchema,
      stopReason: agentStopReasonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('turn.failed'),
      /** Empty when the failure precedes the handshake. */
      sessionId: z.string().max(512),
      turnId: agentTurnIdSchema,
      message: z.string().max(2048),
      raw: z.string().max(65536).nullable(),
    })
    .strict(),
]);
export type AgentSessionEvent = z.infer<typeof agentSessionEventSchema>;

// ── Requests the renderer makes ───────────────────────────────────────────────

// ── Launch selection ─────────────────────────────────────────────────────────

/**
 * What the person selected for a run: the exact model id, reasoning effort,
 * and account reference. Every field nullable — null means "nothing was
 * selected", which launch paths must carry as the runtime's own default.
 * Substituting a value the person did not pick is the one thing this schema
 * exists to prevent.
 */
export const runtimeLaunchSchema = z
  .object({
    model: z.string().trim().min(1).max(200).nullable(),
    effort: z.string().trim().min(1).max(64).nullable(),
    accountRef: z.string().trim().min(1).max(128).nullable(),
  })
  .strict();
export type RuntimeLaunch = z.infer<typeof runtimeLaunchSchema>;

/** The launch that carries no selection; never mutate it. */
export const RUNTIME_LAUNCH_NONE: RuntimeLaunch = {
  model: null,
  effort: null,
  accountRef: null,
};

export const agentSessionStartInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    agentId: z.string().min(1).max(64),
    /** Absolute, and the session root regardless of where the process starts. */
    cwd: z.string().min(1).max(4096),
    /** Reattach to a prior ACP session; requires `loadSession` or `resumeSession`. */
    resumeSessionId: agentSessionIdSchema.nullable(),
    /**
     * Launch selection for this session: overrides the profile's when sent.
     * Applied right after initialize; a runtime that cannot honor it fails
     * the start instead of silently keeping its previous model.
     */
    launch: runtimeLaunchSchema.nullable().default(null),
    /**
     * The roster profile this thread belongs to. Main resolves the profile's
     * own argv from it — the renderer still never chooses a command.
     */
    profileId: z.string().max(64).nullable(),
    /** Our thread, so a restart reopens history even when the agent cannot. */
    threadId: z.string().uuid().nullable(),
  })
  .strict();
export type AgentSessionStartInput = z.infer<typeof agentSessionStartInputSchema>;

export const agentPromptInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    sessionId: agentSessionIdSchema,
    content: z.array(agentContentSchema).min(1).max(64).readonly(),
  })
  .strict();
export type AgentPromptInput = z.infer<typeof agentPromptInputSchema>;

export const agentSetConfigInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    sessionId: agentSessionIdSchema,
    configId: z.string().min(1).max(128),
    value: z.union([z.string().max(256), z.boolean()]),
  })
  .strict();
export type AgentSetConfigInput = z.infer<typeof agentSetConfigInputSchema>;

export const agentRespondPermissionInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    sessionId: agentSessionIdSchema,
    response: agentPermissionResponseSchema,
  })
  .strict();
export type AgentRespondPermissionInput = z.infer<
  typeof agentRespondPermissionInputSchema
>;

export const agentCancelInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    sessionId: agentSessionIdSchema,
  })
  .strict();
export type AgentCancelInput = z.infer<typeof agentCancelInputSchema>;

/** What a started session looks like to the renderer. */
export const agentSessionStateSchema = z
  .object({
    sessionId: agentSessionIdSchema,
    /** Canonical thread this session is writing. Survives the process. */
    threadId: z.string().uuid(),
    agent: agentDescriptorSchema,
    cwd: z.string().min(1).max(4096),
    capabilities: agentCapabilitiesSchema,
    configOptions: z.array(agentConfigOptionSchema).max(64).readonly(),
    auth: agentAuthStateSchema,
    /** Non-null while a turn is in flight. */
    activeTurnId: agentTurnIdSchema.nullable(),
  })
  .strict();
export type AgentSessionState = z.infer<typeof agentSessionStateSchema>;

/** A known or configured agent, and whether this machine can run it. */
export const agentCandidateSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    command: z.string().min(1).max(4096),
    args: z.array(z.string().max(4096)).max(64).readonly(),
    available: z.boolean(),
    path: z.string().max(4096).nullable(),
    /** False while it is only an offer BuilderHelm found on PATH. */
    configured: z.boolean(),
  })
  .strict();
export type AgentCandidate = z.infer<typeof agentCandidateSchema>;

export const agentListInputSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export type AgentListInput = z.infer<typeof agentListInputSchema>;

export const agentConfigureInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    agent: agentDescriptorSchema,
  })
  .strict();
export type AgentConfigureInput = z.infer<typeof agentConfigureInputSchema>;

export const agentForgetInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    agentId: z.string().min(1).max(64),
  })
  .strict();
export type AgentForgetInput = z.infer<typeof agentForgetInputSchema>;

export function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const agentCandidatesIpcResponseSchema = ipcResult(
  z.array(agentCandidateSchema).readonly(),
);
export const agentSessionIpcResponseSchema = ipcResult(agentSessionStateSchema);
export const agentSessionListIpcResponseSchema = ipcResult(
  z.array(agentSessionStateSchema).readonly(),
);
export const agentVoidIpcResponseSchema = ipcResult(z.null());

/** BuilderHelm-owned history. The ACP session id on it is continuation metadata. */
export const agentThreadSchema = z
  .object({
    id: z.string().uuid(),
    acpSessionId: agentSessionIdSchema.nullable(),
    /** The roster profile that started it; null for threads started ad hoc. */
    profileId: z.string().max(64).nullable(),
    /**
     * The login the thread started on (`claude:<id>`). Its conversation lives
     * in that login's folder, so it only continues there. Null for threads
     * from before logins were recorded, or agents without logins.
     */
    accountRef: z.string().max(128).nullable(),
    agent: agentDescriptorSchema,
    cwd: z.string().min(1).max(4096),
    title: z.string().min(1).max(200).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AgentThread = z.infer<typeof agentThreadSchema>;

export const agentThreadGetInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    threadId: z.string().uuid(),
  })
  .strict();

export const agentTranscriptSchema = z
  .object({
    thread: agentThreadSchema,
    events: z.array(agentSessionEventSchema).max(50_000).readonly(),
  })
  .strict();
export type AgentTranscript = z.infer<typeof agentTranscriptSchema>;

export const agentDiffInputSchema = z
  .object({
    correlationId: correlationIdSchema,
    sessionId: agentSessionIdSchema,
    path: z.string().min(1).max(4096),
    action: z.enum(['apply', 'revert']),
  })
  .strict();

export const agentThreadListIpcResponseSchema = ipcResult(
  z.array(agentThreadSchema).readonly(),
);
export const agentTranscriptIpcResponseSchema = ipcResult(agentTranscriptSchema);

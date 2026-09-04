/**
 * One ACP session: a spawned agent, its handshake, and its event stream.
 *
 * This is where the host side of [ADR 0008](../../../../../docs/adr/0008-agent-client-protocol-host.md)
 * lives. The agent owns its authentication, models, and billing. BuilderHelm
 * owns the workspace, and answers `fs/*` for it, so an agent gets file access
 * only through us and only inside the session root.
 *
 * Permission is the one place the flow reverses: the agent blocks on a request
 * until a person answers. Claude Code auto-denies instead of waiting, so a
 * dropped request silently disables the agent rather than hanging it, which is
 * why an unanswerable request is rejected explicitly rather than ignored.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import type {
  AgentAuthMethod,
  AgentCapabilities,
  AgentConfigOption,
  AgentContent,
  AgentDescriptor,
  AgentPermissionDecision,
  AgentPermissionOption,
  AgentSessionEvent,
  AgentToolCall,
} from '@builderhelm/protocol';
import { BuilderHelmError } from '@builderhelm/shared';

import { AcpConnection } from './connection.js';
import {
  ACP_PROTOCOL_VERSION,
  choosePermissionOption,
  mapAuthMethods,
  mapCapabilities,
  mapConfigOptions,
  mapContent,
  mapPermissionOptions,
  mapPlan,
  mapStopReason,
  mapToolCall,
  mapUsage,
  toWireContent,
} from './mapping.js';

export type AgentEventSink = (event: AgentSessionEvent) => void;

/** Answers a permission request, or null when nobody can be asked. */
export type PermissionResolver = (request: {
  readonly requestId: string;
  readonly sessionId: string;
  readonly toolCall: AgentToolCall;
  readonly options: readonly AgentPermissionOption[];
}) => Promise<AgentPermissionDecision>;

export interface AcpSessionOptions {
  readonly agent: AgentDescriptor;
  readonly cwd: string;
  readonly emit: AgentEventSink;
  readonly resolvePermission: PermissionResolver;
  /** Prior ACP session to `session/load`. Null starts a new one. */
  readonly resumeSessionId?: string | null;
}

interface PendingPermission {
  readonly options: readonly AgentPermissionOption[];
}

/**
 * ACP has no error code for "needs sign-in", so the message is the only signal.
 * Matching on text is unpleasant and version-fragile, which is why a miss only
 * costs the sign-in affordance: the failure is reported either way.
 *
 * Observed: `opencode acp` says "Authentication required: provider
 * authentication required".
 */
function isAuthFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('authentication required') ||
    lower.includes('not authenticated') ||
    lower.includes('unauthorized') ||
    lower.includes('please log in') ||
    lower.includes('please sign in')
  );
}

/** Refuses any path that would walk above `cwd`. */
export function confinePath(cwd: string, candidate: unknown): string {
  const path = typeof candidate === 'string' ? candidate : '';
  if (path.length === 0 || !isAbsolute(path)) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'The agent asked for a relative path.',
    );
  }
  const root = resolve(cwd);
  const target = resolve(path);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new BuilderHelmError(
      'PERMISSION_DENIED',
      'The agent asked for a file outside this workspace.',
      { metadata: { path: target } },
    );
  }
  return target;
}

export class AcpSession {
  private readonly connection: AcpConnection;
  private readonly tools = new Map<string, AgentToolCall>();
  private readonly permissions = new Map<string, PendingPermission>();
  private sessionId: string | null = null;
  private capabilities: AgentCapabilities | null = null;
  private configOptions: readonly AgentConfigOption[] = [];
  private activeTurnId: string | null = null;
  /**
   * Kept past the handshake because an agent can start a session fine and only
   * fail on the first turn, when it discovers the selected model needs sign-in.
   * The methods it advertised are the only actionable thing to show then.
   */
  private authMethods: readonly AgentAuthMethod[] = [];

  private constructor(private readonly options: AcpSessionOptions) {
    this.connection = new AcpConnection({
      command: options.agent.command,
      args: options.agent.args,
      cwd: options.cwd,
      onExit: (code, stderr) => {
        this.options.emit({
          type: 'session.exited',
          sessionId: this.sessionId ?? '',
          code,
          message: stderr.length === 0 ? null : stderr.slice(-2048),
        });
      },
      onTransportError: (error) => {
        this.options.emit({
          type: 'turn.failed',
          sessionId: this.sessionId ?? '',
          turnId: this.activeTurnId ?? randomUUID(),
          message: error.message,
          raw: null,
        });
      },
    });

    // Registered before initialize: the agent may call us the moment it starts.
    this.connection.handleNotification('session/update', (params) =>
      this.onUpdate(params),
    );
    this.connection.handleRequest('session/request_permission', (params) =>
      this.onPermission(params),
    );
    this.connection.handleRequest('fs/read_text_file', (params) =>
      this.onReadFile(params),
    );
    this.connection.handleRequest('fs/write_text_file', (params) =>
      this.onWriteFile(params),
    );
  }

  static async start(options: AcpSessionOptions): Promise<AcpSession> {
    const session = new AcpSession(options);
    await session.handshake();
    return session;
  }

  get id(): string {
    if (this.sessionId === null) {
      throw new BuilderHelmError('INTERNAL_ERROR', 'The agent session has not started.');
    }
    return this.sessionId;
  }

  /** Post-handshake, so the manager can seed mirrored state without re-parsing. */
  get capabilitySnapshot(): AgentCapabilities {
    if (this.capabilities === null) {
      throw new BuilderHelmError('INTERNAL_ERROR', 'The agent session has not started.');
    }
    return this.capabilities;
  }

  get configSnapshot(): readonly AgentConfigOption[] {
    return this.configOptions;
  }

  private async handshake(): Promise<void> {
    const initialize = await this.connection.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      // Declaring these is what makes the agent route file access through us
      // instead of touching the disk itself.
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: 'BuilderHelm', version: '1' },
    });

    const negotiated = (initialize as { protocolVersion?: unknown }).protocolVersion;
    if (typeof negotiated === 'number' && negotiated !== ACP_PROTOCOL_VERSION) {
      await this.connection.close();
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        `${this.options.agent.label} speaks ACP v${negotiated}, and this build speaks v${ACP_PROTOCOL_VERSION}.`,
        { metadata: { agentId: this.options.agent.id, negotiated } },
      );
    }

    this.capabilities = mapCapabilities(initialize);
    this.authMethods = mapAuthMethods(initialize);

    const loaded = await this.openSession();
    this.sessionId = loaded.sessionId;
    this.configOptions = loaded.configOptions;
    this.options.emit({
      type: 'session.started',
      sessionId: loaded.sessionId,
      capabilities: this.capabilities,
      configOptions: this.configOptions,
    });
  }

  private async openSession(): Promise<{
    sessionId: string;
    configOptions: readonly AgentConfigOption[];
  }> {
    const resumeId = this.options.resumeSessionId;
    if (
      resumeId !== undefined &&
      resumeId !== null &&
      resumeId.length > 0 &&
      this.capabilities?.loadSession === true
    ) {
      try {
        const loaded = await this.connection.request('session/load', {
          sessionId: resumeId,
        });
        return { sessionId: resumeId, configOptions: mapConfigOptions(loaded) };
      } catch {
        // History is ours. Starting fresh is honest; pretending the agent
        // remembered would make the next turn look like amnesia in the agent.
      }
    }

    const created = await this.connection.request('session/new', {
      cwd: this.options.cwd,
      mcpServers: [],
    });
    const newSessionId = (created as { sessionId?: unknown }).sessionId;
    if (typeof newSessionId !== 'string' || newSessionId.length === 0) {
      await this.connection.close();
      const methods = this.authMethods;
      throw new BuilderHelmError(
        'AUTH_FAILED',
        methods.length === 0
          ? `${this.options.agent.label} did not start a session.`
          : `${this.options.agent.label} needs you to sign in first.`,
        {
          metadata: {
            agentId: this.options.agent.id,
            authMethods: methods.map((m) => m.id),
          },
        },
      );
    }
    return { sessionId: newSessionId, configOptions: mapConfigOptions(created) };
  }

  async prompt(content: readonly AgentContent[]): Promise<void> {
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    const text = content
      .filter(
        (part): part is Extract<AgentContent, { type: 'text' }> => part.type === 'text',
      )
      .map((part) => part.text)
      .join('');
    this.options.emit({ type: 'message.user', sessionId: this.id, turnId, text });
    this.options.emit({ type: 'turn.started', sessionId: this.id, turnId });
    try {
      const result = await this.connection.request(
        'session/prompt',
        { sessionId: this.id, prompt: content.map(toWireContent) },
        // A turn can legitimately run for many minutes; the transport default is
        // for handshake-shaped calls, not for work.
        30 * 60_000,
      );
      this.options.emit({
        type: 'turn.completed',
        sessionId: this.id,
        turnId,
        stopReason: mapStopReason(result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The turn failed.';
      // A session can start cleanly and only fail on the first turn, when the
      // agent discovers the selected model needs sign-in. That is not a broken
      // turn, it is a sign-in the person can act on, so it gets the event that
      // carries the routes the agent offered rather than a dead error string.
      if (isAuthFailure(message)) {
        this.options.emit({
          type: 'session.auth.required',
          sessionId: this.id,
          methods: this.authMethods,
        });
      }
      this.options.emit({
        type: 'turn.failed',
        sessionId: this.id,
        turnId,
        message,
        raw: null,
      });
    } finally {
      this.activeTurnId = null;
      this.tools.clear();
    }
  }

  /** A notification: the agent still answers the prompt, with `cancelled`. */
  cancel(): void {
    if (this.sessionId === null) return;
    this.connection.notify('session/cancel', { sessionId: this.sessionId });
    for (const [requestId] of this.permissions) {
      this.options.emit({
        type: 'permission.resolved',
        sessionId: this.sessionId,
        requestId,
        decision: 'cancelled',
      });
    }
    this.permissions.clear();
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    const result = await this.connection.request('session/set_config_option', {
      sessionId: this.id,
      configId,
      value,
      ...(typeof value === 'boolean' ? { type: 'boolean' } : {}),
    });
    // The reply is the complete config state, because changing a model can
    // change which reasoning levels exist.
    this.configOptions = mapConfigOptions(result);
    this.options.emit({
      type: 'session.config.updated',
      sessionId: this.id,
      configOptions: this.configOptions,
    });
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  private onUpdate(params: unknown): void {
    const envelope = (params ?? {}) as { sessionId?: unknown; update?: unknown };
    const sessionId =
      typeof envelope.sessionId === 'string' ? envelope.sessionId : this.sessionId;
    if (sessionId === null || sessionId !== this.sessionId) return;
    const update = (envelope.update ?? {}) as Record<string, unknown>;
    // Turn-scoped events still need an id during replay, when no turn is live.
    const turnId = this.activeTurnId ?? randomUUID();

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const content = mapContent(update.content);
        if (content?.type !== 'text' || content.text.length === 0) return;
        this.options.emit({
          type: 'message.delta',
          sessionId,
          turnId,
          text: content.text,
        });
        return;
      }
      case 'agent_thought_chunk': {
        const content = mapContent(update.content);
        if (content?.type !== 'text' || content.text.length === 0) return;
        this.options.emit({
          type: 'thought.delta',
          sessionId,
          turnId,
          text: content.text,
        });
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const id = typeof update.toolCallId === 'string' ? update.toolCallId : null;
        const previous = id === null ? undefined : this.tools.get(id);
        const call = mapToolCall(update, previous);
        if (call === null) return;
        this.tools.set(call.toolCallId, call);
        this.options.emit({
          type: 'tool.updated',
          sessionId,
          turnId,
          call,
          raw: JSON.stringify(update).slice(0, 65_536),
        });
        return;
      }
      case 'plan': {
        this.options.emit({
          type: 'plan.updated',
          sessionId,
          turnId,
          entries: mapPlan(update),
        });
        return;
      }
      case 'usage_update': {
        this.options.emit({ type: 'usage.updated', sessionId, usage: mapUsage(update) });
        return;
      }
      case 'config_option_update': {
        this.configOptions = mapConfigOptions(update);
        this.options.emit({
          type: 'session.config.updated',
          sessionId,
          configOptions: this.configOptions,
        });
        return;
      }
      default:
        // 11 variants exist and more will be added; an unrecognised one is not
        // an error, it is a variant this build does not render.
        return;
    }
  }

  private async onPermission(params: unknown): Promise<unknown> {
    const request = (params ?? {}) as Record<string, unknown>;
    const options = mapPermissionOptions(request);
    const call = mapToolCall(request.toolCall);
    if (this.sessionId === null || options.length === 0 || call === null) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const requestId = randomUUID();
    this.permissions.set(requestId, { options });
    this.options.emit({
      type: 'permission.requested',
      sessionId: this.sessionId,
      turnId: this.activeTurnId ?? randomUUID(),
      request: { requestId, sessionId: this.sessionId, toolCall: call, options },
    });

    let decision: AgentPermissionDecision;
    try {
      decision = await this.options.resolvePermission({
        requestId,
        sessionId: this.sessionId,
        toolCall: call,
        options,
      });
    } catch {
      decision = 'cancelled';
    }
    this.permissions.delete(requestId);

    this.options.emit({
      type: 'permission.resolved',
      sessionId: this.sessionId,
      requestId,
      decision,
    });

    if (decision === 'cancelled') return { outcome: { outcome: 'cancelled' } };
    const chosen = choosePermissionOption(options, decision);
    if (chosen === null) return { outcome: { outcome: 'cancelled' } };
    return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
  }

  /**
   * Confines a path to the session root. An agent asking to read outside the
   * workspace is refused: the grant it was given was this directory, and
   * `..` should not widen it.
   */
  confine(candidate: unknown): string {
    return confinePath(this.options.cwd, candidate);
  }

  private async onReadFile(params: unknown): Promise<unknown> {
    const request = (params ?? {}) as Record<string, unknown>;
    const path = this.confine(request.path);
    const content = await readFile(path, 'utf8');
    const line = request.line;
    const limit = request.limit;
    if (typeof line !== 'number' && typeof limit !== 'number') return { content };
    // ACP line numbers are 1-based.
    const lines = content.split('\n');
    const from = typeof line === 'number' && line > 0 ? line - 1 : 0;
    const to = typeof limit === 'number' && limit > 0 ? from + limit : lines.length;
    return { content: lines.slice(from, to).join('\n') };
  }

  private async onWriteFile(params: unknown): Promise<unknown> {
    const request = (params ?? {}) as Record<string, unknown>;
    const path = this.confine(request.path);
    const content = typeof request.content === 'string' ? request.content : '';
    // ACP requires the client to create a missing file, parents included.
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
    return null;
  }
}

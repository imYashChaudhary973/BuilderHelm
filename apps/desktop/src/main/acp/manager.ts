/**
 * Owns every live agent session and the approval loop around them.
 *
 * The approval loop is the reason this exists rather than the renderer talking
 * to sessions directly. An agent blocks a tool call on an answer, and Claude
 * Code auto-denies instead of waiting, so a request that reaches nobody
 * silently disables the agent. That makes the answer path the load-bearing part:
 * a remembered rule answers immediately, and anything else is put to the person
 * with a deadline, because a request that is never answered must fail closed
 * rather than wedge the turn forever.
 */
import type {
  AgentDescriptor,
  AgentPermissionDecision,
  AgentPermissionOption,
  AgentProfile,
  AgentSessionEvent,
  AgentSessionState,
  AgentThread,
  AgentToolCall,
} from '@builderhelm/protocol';
import { BuilderHelmError } from '@builderhelm/shared';

import { AcpSession, confinePath } from './session.js';
import type { PermissionRules } from './permission-rules.js';
import type { AgentThreads } from './threads.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * How many agents may run at once. A named roster makes it easy to start
 * several; each one is a real process, so the ceiling is hard.
 */
export const MAX_LIVE_AGENT_SESSIONS = 8;

/**
 * How long an unanswered request waits before it is refused. Long enough that a
 * person can read a diff and decide, short enough that a forgotten prompt does
 * not hold a turn open indefinitely.
 */
const APPROVAL_DEADLINE_MS = 10 * 60_000;

interface Waiter {
  readonly resolve: (decision: AgentPermissionDecision) => void;
  readonly timer: NodeJS.Timeout;
}

interface Entry {
  readonly session: AcpSession;
  readonly agent: AgentDescriptor;
  readonly cwd: string;
  readonly threadId: string;
  state: AgentSessionState;
  /** Which tool kind each pending request was for, so answering can store a rule. */
  readonly pendingKinds: Map<string, AgentToolCall['kind']>;
}

export interface AgentManagerOptions {
  /** Pushes an event to the renderer. */
  readonly emit: (event: AgentSessionEvent) => void;
  readonly rules: PermissionRules;
  readonly threads: AgentThreads;
  readonly resolveAgent: (agentId: string) => AgentDescriptor | null;
  readonly resolveProfile: (profileId: string) => AgentProfile | null;
}

export class AgentManager {
  private readonly sessions = new Map<string, Entry>();
  private readonly waiters = new Map<string, Waiter>();

  constructor(private readonly options: AgentManagerOptions) {}

  async start(input: {
    agentId: string;
    cwd: string;
    threadId: string | null;
    resumeSessionId: string | null;
    profileId: string | null;
  }): Promise<AgentSessionState> {
    const existing = this.findLive(input.threadId);
    if (existing !== undefined) return existing.state;

    if (this.sessions.size >= MAX_LIVE_AGENT_SESSIONS) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        `Close an agent chat before starting another — BuilderHelm runs at most ${MAX_LIVE_AGENT_SESSIONS} at once.`,
        { metadata: { limit: MAX_LIVE_AGENT_SESSIONS } },
      );
    }

    const stored =
      input.threadId === null ? null : this.options.threads.get(input.threadId);
    if (input.threadId !== null && stored === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That conversation was not found.',
        {
          metadata: { threadId: input.threadId },
        },
      );
    }

    let agent: AgentDescriptor | null;
    if (stored === null && input.profileId !== null) {
      // A profile-backed thread resolves argv here, in main; the renderer
      // named the profile, never the command.
      const profile = this.options.resolveProfile(input.profileId);
      if (profile === null) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'That agent profile was not found.',
          { metadata: { profileId: input.profileId } },
        );
      }
      agent = { ...profile.agent, args: [...profile.agent.args] };
    } else {
      agent =
        stored === null ? this.options.resolveAgent(input.agentId) : stored.thread.agent;
    }
    if (agent === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        `No agent is configured as "${input.agentId}".`,
        { metadata: { agentId: input.agentId } },
      );
    }

    const cwd = stored === null ? input.cwd : stored.thread.cwd;
    const thread =
      stored === null
        ? this.options.threads.create(agent, cwd, input.profileId)
        : stored.thread;
    const resumeSessionId = input.resumeSessionId ?? stored?.thread.acpSessionId ?? null;

    let entry: Entry | null = null;
    const session = await AcpSession.start({
      agent,
      cwd,
      resumeSessionId,
      emit: (event) => {
        this.options.threads.append(thread.id, event);
        if (entry !== null) applyToState(entry, event);
        this.options.emit(event);
        if (event.type === 'session.exited') this.sessions.delete(event.sessionId);
      },
      resolvePermission: async (request) => await this.decide(cwd, request),
    });

    const started: Entry = {
      session,
      agent,
      cwd,
      threadId: thread.id,
      state: {
        sessionId: session.id,
        threadId: thread.id,
        agent,
        cwd,
        capabilities: session.capabilitySnapshot,
        configOptions: session.configSnapshot,
        auth: 'authenticated',
        activeTurnId: null,
      },
      pendingKinds: new Map(),
    };
    entry = started;
    this.sessions.set(session.id, started);
    this.options.threads.attach(thread.id, session.id);
    return started.state;
  }

  threads(): AgentThread[] {
    return this.options.threads.list();
  }

  transcript(threadId: string): { thread: AgentThread; events: AgentSessionEvent[] } {
    const stored = this.options.threads.get(threadId);
    if (stored === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That conversation was not found.',
        {
          metadata: { threadId },
        },
      );
    }
    return stored;
  }

  /**
   * Writes the last diff for `path`. Apply uses newText; revert uses oldText.
   * Paths stay inside the session cwd — same rule as the agent's own writes.
   */
  async applyDiff(
    sessionId: string,
    path: string,
    action: 'apply' | 'revert',
  ): Promise<void> {
    const entry = this.require(sessionId);
    const diff = lastDiff(this.options.threads.events(entry.threadId), path);
    if (diff === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'No diff is recorded for that path.',
        {
          metadata: { path },
        },
      );
    }
    const text = action === 'apply' ? diff.newText : diff.oldText;
    if (text === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The original text was not recorded, so this cannot be reverted.',
        { metadata: { path } },
      );
    }
    const target = confinePath(entry.cwd, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, text, 'utf8');
  }

  read(sessionId: string): AgentSessionState {
    return this.require(sessionId).state;
  }

  list(): AgentSessionState[] {
    return [...this.sessions.values()].map((entry) => entry.state);
  }

  private findLive(threadId: string | null): Entry | undefined {
    if (threadId === null) return undefined;
    return [...this.sessions.values()].find((entry) => entry.threadId === threadId);
  }

  /** Returns once the turn ends; progress arrives as events. */
  async prompt(
    sessionId: string,
    content: Parameters<AcpSession['prompt']>[0],
  ): Promise<void> {
    await this.require(sessionId).session.prompt(content);
  }

  cancel(sessionId: string): void {
    this.require(sessionId).session.cancel();
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    await this.require(sessionId).session.setConfigOption(configId, value);
  }

  /**
   * Answers a pending request. Unknown ids are ignored rather than thrown: a
   * duplicate click, or an answer arriving after a cancel, is ordinary.
   */
  respond(sessionId: string, requestId: string, decision: AgentPermissionDecision): void {
    const waiter = this.waiters.get(requestId);
    if (waiter === undefined) return;
    this.waiters.delete(requestId);
    clearTimeout(waiter.timer);

    const entry = this.sessions.get(sessionId);
    if (entry !== undefined) {
      const kind = entry.pendingKinds.get(requestId);
      if (kind !== undefined) {
        this.options.rules.remember(entry.cwd, kind, decision);
        entry.pendingKinds.delete(requestId);
      }
    }
    waiter.resolve(decision);
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) return;
    this.sessions.delete(sessionId);
    await entry.session.close();
  }

  /** Closes everything, for app shutdown. */
  async closeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve('cancelled');
    }
    this.waiters.clear();
    await Promise.all(entries.map(async (entry) => await entry.session.close()));
  }

  private async decide(
    cwd: string,
    request: {
      readonly requestId: string;
      readonly sessionId: string;
      readonly toolCall: AgentToolCall;
      readonly options: readonly AgentPermissionOption[];
    },
  ): Promise<AgentPermissionDecision> {
    const remembered = this.options.rules.lookup(cwd, request.toolCall.kind);
    if (remembered !== null) return remembered;

    const entry = this.sessions.get(request.sessionId);
    entry?.pendingKinds.set(request.requestId, request.toolCall.kind);

    return await new Promise<AgentPermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(request.requestId);
        // Fail closed. An unanswered request is a request nobody approved.
        resolve('reject-once');
      }, APPROVAL_DEADLINE_MS);
      timer.unref();
      this.waiters.set(request.requestId, { resolve, timer });
    });
  }

  private require(sessionId: string): Entry {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That agent session is no longer running.',
        {
          metadata: { sessionId },
        },
      );
    }
    return entry;
  }
}

function applyToState(entry: Entry, event: AgentSessionEvent): void {
  switch (event.type) {
    case 'session.started':
      entry.state = {
        ...entry.state,
        capabilities: event.capabilities,
        configOptions: event.configOptions,
      };
      return;
    case 'session.config.updated':
      entry.state = { ...entry.state, configOptions: event.configOptions };
      return;
    case 'session.auth.required':
      entry.state = { ...entry.state, auth: 'required' };
      return;
    case 'turn.started':
      entry.state = { ...entry.state, activeTurnId: event.turnId };
      return;
    case 'turn.completed':
    case 'turn.failed':
      entry.state = { ...entry.state, activeTurnId: null };
      return;
    default:
      return;
  }
}

function lastDiff(
  events: readonly AgentSessionEvent[],
  path: string,
): { oldText: string | null; newText: string } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== 'tool.updated') continue;
    for (const part of event.call.content) {
      if (part.type === 'diff' && part.path === path) {
        return { oldText: part.oldText, newText: part.newText };
      }
    }
  }
  return null;
}

import type {
  AgentCandidate,
  AgentConfigOption,
  AgentPermissionRequest,
  AgentProfile,
  AgentSessionEvent,
  AgentSessionState,
  AgentThread,
  AgentToolCall,
  AgentUsage,
} from '@builderhelm/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import { bootDictation } from '../voice/dictation.js';
import { buildConfigChips, compactTokens, earlierWindow } from '../routes/chat-cells.js';
import { deriveStatus } from '../routes/chat-status.js';
import { ArrowUpIcon, SettingsIcon } from './rail-icons.js';
import { ProfileMark } from './agent-roster.js';
import { ModelPicker } from './model-picker.js';

export function threadTitle(thread: AgentThread): string {
  return thread.title ?? 'Untitled thread';
}

const CHAT_STARTERS = [
  'Plan the next release',
  'Review the current code',
  'Draft an introduction',
] as const;

interface TurnBlock {
  readonly turnId: string;
  user: string;
  assistant: string;
  thought: string;
  tools: AgentToolCall[];
  plan: string[];
  error: string | null;
  streaming: boolean;
}

function foldTurns(events: readonly AgentSessionEvent[]): TurnBlock[] {
  const byId = new Map<string, TurnBlock>();
  const order: string[] = [];
  function block(turnId: string): TurnBlock {
    const existing = byId.get(turnId);
    if (existing !== undefined) return existing;
    const created: TurnBlock = {
      turnId,
      user: '',
      assistant: '',
      thought: '',
      tools: [],
      plan: [],
      error: null,
      streaming: true,
    };
    byId.set(turnId, created);
    order.push(turnId);
    return created;
  }
  for (const event of events) {
    switch (event.type) {
      case 'message.user':
        block(event.turnId).user += event.text;
        break;
      case 'message.delta':
        block(event.turnId).assistant += event.text;
        break;
      case 'thought.delta':
        block(event.turnId).thought += event.text;
        break;
      case 'tool.updated': {
        const turn = block(event.turnId);
        const index = turn.tools.findIndex(
          (tool) => tool.toolCallId === event.call.toolCallId,
        );
        if (index >= 0) turn.tools[index] = event.call;
        else turn.tools.push(event.call);
        break;
      }
      case 'plan.updated':
        block(event.turnId).plan = event.entries.map((entry) => entry.content);
        break;
      case 'turn.completed':
        block(event.turnId).streaming = false;
        break;
      case 'turn.failed':
        block(event.turnId).streaming = false;
        block(event.turnId).error = event.message;
        break;
      default:
        break;
    }
  }
  return order
    .map((id) => byId.get(id))
    .filter((item): item is TurnBlock => item !== undefined);
}

function pendingPermission(
  events: readonly AgentSessionEvent[],
): AgentPermissionRequest | null {
  const resolved = new Set<string>();
  let pending: AgentPermissionRequest | null = null;
  for (const event of events) {
    if (event.type === 'permission.resolved') resolved.add(event.requestId);
    if (event.type === 'permission.requested' && !resolved.has(event.request.requestId)) {
      pending = event.request;
    }
  }
  return pending;
}

function lastUsage(events: readonly AgentSessionEvent[]): AgentUsage | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'usage.updated') return event.usage;
  }
  return null;
}

function lastAuth(events: readonly AgentSessionEvent[]): AgentSessionEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'session.auth.required') return event;
  }
  return null;
}

function configByCategory(
  options: readonly AgentConfigOption[],
  category: AgentConfigOption['category'],
): AgentConfigOption[] {
  return options.filter((option) => option.category === category);
}

/** The current model choice's label, or null before a session exists. */
function currentModelLabel(session: AgentSessionState | null): string | null {
  const options = configByCategory(session?.configOptions ?? [], 'model');
  for (const option of options) {
    const choice = option.choices.find((item) => item.value === String(option.value));
    if (choice !== undefined) return choice.label;
  }
  return null;
}

/**
 * The chat surface shared by the Chats tab and the Agents roster: header,
 * transcript, and composer. Everything that differs — the aside, how the
 * active thread and cwd are chosen — arrives through `profile` (Agents mode)
 * versus `fallbackCwd` (Chats mode).
 */
export function ChatPane({
  profile,
  fallbackCwd,
  threads,
  activeThreadId,
  onActiveThreadChange,
  onThreadsChanged,
  onUsage,
  onEditProfile,
  onStreamingChange,
  kind = 'threads',
}: {
  readonly profile: AgentProfile | null;
  readonly fallbackCwd: string;
  readonly threads: readonly AgentThread[];
  readonly activeThreadId: string | null;
  readonly onActiveThreadChange: (threadId: string | null) => void;
  readonly onThreadsChanged: (threads: readonly AgentThread[]) => void;
  readonly onUsage?: (usage: {
    tokens: number | null;
    modelLabel: string | null;
  }) => void;
  readonly onEditProfile?: (profile: AgentProfile) => void;
  readonly onStreamingChange?: (streaming: boolean) => void;
  readonly kind?: 'roster' | 'threads';
}): React.JSX.Element {
  const [candidates, setCandidates] = useState<readonly AgentCandidate[]>([]);
  const [events, setEvents] = useState<AgentSessionEvent[]>([]);
  const loadedThreadIdRef = useRef<string | null>(null);
  const [session, setSession] = useState<AgentSessionState | null>(null);
  const [agentId, setAgentId] = useState('');
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Which composer chip's choice popover is open, if any. */
  const [connecting, setConnecting] = useState(false);
  const [showAllTurns, setShowAllTurns] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = session?.sessionId ?? null;
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const cwd = profile === null ? fallbackCwd : (profile.defaultCwd ?? '');
  const activeThread = threads.find((item) => item.id === activeThreadId) ?? null;

  const runnable = candidates.filter(
    (candidate) => candidate.available || candidate.configured,
  );
  const selected =
    runnable.find((candidate) => candidate.id === agentId) ?? runnable[0] ?? null;
  const turns = useMemo(() => foldTurns(events), [events]);
  const permission = useMemo(() => pendingPermission(events), [events]);
  const usage = lastUsage(events);
  const auth = session?.auth === 'required' ? lastAuth(events) : null;
  const { chips, overflow } = useMemo(
    () => buildConfigChips(session?.configOptions ?? []),
    [session?.configOptions],
  );
  const hiddenTurns = showAllTurns ? 0 : earlierWindow(turns.length);
  const visibleTurns = hiddenTurns > 0 ? turns.slice(hiddenTurns) : turns;
  const permissionCellId = permission?.toolCall.toolCallId ?? null;
  const permissionHasCell = turns.some((turn) =>
    turn.tools.some((tool) => tool.toolCallId === permissionCellId),
  );
  const status = deriveStatus({
    streaming,
    permissionPending: permission !== null,
    authRequired: session?.auth === 'required',
  });
  const modelLabel = currentModelLabel(session);

  useEffect(() => {
    onUsage?.({ tokens: usage?.usedTokens ?? null, modelLabel });
  }, [usage, modelLabel, onUsage]);

  useEffect(() => {
    onStreamingChange?.(streaming || connecting);
  }, [streaming, connecting, onStreamingChange]);

  useEffect(() => {
    let active = true;
    void window.builderHelm.agents
      .candidates()
      .then((nextCandidates) => {
        if (!active) return;
        setCandidates(nextCandidates);
        const firstRunnable =
          nextCandidates.find((candidate) => candidate.configured) ??
          nextCandidates.find((candidate) => candidate.available);
        if (firstRunnable !== undefined) setAgentId(firstRunnable.id);
      })
      .catch(() => active && setError('Agent chat could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // A new selection — from the roster, the Chats aside, or "New chat" —
  // drops the live session and loads that thread's stored transcript.
  useEffect(() => {
    if (loading) return;
    if (loadedThreadIdRef.current === activeThreadId) return;
    loadedThreadIdRef.current = activeThreadId;
    setShowAllTurns(false);
    setSession(null);
    if (activeThreadId === null) {
      setEvents([]);
      return;
    }
    let active = true;
    void Promise.all([
      window.builderHelm.agents.transcript(activeThreadId),
      window.builderHelm.agents.sessions(),
    ])
      .then(([stored, sessions]) => {
        if (!active) return;
        const live = sessions.find((item) => item.threadId === activeThreadId) ?? null;
        setEvents([...stored.events]);
        setSession(live);
        sessionIdRef.current = live?.sessionId ?? null;
        setStreaming(live?.activeTurnId != null);
      })
      .catch(() => {
        if (active) setError('This conversation could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [activeThreadId, loading]);

  useEffect(() => {
    return window.builderHelm.agents.onEvent((event) => {
      if (sessionIdRef.current === null || event.sessionId !== sessionIdRef.current)
        return;
      setSession((current) => {
        if (current === null || event.sessionId !== current.sessionId) return current;
        if (event.type === 'session.config.updated') {
          return { ...current, configOptions: event.configOptions };
        }
        if (event.type === 'session.auth.required') {
          return { ...current, auth: 'required' };
        }
        if (event.type === 'turn.started') {
          return { ...current, activeTurnId: event.turnId };
        }
        if (event.type === 'turn.completed' || event.type === 'turn.failed') {
          return { ...current, activeTurnId: null };
        }
        if (event.type === 'session.exited') return null;
        return current;
      });
      setEvents((current) => [...current, event]);
    });
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events, streaming]);

  function refreshThreads(selectId?: string): Promise<void> {
    return window.builderHelm.agents.threads().then((next) => {
      onThreadsChanged(next);
      if (selectId !== undefined) onActiveThreadChange(selectId);
    });
  }

  function beginNewThread(): void {
    if (streaming) return;
    setError(null);
    setDraft('');
    setSession(null);
    setEvents([]);
    loadedThreadIdRef.current = null;
    onActiveThreadChange(null);
  }

  async function ensureSession(): Promise<AgentSessionState> {
    if (session !== null && session.threadId === activeThreadId) return session;
    if (profile === null) {
      if (selected === null) throw new Error('No agent is available on this machine.');
      if (cwd.length === 0)
        throw new Error('Open a Space so the agent has a project folder.');
      if (!selected.configured) {
        await window.builderHelm.agents.configure({
          id: selected.id,
          label: selected.label,
          command: selected.command,
          args: selected.args,
        });
      }
      const started = await window.builderHelm.agents.start({
        agentId: selected.id,
        cwd,
        threadId: activeThreadId,
        resumeSessionId: activeThread?.acpSessionId ?? null,
        profileId: activeThread?.profileId ?? null,
      });
      sessionIdRef.current = started.sessionId;
      setSession(started);
      loadedThreadIdRef.current = started.threadId;
      onActiveThreadChange(started.threadId);
      const stored = await window.builderHelm.agents.transcript(started.threadId);
      setEvents([...stored.events]);
      await refreshThreads(started.threadId);
      return started;
    }

    // Profile mode: the folder is the profile's, and main resolves the
    // profile's argv — the renderer never names a command here.
    if (profile.defaultCwd === null) {
      throw new Error('Pick a project folder for this agent first.');
    }
    const started = await window.builderHelm.agents.start({
      agentId: profile.agent.id,
      cwd: profile.defaultCwd,
      threadId: activeThreadId,
      resumeSessionId: activeThread?.acpSessionId ?? null,
      profileId: profile.id,
    });
    sessionIdRef.current = started.sessionId;
    setSession(started);
    loadedThreadIdRef.current = started.threadId;
    onActiveThreadChange(started.threadId);
    const stored = await window.builderHelm.agents.transcript(started.threadId);
    setEvents([...stored.events]);
    await refreshThreads(started.threadId);
    return started;
  }

  async function sendMessage(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0 || streaming || connecting) return;
    setError(null);
    setDraft('');
    setStreaming(true);
    try {
      const live = await ensureSession();
      await window.builderHelm.agents.prompt({
        sessionId: live.sessionId,
        content: [{ type: 'text', text }],
      });
      await refreshThreads(live.threadId);
    } catch (caught) {
      setDraft(text);
      setError(
        caught instanceof Error ? caught.message : 'The message could not be sent.',
      );
    } finally {
      setStreaming(false);
    }
  }

  async function stopTurn(): Promise<void> {
    if (session === null) return;
    try {
      await window.builderHelm.agents.cancel(session.sessionId);
    } catch {
      setError('The running turn could not be stopped.');
    }
  }

  async function answer(
    decision: AgentPermissionRequest['options'][number]['decision'],
  ): Promise<void> {
    if (permission === null) return;
    try {
      // The request carries its own session id: an answer must reach main even
      // if the renderer's session mirror dropped (exit, reload race) — a click
      // that silently no-ops would leave the agent blocked on a dead prompt.
      await window.builderHelm.agents.respondPermission({
        sessionId: permission.sessionId,
        requestId: permission.requestId,
        decision,
      });
      // Clear now; the broadcast copy (if it also arrives) is a no-op.
      setEvents((current) => [
        ...current,
        {
          type: 'permission.resolved',
          sessionId: permission.sessionId,
          requestId: permission.requestId,
          decision,
        },
      ]);
    } catch {
      setError('The approval could not be sent.');
    }
  }

  async function applyDiff(path: string, action: 'apply' | 'revert'): Promise<void> {
    if (session === null) return;
    try {
      await window.builderHelm.agents.applyDiff({
        sessionId: session.sessionId,
        path,
        action,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The file could not be updated.',
      );
    }
  }

  async function connectControls(): Promise<void> {
    if (connecting || streaming) return;
    setConnecting(true);
    setError(null);
    try {
      await ensureSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load agent controls.');
    } finally {
      setConnecting(false);
    }
  }

  async function setOptionRaw(configId: string, value: string | boolean): Promise<void> {
    if (session === null || streaming || connecting) return;
    setConnecting(true);
    try {
      await window.builderHelm.agents.setConfigOption({
        sessionId: session.sessionId,
        configId,
        value,
      });
    } catch {
      setError('That setting could not be changed.');
    } finally {
      setConnecting(false);
    }
  }

  const heading =
    profile !== null
      ? profile.name
      : activeThread !== null
        ? threadTitle(activeThread)
        : 'New conversation';

  return (
    <section
      className={
        !loading && turns.length === 0
          ? 'conversationPanel conversationPanelEmpty'
          : 'conversationPanel'
      }
      aria-label="Chat conversation"
      data-chat-kind={kind}
    >
      <header className="chatHeader">
        <div className="chatIdentity">
          {profile !== null && <ProfileMark profile={profile} size="head" />}
          <div>
            <h2>{profile?.name ?? (kind === 'roster' ? 'Your agent' : heading)}</h2>
            <p className="chatSubtitle">
              {profile !== null
                ? `Powered by ${profile.agent.label}`
                : (cwd.split('/').filter(Boolean).at(-1) ?? 'Choose a workspace')}
            </p>
          </div>
        </div>
        <div className="chatControls">
          <span className={`statusChip status-${status}`}>
            <span className="statusDot" aria-hidden="true" />
            {status === 'approval'
              ? 'Needs approval'
              : status === 'signin'
                ? 'Sign in'
                : status === 'working'
                  ? 'Working'
                  : 'Ready'}
          </span>
          {profile !== null && (
            <button
              type="button"
              className="topbarIcon"
              aria-label={`Edit ${profile.name}`}
              onClick={() => onEditProfile?.(profile)}
            >
              <SettingsIcon />
            </button>
          )}
        </div>
      </header>
      {kind === 'roster' && (
        <div className="conversationTabs">
          <button
            type="button"
            disabled={streaming || connecting}
            onClick={beginNewThread}
          >
            New chat <span aria-hidden="true">+</span>
          </button>
        </div>
      )}

      {error !== null && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}

      {auth !== null && auth.type === 'session.auth.required' && (
        <p className="chatError" role="status">
          {profile?.agent.label ?? selected?.label ?? 'This agent'} needs you to sign in
          with its own flow
          {auth.methods.length > 0
            ? `: ${auth.methods.map((method) => method.label).join(', ')}`
            : ''}
          . BuilderHelm never handles that credential.
        </p>
      )}

      {/* Inline on its cell when that cell exists; fallback bar otherwise. */}
      {permission !== null && session !== null && !permissionHasCell && (
        <div
          className="permissionBar"
          role="alertdialog"
          aria-label="Approve agent action"
        >
          <p>
            {permission.toolCall.title || permission.toolCall.kind}
            {permission.toolCall.paths[0] !== undefined
              ? ` · ${permission.toolCall.paths[0]}`
              : ''}
          </p>
          <div>
            {permission.options.map((option) => (
              <button
                type="button"
                key={option.optionId}
                className={
                  option.decision.startsWith('allow') ? 'sendButton' : 'stopButton'
                }
                onClick={() => void answer(option.decision)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="transcript" aria-live="polite" aria-busy={streaming}>
        {hiddenTurns > 0 && (
          <button
            type="button"
            className="earlierButton"
            onClick={() => setShowAllTurns(true)}
          >
            Show {hiddenTurns} earlier messages
          </button>
        )}
        {visibleTurns.map((turn) => (
          <article
            className={`chatTurn ${turn.user.length > 0 ? 'chatTurn-user' : ''} ${turn.streaming ? 'chatTurn-streaming' : 'chatTurn-assistant'}`}
            key={turn.turnId}
          >
            <div className="turnRail" aria-hidden="true">
              <span />
            </div>
            <div className="turnBody">
              {turn.user.length > 0 && (
                <>
                  <div className="turnMeta">
                    <span>you</span>
                  </div>
                  <p className="turnCopy">{turn.user}</p>
                </>
              )}
              {turn.thought.length > 0 && (
                <details className="thoughtCell">
                  <summary>Thoughts</summary>
                  <p className="thinkingLine">{turn.thought}</p>
                </details>
              )}
              {turn.plan.length > 0 && (
                <div className="goalCell">
                  <p className="goalCellTitle">Goal</p>
                  <ol className="planList">
                    {turn.plan.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ol>
                </div>
              )}
              {turn.tools.map((tool) => (
                <ToolView
                  key={tool.toolCallId}
                  call={tool}
                  canWrite={session !== null}
                  onDiff={applyDiff}
                  permission={
                    permission !== null &&
                    permission.toolCall.toolCallId === tool.toolCallId
                      ? permission
                      : null
                  }
                  onAnswer={answer}
                />
              ))}
              {turn.assistant.length > 0 && <p className="turnCopy">{turn.assistant}</p>}
              {turn.error !== null && <p className="chatError">{turn.error}</p>}
            </div>
          </article>
        ))}
        {!loading && turns.length === 0 && kind !== 'roster' && (
          <div className="chatWelcome">
            <h3>What should we work on?</h3>
            <p>Give your agent a task. Keep the conversation here.</p>
            <div className="welcomeStarters">
              {CHAT_STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="welcomeStarter"
                  onClick={() => setDraft(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={transcriptEnd} />
      </div>

      <form
        className="chatComposer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        {!loading && turns.length === 0 && kind === 'roster' && (
          <div className="agentWelcome">
            <h3>What should we build?</h3>
            {profile === null && <p>Create an agent to get started.</p>}
          </div>
        )}
        <div className="composerPill">
          <label className="srOnly" htmlFor="chat-message">
            Message
          </label>
          <textarea
            id="chat-message"
            value={draft}
            disabled={
              streaming ||
              connecting ||
              (profile === null && runnable.length === 0) ||
              cwd.length === 0
            }
            maxLength={100_000}
            rows={2}
            placeholder={
              runnable.length === 0
                ? 'Install an ACP agent to begin'
                : cwd.length === 0
                  ? profile !== null
                    ? 'Pick a project folder for this agent first'
                    : 'Open a Space so the agent has a folder'
                  : kind === 'roster' || profile !== null
                    ? 'Ask anything…'
                    : 'Ask about your code. @ a file, or add files and folders'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />

          <div className="composerBar">
            <div className="chipRow">
              <label
                className="composerSelect harnessSelect"
                title="Choose a harness for a new conversation"
              >
                <span className="providerDot" aria-hidden="true" />
                <span className="srOnly">Harness</span>
                <select
                  aria-label="Harness"
                  value={
                    profile?.agent.id ?? activeThread?.agent.id ?? selected?.id ?? ''
                  }
                  disabled={
                    streaming || connecting || profile !== null || runnable.length === 0
                  }
                  onChange={(event) => {
                    beginNewThread();
                    setAgentId(event.target.value);
                  }}
                >
                  {runnable.length === 0 && <option value="">No harness</option>}
                  {runnable.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              {session === null ? (
                <button
                  className="configChip"
                  type="button"
                  disabled={
                    connecting ||
                    streaming ||
                    cwd.length === 0 ||
                    (profile === null && selected === null)
                  }
                  onClick={() => void connectControls()}
                >
                  {connecting ? 'Connecting…' : 'Choose model & mode'}{' '}
                  <span aria-hidden="true">⌄</span>
                </button>
              ) : null}
              {chips.concat(overflow).map((chip) =>
                session?.configOptions.find((option) => option.id === chip.id)
                  ?.category === 'model' ? (
                  <ModelPicker
                    key={chip.id}
                    chip={chip}
                    disabled={streaming || connecting}
                    onSelect={(value) => void setOptionRaw(chip.id, value)}
                  />
                ) : chip.isToggle ? (
                  <button
                    key={chip.id}
                    className="configChip"
                    type="button"
                    aria-pressed={chip.value === true}
                    disabled={streaming || connecting}
                    onClick={() => void setOptionRaw(chip.id, !(chip.value === true))}
                  >
                    {chip.label}: {chip.currentLabel}
                  </button>
                ) : (
                  <label key={chip.id} className="composerSelect" title={chip.label}>
                    <span className="srOnly">{chip.label}</span>
                    <select
                      aria-label={chip.label}
                      value={String(chip.value)}
                      disabled={streaming || connecting}
                      onChange={(event) => void setOptionRaw(chip.id, event.target.value)}
                    >
                      {chip.choices.map((choice) => (
                        <option
                          key={choice.value}
                          value={choice.value}
                          title={choice.description ?? choice.label}
                        >
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}
              {session !== null && chips.length + overflow.length === 0 && (
                <span className="composerUnavailable">
                  This harness exposes no model or mode controls.
                </span>
              )}
            </div>
            <div className="composerFooter">
              <span className="composerTokens" title="Tokens used in this conversation">
                {usage !== null && usage.usedTokens !== null
                  ? compactTokens(usage.usedTokens)
                  : '—'}
              </span>

              <button
                type="button"
                className="micButton"
                aria-label="Dictate a message"
                title="Dictate (inserts into this box)"
                onClick={() => {
                  const box = document.querySelector('#chat-message');
                  if (box instanceof HTMLTextAreaElement) box.focus();
                  void bootDictation().start();
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0m-6 9v-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              {streaming ? (
                <button
                  type="button"
                  className="stopCircle"
                  aria-label="Stop the running turn"
                  title="Stop"
                  onClick={() => void stopTurn()}
                >
                  <span aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="sendCircle"
                  type="submit"
                  aria-label="Send message"
                  title="Send"
                  disabled={
                    connecting ||
                    draft.trim().length === 0 ||
                    (profile === null && (selected === null || cwd.length === 0)) ||
                    (profile !== null && profile.defaultCwd === null)
                  }
                >
                  <ArrowUpIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
function ToolView({
  call,
  canWrite,
  onDiff,
  permission,
  onAnswer,
}: {
  readonly call: AgentToolCall;
  readonly canWrite: boolean;
  readonly onDiff: (path: string, action: 'apply' | 'revert') => Promise<void>;
  /** Set when this call is the one awaiting the person's decision. */
  readonly permission: AgentPermissionRequest | null;
  readonly onAnswer: (
    decision: AgentPermissionRequest['options'][number]['decision'],
  ) => Promise<void>;
}): React.JSX.Element {
  const cellGlyph: Record<AgentToolCall['kind'], string> = {
    read: '›',
    edit: '✎',
    delete: '✕',
    move: '⇒',
    search: '⌕',
    execute: '▸',
    think: '◦',
    fetch: '⇣',
    other: '•',
  };
  return (
    <div className={`cellBlock cell-${call.status}`}>
      <div className="cellHead">
        <span className="cellGlyph" aria-hidden="true">
          {cellGlyph[call.kind]}
        </span>
        <span className="cellTitle">{call.title || call.kind}</span>
        {call.paths.slice(0, 3).map((path) => (
          <span className="cellChip" key={path} title={path}>
            {path.split('/').at(-1)}
          </span>
        ))}
        <span className="cellStatus">{call.status}</span>
      </div>
      {call.content.map((part, index) => {
        if (part.type === 'diff') {
          return (
            <div className="diffBlock" key={`${part.path}-${index}`}>
              <pre>{part.newText.slice(0, 4000)}</pre>
              {canWrite && (
                <div className="diffActions">
                  <button
                    type="button"
                    className="sendButton"
                    onClick={() => void onDiff(part.path, 'apply')}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="stopButton"
                    disabled={part.oldText === null}
                    onClick={() => void onDiff(part.path, 'revert')}
                  >
                    Revert
                  </button>
                </div>
              )}
            </div>
          );
        }
        if (part.type === 'content' && part.content.type === 'text') {
          return (
            <p className="turnCopy" key={index}>
              {part.content.text}
            </p>
          );
        }
        return null;
      })}
      {permission !== null && (
        <div
          className="cellApproval"
          role="alertdialog"
          aria-label="Approve agent action"
        >
          <span>Waiting for you</span>
          <div>
            {permission.options.map((option) => (
              <button
                type="button"
                key={option.optionId}
                className={
                  option.decision.startsWith('allow') ? 'sendButton' : 'stopButton'
                }
                onClick={() => void onAnswer(option.decision)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

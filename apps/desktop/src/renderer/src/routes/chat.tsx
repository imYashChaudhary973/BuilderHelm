import type {
  AgentCandidate,
  AgentConfigOption,
  AgentPermissionRequest,
  AgentSessionEvent,
  AgentSessionState,
  AgentThread,
  AgentToolCall,
  AgentUsage,
} from '@builderhelm/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSpaces } from '../space-store.js';

function shortTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function threadTitle(thread: AgentThread): string {
  return thread.title ?? 'Untitled thread';
}

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
        const index = turn.tools.findIndex((tool) => tool.toolCallId === event.call.toolCallId);
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
  return order.map((id) => byId.get(id)).filter((item): item is TurnBlock => item !== undefined);
}

function pendingPermission(events: readonly AgentSessionEvent[]): AgentPermissionRequest | null {
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

export function ChatPage(): React.JSX.Element {
  const spaces = useSpaces();
  const activeSpace = spaces.spaces.find((space) => space.sessionId === spaces.activeId) ?? null;
  const [homeDir, setHomeDir] = useState('');
  const cwd = activeSpace?.folderPath ?? homeDir;

  const [candidates, setCandidates] = useState<readonly AgentCandidate[]>([]);
  const [threads, setThreads] = useState<readonly AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentSessionEvent[]>([]);
  const [session, setSession] = useState<AgentSessionState | null>(null);
  const [agentId, setAgentId] = useState('');
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = session?.sessionId ?? null;
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const runnable = candidates.filter((candidate) => candidate.available || candidate.configured);
  const selected = runnable.find((candidate) => candidate.id === agentId) ?? runnable[0] ?? null;
  const turns = useMemo(() => foldTurns(events), [events]);
  const permission = useMemo(() => pendingPermission(events), [events]);
  const usage = lastUsage(events);
  const auth = session?.auth === 'required' ? lastAuth(events) : null;
  const modelOptions = configByCategory(session?.configOptions ?? [], 'model');
  const thoughtOptions = configByCategory(session?.configOptions ?? [], 'thought-level');

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.builderHelm.agents.candidates(),
      window.builderHelm.agents.threads(),
      window.builderHelm.board.homeDir().catch(() => ''),
    ])
      .then(([nextCandidates, nextThreads, home]) => {
        if (!active) return;
        setCandidates(nextCandidates);
        setThreads(nextThreads);
        setHomeDir(home);
        const firstRunnable =
          nextCandidates.find((candidate) => candidate.configured) ??
          nextCandidates.find((candidate) => candidate.available);
        if (firstRunnable !== undefined) setAgentId(firstRunnable.id);
        const first = nextThreads[0];
        if (first !== undefined) {
          setActiveThreadId(first.id);
          return window.builderHelm.agents.transcript(first.id).then((stored) => {
            if (active) setEvents([...stored.events]);
          });
        }
        return undefined;
      })
      .catch(() => active && setError('Agent chat could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return window.builderHelm.agents.onEvent((event) => {
      if (sessionIdRef.current === null || event.sessionId !== sessionIdRef.current) return;
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

  async function refreshThreads(selectId?: string): Promise<void> {
    const next = await window.builderHelm.agents.threads();
    setThreads(next);
    if (selectId !== undefined) setActiveThreadId(selectId);
  }

  async function selectThread(threadId: string): Promise<void> {
    if (streaming || threadId === activeThreadId) return;
    setError(null);
    setActiveThreadId(threadId);
    setSession(null);
    try {
      const stored = await window.builderHelm.agents.transcript(threadId);
      setEvents([...stored.events]);
    } catch {
      setError('This conversation could not be loaded.');
    }
  }

  function beginNewThread(): void {
    if (streaming) return;
    setActiveThreadId(null);
    setSession(null);
    setEvents([]);
    setDraft('');
    setError(null);
  }

  async function ensureSession(): Promise<AgentSessionState> {
    if (session !== null && session.threadId === activeThreadId) return session;
    if (selected === null) throw new Error('No agent is available on this machine.');
    if (cwd.length === 0) throw new Error('Open a Space so the agent has a project folder.');
    if (!selected.configured) {
      await window.builderHelm.agents.configure({
        id: selected.id,
        label: selected.label,
        command: selected.command,
        args: selected.args,
      });
    }
    const thread = threads.find((item) => item.id === activeThreadId) ?? null;
    const started = await window.builderHelm.agents.start({
      agentId: selected.id,
      cwd,
      threadId: activeThreadId,
      resumeSessionId: thread?.acpSessionId ?? null,
    });
    sessionIdRef.current = started.sessionId;
    setSession(started);
    setActiveThreadId(started.threadId);
    const stored = await window.builderHelm.agents.transcript(started.threadId);
    setEvents([...stored.events]);
    await refreshThreads(started.threadId);
    return started;
  }

  async function sendMessage(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0 || streaming) return;
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
      setError(caught instanceof Error ? caught.message : 'The message could not be sent.');
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

  async function answer(decision: AgentPermissionRequest['options'][number]['decision']): Promise<void> {
    if (session === null || permission === null) return;
    try {
      await window.builderHelm.agents.respondPermission({
        sessionId: session.sessionId,
        requestId: permission.requestId,
        decision,
      });
    } catch {
      setError('The approval could not be sent.');
    }
  }

  async function applyDiff(path: string, action: 'apply' | 'revert'): Promise<void> {
    if (session === null) return;
    try {
      await window.builderHelm.agents.applyDiff({ sessionId: session.sessionId, path, action });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The file could not be updated.');
    }
  }

  async function setOption(option: AgentConfigOption, value: string | boolean): Promise<void> {
    if (session === null) return;
    try {
      await window.builderHelm.agents.setConfigOption({
        sessionId: session.sessionId,
        configId: option.id,
        value,
      });
    } catch {
      setError('That setting could not be changed.');
    }
  }

  return (
    <div className="chatPage">
      <aside className="threadPanel" aria-label="Conversations">
        <div className="threadPanelHeader">
          <div>
            <p className="eyebrow">Local history</p>
            <h1>Conversations</h1>
          </div>
          <button
            className="newThreadButton"
            type="button"
            disabled={streaming}
            onClick={beginNewThread}
            aria-label="Start a new conversation"
          >
            +
          </button>
        </div>
        <div className="threadList">
          {loading && <p className="threadEmpty">Loading local history…</p>}
          {!loading && threads.length === 0 && (
            <p className="threadEmpty">Your conversations will stay here on this Mac.</p>
          )}
          {threads.map((thread) => (
            <button
              className={`threadItem ${thread.id === activeThreadId ? 'threadItemActive' : ''}`}
              type="button"
              disabled={streaming}
              onClick={() => void selectThread(thread.id)}
              key={thread.id}
            >
              <span>{threadTitle(thread)}</span>
              <time dateTime={thread.updatedAt}>{shortTime(thread.updatedAt)}</time>
            </button>
          ))}
        </div>
        <p className="threadPrivacy">Owned here · billed by the agent you run</p>
      </aside>

      <section className="conversationPanel" aria-label="Chat conversation">
        <header className="chatHeader">
          <div>
            <p className="eyebrow">
              {cwd.length === 0 ? 'No project folder' : cwd.split('/').filter(Boolean).at(-1)}
            </p>
            <h2>
              {activeThreadId === null
                ? 'New conversation'
                : threadTitle(
                    threads.find((thread) => thread.id === activeThreadId) ?? {
                      id: activeThreadId,
                      title: 'Conversation',
                      acpSessionId: null,
                      agent: { id: 'unknown', label: 'Agent', command: 'agent', args: [] },
                      cwd,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    },
                  )}
            </h2>
          </div>
          <label className="modelPicker">
            <span>Agent</span>
            <select
              value={selected?.id ?? ''}
              disabled={streaming || runnable.length === 0}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {runnable.length === 0 && <option value="">No agent on PATH</option>}
              {runnable.map((candidate) => (
                <option value={candidate.id} key={candidate.id}>
                  {candidate.label}
                  {candidate.configured ? '' : ' · offered'}
                </option>
              ))}
            </select>
          </label>
          {modelOptions.map((option) => (
            <label className="modelPicker" key={option.id}>
              <span>{option.label}</span>
              <select
                value={String(option.value)}
                disabled={streaming}
                onChange={(event) => void setOption(option, event.target.value)}
              >
                {option.choices.map((choice) => (
                  <option value={choice.value} key={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {thoughtOptions.map((option) => (
            <label className="modelPicker" key={option.id}>
              <span>{option.label}</span>
              {option.choices.length === 0 ? (
                <input
                  type="checkbox"
                  checked={option.value === true}
                  disabled={streaming}
                  onChange={(event) => void setOption(option, event.target.checked)}
                />
              ) : (
                <select
                  value={String(option.value)}
                  disabled={streaming}
                  onChange={(event) => void setOption(option, event.target.value)}
                >
                  {option.choices.map((choice) => (
                    <option value={choice.value} key={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
        </header>

        {error !== null && (
          <p className="chatError" role="alert">
            {error}
          </p>
        )}

        {auth !== null && auth.type === 'session.auth.required' && (
          <p className="chatError" role="status">
            {selected?.label ?? 'This agent'} needs you to sign in with its own flow
            {auth.methods.length > 0
              ? `: ${auth.methods.map((method) => method.label).join(', ')}`
              : ''}
            . BuilderHelm never handles that credential.
          </p>
        )}

        {permission !== null && session !== null && (
          <div className="permissionBar" role="alertdialog" aria-label="Approve agent action">
            <p>
              {permission.toolCall.title || permission.toolCall.kind}
              {permission.toolCall.paths[0] !== undefined ? ` · ${permission.toolCall.paths[0]}` : ''}
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
          {turns.map((turn) => (
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
                  <p className="thinkingLine">{turn.thought}</p>
                )}
                {turn.plan.length > 0 && (
                  <ol className="planList">
                    {turn.plan.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ol>
                )}
                {turn.tools.map((tool) => (
                  <ToolView
                    key={tool.toolCallId}
                    call={tool}
                    canWrite={session !== null}
                    onDiff={applyDiff}
                  />
                ))}
                {turn.assistant.length > 0 && <p className="turnCopy">{turn.assistant}</p>}
                {turn.error !== null && <p className="chatError">{turn.error}</p>}
              </div>
            </article>
          ))}
          {!loading && turns.length === 0 && (
            <div className="chatWelcome">
              <span className="welcomeMark">0</span>
              <p className="eyebrow">Your agents. You at the helm.</p>
              <h3>Talk to an agent you already have installed.</h3>
              <p>
                BuilderHelm hosts the session. The agent owns sign-in, models, and
                billing. Nothing here is an API key.
              </p>
            </div>
          )}
          {!loading && runnable.length === 0 && (
            <div className="modelEmpty">
              <p>
                No ACP agent was found on PATH. Install Gemini, OpenCode, Grok, Claude
                ACP, or Codex ACP yourself — BuilderHelm will not do it.
              </p>
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
          <label className="srOnly" htmlFor="chat-message">
            Message
          </label>
          <textarea
            id="chat-message"
            value={draft}
            disabled={streaming || runnable.length === 0 || cwd.length === 0}
            maxLength={100_000}
            rows={3}
            placeholder={
              runnable.length === 0
                ? 'Install an ACP agent to begin'
                : cwd.length === 0
                  ? 'Open a Space so the agent has a folder'
                  : 'Ask the agent…'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <div className="composerFooter">
            <span>
              {usage !== null && usage.usedTokens !== null
                ? `${usage.usedTokens.toLocaleString()} tokens`
                : 'Enter to send · Shift+Enter for a new line'}
              {usage?.contextWindow !== null && usage !== null
                ? ` · ${usage.contextWindow.toLocaleString()} window`
                : ''}
            </span>
            {streaming ? (
              <button className="stopButton" type="button" onClick={() => void stopTurn()}>
                Stop
              </button>
            ) : (
              <button
                className="sendButton"
                type="submit"
                disabled={draft.trim().length === 0 || selected === null || cwd.length === 0}
              >
                Send
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function ToolView({
  call,
  canWrite,
  onDiff,
}: {
  readonly call: AgentToolCall;
  readonly canWrite: boolean;
  readonly onDiff: (path: string, action: 'apply' | 'revert') => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="toolCall">
      <div className="turnMeta">
        <span>{call.title || call.kind}</span>
        <span>{call.status}</span>
      </div>
      {call.content.map((part, index) => {
        if (part.type === 'diff') {
          return (
            <div className="diffBlock" key={`${part.path}-${index}`}>
              <pre>{part.newText.slice(0, 4000)}</pre>
              {canWrite && (
                <div className="diffActions">
                  <button type="button" className="sendButton" onClick={() => void onDiff(part.path, 'apply')}>
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
    </div>
  );
}


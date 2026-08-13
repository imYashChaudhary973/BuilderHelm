import { Link } from '@tanstack/react-router';
import type {
  ChatClientStreamEvent,
  ChatThread,
  ChatTranscript,
  ChatTurn,
} from '@zero/protocol/chat';
import type { ModelRecord, TokenUsage } from '@zero/protocol/model';
import { useEffect, useMemo, useRef, useState } from 'react';

function threadTitle(thread: ChatThread): string {
  return thread.title ?? 'Untitled thread';
}

function shortTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function turnText(turn: ChatTurn): string {
  return turn.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function toolNames(turn: ChatTurn): string[] {
  return turn.content
    .filter((part) => part.type === 'tool_call')
    .map((part) => part.call.name);
}

function firstLine(value: string): string {
  const line = value.trim().split('\n')[0] ?? '';
  return line.length <= 64 ? line : `${line.slice(0, 61)}…`;
}

interface TurnViewProps {
  readonly turn: ChatTurn;
  readonly modelLabel: string | null;
  readonly usage: TokenUsage | null;
}

function TurnView({ turn, modelLabel, usage }: TurnViewProps): React.JSX.Element {
  const text = turnText(turn);
  const tools = toolNames(turn);
  const label = turn.role === 'assistant' ? (modelLabel ?? 'Assistant') : turn.role;

  return (
    <article className={`chatTurn chatTurn-${turn.role}`} data-turn-role={turn.role}>
      <div className="turnRail" aria-hidden="true">
        <span />
      </div>
      <div className="turnBody">
        <div className="turnMeta">
          <span>{label}</span>
          <time dateTime={turn.createdAt}>{shortTime(turn.createdAt)}</time>
          {turn.finishReason !== null && turn.finishReason !== 'stop' && (
            <span className="finishTag">{turn.finishReason.replace('_', ' ')}</span>
          )}
        </div>
        {text.length > 0 && <p className="turnCopy">{text}</p>}
        {tools.length > 0 && (
          <p className="toolSummary">Requested tool: {tools.join(', ')}</p>
        )}
        {usage !== null && (
          <p className="usageLine">
            {usage.inputTokens.toLocaleString()} in ·{' '}
            {usage.outputTokens.toLocaleString()} out
          </p>
        )}
      </div>
    </article>
  );
}

export function ChatPage(): React.JSX.Element {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ChatTranscript | null>(null);
  const [selectedModelRef, setSelectedModelRef] = useState('');
  const [draft, setDraft] = useState('');
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [streamUsage, setStreamUsage] = useState<TokenUsage | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const modelByRef = useMemo(
    () => new Map(models.map((model) => [model.ref, model])),
    [models],
  );
  const usageByTurn = useMemo(
    () => new Map(transcript?.usage.map((record) => [record.turnId, record.usage]) ?? []),
    [transcript],
  );
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;

  useEffect(() => {
    let active = true;
    void Promise.all([window.zero.chat.list(), window.zero.models.list({})])
      .then(async ([storedThreads, storedModels]) => {
        if (!active) return;
        setThreads(storedThreads);
        setModels(storedModels.filter((model) => model.capabilities.streaming));
        setSelectedModelRef(
          (current) =>
            current ||
            storedModels.find((model) => model.capabilities.streaming)?.ref ||
            '',
        );
        const first = storedThreads[0];
        if (first !== undefined) {
          setActiveThreadId(first.id);
          setTranscript(await window.zero.chat.get({ threadId: first.id }));
        }
      })
      .catch(
        () =>
          active && setError('Chat history is unavailable. Restart Zero and try again.'),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript, pendingUserText, streamText]);

  async function refresh(threadId: string): Promise<void> {
    const [nextThreads, nextTranscript] = await Promise.all([
      window.zero.chat.list(),
      window.zero.chat.get({ threadId }),
    ]);
    setThreads(nextThreads);
    setTranscript(nextTranscript);
    setActiveThreadId(threadId);
  }

  async function selectThread(threadId: string): Promise<void> {
    if (streaming || threadId === activeThreadId) return;
    setError(null);
    setActiveThreadId(threadId);
    try {
      setTranscript(await window.zero.chat.get({ threadId }));
    } catch {
      setError('This conversation could not be loaded.');
    }
  }

  function beginNewThread(): void {
    if (streaming) return;
    setActiveThreadId(null);
    setTranscript(null);
    setDraft('');
    setError(null);
  }

  async function handleTerminal(
    threadId: string,
    event: Extract<ChatClientStreamEvent, { type: 'done' | 'error' }>,
  ): Promise<void> {
    setStreaming(false);
    setRunId(null);
    setPendingUserText(null);
    if (event.type === 'error') setError(event.error.message);
    try {
      await refresh(threadId);
    } catch {
      setError(
        'The response finished, but the saved conversation could not be reloaded.',
      );
    } finally {
      setStreamText('');
      setStreamReasoning('');
      setStreamUsage(null);
    }
  }

  async function sendMessage(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0 || streaming) return;
    if (selectedModelRef.length === 0) {
      setError('Discover a streaming model in Settings before starting a conversation.');
      return;
    }

    setError(null);
    let threadId = activeThreadId;
    try {
      if (threadId === null) {
        const created = await window.zero.chat.create({ title: firstLine(text) });
        threadId = created.id;
        setActiveThreadId(created.id);
        setThreads((current) => [created, ...current]);
      }
      const targetThreadId = threadId;
      let terminal = false;
      setDraft('');
      setPendingUserText(text);
      setStreamText('');
      setStreamReasoning('');
      setStreamUsage(null);
      setStreaming(true);

      const started = await window.zero.chat.startStream(
        { threadId: targetThreadId, modelRef: selectedModelRef, text },
        (event) => {
          if (event.type === 'text.delta')
            setStreamText((current) => current + event.text);
          if (event.type === 'reasoning.summary')
            setStreamReasoning((current) => current + event.text);
          if (event.type === 'usage') setStreamUsage(event.usage);
          if (event.type === 'done' || event.type === 'error') {
            terminal = true;
            void handleTerminal(targetThreadId, event);
          }
        },
      );
      if (!terminal) setRunId(started.runId);
    } catch {
      setStreaming(false);
      setRunId(null);
      setPendingUserText(null);
      setStreamText('');
      setDraft(text);
      setError(
        'The message could not be started. Check the selected model and provider.',
      );
    }
  }

  async function stopStream(): Promise<void> {
    if (runId === null) return;
    try {
      await window.zero.chat.cancelStream({ runId });
    } catch {
      setError('The running response could not be stopped.');
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
        <p className="threadPrivacy">Canonical history · local SQLite</p>
      </aside>

      <section className="conversationPanel" aria-label="Chat conversation">
        <header className="chatHeader">
          <div>
            <p className="eyebrow">Provider-independent thread</p>
            <h2>
              {activeThread === null ? 'New conversation' : threadTitle(activeThread)}
            </h2>
          </div>
          <label className="modelPicker">
            <span>Model for next turn</span>
            <select
              value={selectedModelRef}
              disabled={streaming || models.length === 0}
              onChange={(event) => setSelectedModelRef(event.target.value)}
            >
              {models.length === 0 && <option value="">No discovered models</option>}
              {models.map((model) => (
                <option value={model.ref} key={model.ref}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        {error !== null && (
          <p className="chatError" role="alert">
            {error}
          </p>
        )}

        <div className="transcript" aria-live="polite" aria-busy={streaming}>
          {transcript?.turns.map((turn) => (
            <TurnView
              turn={turn}
              modelLabel={
                turn.modelRef === null
                  ? null
                  : (modelByRef.get(turn.modelRef)?.label ??
                    turn.modelRef.split(':').at(-1) ??
                    null)
              }
              usage={usageByTurn.get(turn.id) ?? null}
              key={turn.id}
            />
          ))}
          {pendingUserText !== null && (
            <article className="chatTurn chatTurn-user chatTurn-pending">
              <div className="turnRail" aria-hidden="true">
                <span />
              </div>
              <div className="turnBody">
                <div className="turnMeta">
                  <span>user</span>
                  <span>sending</span>
                </div>
                <p className="turnCopy">{pendingUserText}</p>
              </div>
            </article>
          )}
          {streaming && (
            <article className="chatTurn chatTurn-assistant chatTurn-streaming">
              <div className="turnRail" aria-hidden="true">
                <span />
              </div>
              <div className="turnBody">
                <div className="turnMeta">
                  <span>{modelByRef.get(selectedModelRef)?.label ?? 'Assistant'}</span>
                  <span className="streamState">streaming</span>
                </div>
                {streamText.length > 0 ? (
                  <p className="turnCopy">{streamText}</p>
                ) : (
                  <p className="thinkingLine">
                    {streamReasoning.length > 0
                      ? 'Reasoning…'
                      : 'Waiting for first token…'}
                  </p>
                )}
                {streamUsage !== null && (
                  <p className="usageLine">
                    {streamUsage.inputTokens.toLocaleString()} in ·{' '}
                    {streamUsage.outputTokens.toLocaleString()} out
                  </p>
                )}
              </div>
            </article>
          )}
          {!loading &&
            (transcript?.turns.length ?? 0) === 0 &&
            pendingUserText === null && (
              <div className="chatWelcome">
                <span className="welcomeMark">0</span>
                <p className="eyebrow">Private working thread</p>
                <h3>Ask once. Change models whenever the work changes.</h3>
                <p>
                  Every answer records its model and usage while the conversation remains
                  owned by Zero.
                </p>
              </div>
            )}
          {!loading && models.length === 0 && (
            <div className="modelEmpty">
              <p>No streaming model is ready.</p>
              <Link to="/settings/providers">Open Models &amp; Providers</Link>
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
            disabled={streaming || models.length === 0}
            maxLength={100_000}
            rows={3}
            placeholder={
              models.length === 0
                ? 'Discover a model in Settings to begin'
                : 'Ask Zero anything…'
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
            <span>Enter to send · Shift+Enter for a new line</span>
            {streaming ? (
              <button
                className="stopButton"
                type="button"
                disabled={runId === null}
                onClick={() => void stopStream()}
              >
                Stop
              </button>
            ) : (
              <button
                className="sendButton"
                type="submit"
                disabled={draft.trim().length === 0 || selectedModelRef.length === 0}
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

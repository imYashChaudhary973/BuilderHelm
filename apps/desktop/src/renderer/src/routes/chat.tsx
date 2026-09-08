import type { AgentThread } from '@builderhelm/protocol';
import { useCallback, useEffect, useState } from 'react';

import { ChatPane, threadTitle } from '../components/chat-pane.js';
import { useSpaces } from '../space-store.js';

function shortTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

/** The Chats tab: local history for everything, then the shared chat pane. */
export function ChatPage(): React.JSX.Element {
  const spaces = useSpaces();
  const activeSpace =
    spaces.spaces.find((space) => space.sessionId === spaces.activeId) ?? null;
  const [homeDir, setHomeDir] = useState('');
  const fallbackCwd = activeSpace?.folderPath ?? homeDir;
  const [threads, setThreads] = useState<readonly AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.builderHelm.agents.threads(),
      window.builderHelm.board.homeDir().catch(() => ''),
    ])
      .then(([nextThreads, home]) => {
        if (!active) return;
        setThreads(nextThreads);
        setActiveThreadId(nextThreads[0]?.id ?? null);
        setHomeDir(home);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const onThreadsChanged = useCallback((next: readonly AgentThread[]) => {
    setThreads(next);
  }, []);
  const onStreamingChange = useCallback((next: boolean) => {
    setStreaming(next);
  }, []);

  async function selectThread(threadId: string): Promise<void> {
    setActiveThreadId(threadId);
  }

  return (
    <div className="chatPage">
      <aside className="threadPanel" aria-label="Threads">
        <div className="threadPanelHeader">
          <h1>Threads</h1>
          <button
            className="newThreadButton"
            type="button"
            disabled={streaming}
            aria-label="Start a new conversation"
            title="New chat"
            onClick={() => setActiveThreadId(null)}
          >
            +
          </button>
        </div>
        <div className="threadList">
          {threads.length === 0 && (
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

      <ChatPane
        profile={null}
        fallbackCwd={fallbackCwd}
        threads={threads}
        activeThreadId={activeThreadId}
        onActiveThreadChange={setActiveThreadId}
        onThreadsChanged={onThreadsChanged}
        onStreamingChange={onStreamingChange}
      />
    </div>
  );
}

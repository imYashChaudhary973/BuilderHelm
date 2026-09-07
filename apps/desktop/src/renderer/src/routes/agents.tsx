import type { AgentProfile, AgentThread } from '@builderhelm/protocol';
import { useCallback, useEffect, useState } from 'react';

import { AgentRoster } from '../components/agent-roster.js';
import { ChatPane } from '../components/chat-pane.js';
import { ProfileDialog } from '../components/profile-dialog.js';
import { latestThreadForProfile } from './chat-status.js';

/**
 * The Agents tab: the roster on the left, the selected profile's chat on the
 * right. One profile is active at a time; its threads are its own.
 */
export function AgentsPage(): React.JSX.Element {
  const [profiles, setProfiles] = useState<readonly AgentProfile[]>([]);
  const [threads, setThreads] = useState<readonly AgentThread[]>([]);
  const [liveThreadIds, setLiveThreadIds] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState('');
  const [usage, setUsage] = useState<{
    tokens: number | null;
    modelLabel: string | null;
  }>({ tokens: null, modelLabel: null });
  const [streaming, setStreaming] = useState(false);
  const [dialog, setDialog] = useState<{ editing: AgentProfile | null } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [nextProfiles, nextThreads] = await Promise.all([
      window.builderHelm.agents.profiles(),
      window.builderHelm.agents.threads(),
    ]);
    setProfiles(nextProfiles);
    setThreads(nextThreads);
    setActiveId((current) => {
      if (current !== null && nextProfiles.some((profile) => profile.id === current)) {
        return current;
      }
      return nextProfiles[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([reload(), window.builderHelm.board.homeDir().catch(() => '')])
      .then(([, home]) => {
        if (active) setHomeDir(home);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [reload]);

  // Switching profiles opens that profile's latest thread; a fresh one opens
  // an empty chat. (A thread created mid-turn sets its own selection through
  // the pane, so this deliberately does not track the threads list.)
  useEffect(() => {
    setActiveThreadId(
      activeId === null ? null : (latestThreadForProfile(threads, activeId)?.id ?? null),
    );
  }, [activeId]);

  // Live dots: which profiles have a session running right now.
  useEffect(() => {
    const poll = setInterval(() => {
      void window.builderHelm.agents
        .sessions()
        .then((sessions) => {
          setLiveThreadIds(new Set(sessions.map((session) => session.threadId)));
        })
        .catch(() => {});
    }, 10_000);
    return () => {
      clearInterval(poll);
    };
  }, []);

  const onThreadsChanged = useCallback((next: readonly AgentThread[]) => {
    setThreads(next);
  }, []);
  const onStreamingChange = useCallback((next: boolean) => {
    setStreaming(next);
  }, []);
  const onUsageChange = useCallback(
    (next: { tokens: number | null; modelLabel: string | null }) => {
      setUsage(next);
    },
    [],
  );

  const active = profiles.find((profile) => profile.id === activeId) ?? null;

  async function handleSaved(saved: AgentProfile | null): Promise<void> {
    setDialog(null);
    await reload();
    if (saved === null) {
      setActiveId((current) =>
        profiles.some((profile) => profile.id === current)
          ? current
          : (profiles[0]?.id ?? null),
      );
    }
  }

  return (
    <div className="chatPage">
      <AgentRoster
        profiles={profiles}
        threads={threads}
        liveThreadIds={liveThreadIds}
        activeId={activeId}
        tokens={usage.tokens}
        modelLabel={usage.modelLabel}
        disabled={streaming}
        onSelect={setActiveId}
        onAdd={() => setDialog({ editing: null })}
      />

      <ChatPane
        profile={active}
        fallbackCwd={homeDir}
        threads={threads}
        activeThreadId={activeThreadId}
        onActiveThreadChange={setActiveThreadId}
        onThreadsChanged={onThreadsChanged}
        onUsage={onUsageChange}
        onEditProfile={(profile) => setDialog({ editing: profile })}
        onStreamingChange={onStreamingChange}
      />

      {dialog !== null && (
        <ProfileDialog
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={(saved) => void handleSaved(saved)}
        />
      )}
    </div>
  );
}

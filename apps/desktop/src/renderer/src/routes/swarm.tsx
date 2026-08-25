import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  boardGridLayouts,
  type BoardIsolation,
  type BoardLandPreview,
  type BoardPaneCount,
  type BoardPaneStatus,
  type BoardSessionSummary,
} from '@zero/protocol/board';
import {
  SWARM_BUDGET_MS,
  SWARM_NUDGE,
  SWARM_STUCK_MS,
  assignSwarmPanes,
  availableSwarmAgents,
  swarmAddSeat,
  swarmBrief,
  swarmPaneCommand,
  swarmPresetRoles,
  swarmRoleTasks,
  swarmSkillLines,
  swarmMemberStatus,
  swarmRunStatus,
  swarmStuckAction,
  type SwarmAssignment,
  type SwarmLaunchMode,
  type SwarmPresetId,
} from '@zero/protocol/swarm';
import type { CorrelationId } from '@zero/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TerminalPane } from '../components/terminal-pane.js';
import { useSpaces } from '../space-store.js';
import { SwarmLive } from '../swarm-live.js';
import { SwarmSetup } from '../swarm-setup.js';
import { readLastJob, writeLastJob } from '../swarm-persist.js';

type WizardStep = 'mission' | 'roster' | 'launch';

const RECENTS_KEY = 'exeum.space.recents';

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function readRecents(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string').slice(0, 8);
  } catch {
    return [];
  }
}

function writeRecents(folderPath: string): void {
  const next = [folderPath, ...readRecents().filter((item) => item !== folderPath)].slice(
    0,
    8,
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Recents are optional.
  }
}

function formatRemain(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface LiveRun {
  readonly session: BoardSessionSummary;
  readonly assignments: readonly SwarmAssignment[];
  readonly isolation: BoardIsolation;
  readonly startedAt: number;
  readonly stopped: boolean;
}

export function SwarmPage(): React.JSX.Element {
  const navigate = useNavigate();
  const spaces = useSpaces();
  const [job, setJob] = useState(readLastJob());
  const [folderPath, setFolderPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [step, setStep] = useState<WizardStep>('mission');
  const [preset, setPreset] = useState<SwarmPresetId>('frigate');
  const [mode, setMode] = useState<SwarmLaunchMode>('safe');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [swarmName, setSwarmName] = useState('');
  const [roster, setRoster] = useState<SwarmAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [landNotice, setLandNotice] = useState<string | null>(null);
  const [landPreview, setLandPreview] = useState<BoardLandPreview | null>(null);
  const [lastOutput, setLastOutput] = useState<Record<string, number>>({});
  const [paneStatus, setPaneStatus] = useState<Record<string, BoardPaneStatus>>({});
  const [nudgedAt, setNudgedAt] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const stuckActed = useRef<Record<string, 'nudge' | 'stop'>>({});

  const agents = useQuery({
    queryKey: ['board-agents'],
    queryFn: () => window.zero.board.detectAgents(),
  });

  useEffect(() => {
    void window.zero.board
      .homeDir()
      .then((home) => {
        setHomeDir(home);
        setFolderPath((current) => (current.trim().length > 0 ? current : home));
      })
      .catch(() => undefined);
  }, []);

  const detected = availableSwarmAgents(agents.data ?? []);
  useEffect(() => {
    const fill = detected[0];
    if (fill === undefined) {
      setRoster([]);
      return;
    }
    setRoster(assignSwarmPanes([fill], swarmPresetRoles(preset)));
  }, [detected[0], preset]);

  useEffect(() => {
    if (run === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run]);

  useEffect(() => {
    if (run === null) return;
    return window.zero.board.onPaneEvent(run.session.sessionId, (envelope) => {
      const event = envelope.event;
      if (event.type === 'data') {
        setLastOutput((current) => ({ ...current, [envelope.paneId]: Date.now() }));
        return;
      }
      const nextStatus = event.status;
      setPaneStatus((current) => ({ ...current, [envelope.paneId]: nextStatus }));
    });
  }, [run]);

  const launch = useMutation({
    mutationFn: async () => {
      if (roster.length === 0) {
        throw new Error(
          'Install an agent CLI (Claude, Codex, Grok…) or open a Space instead.',
        );
      }
      const folder = folderPath.trim();
      if (folder.length === 0) throw new Error('Pick a folder first.');
      const paneCount = roster.length as BoardPaneCount;
      const extras = swarmSkillLines(skillIds);
      const panes = roster.map((item, slot) => {
        const brief = swarmBrief(item.role, job).trimEnd();
        const task = swarmRoleTasks(job)[item.role];
        return {
          slot,
          agentId: item.agentId,
          command: swarmPaneCommand(
            item.agentId,
            extras.length > 0 ? `${brief}\n${task}\n${extras}` : `${brief}\n${task}`,
            item.auto || mode === 'skip' ? 'skip' : 'safe',
          ),
        };
      });
      const base = {
        correlationId: crypto.randomUUID() as CorrelationId,
        folderPath: folder,
        paneCount,
        panes,
      };
      try {
        const summary = await window.zero.board.createSession({
          ...base,
          paneCount,
          isolation: 'worktree',
        });
        return { summary, assignments: roster, isolation: 'worktree' as const };
      } catch {
        const summary = await window.zero.board.createSession({
          ...base,
          paneCount,
          isolation: 'shared',
        });
        return { summary, assignments: roster, isolation: 'shared' as const };
      }
    },
    onMutate: () => setError(null),
    onSuccess: ({ summary, assignments, isolation }) => {
      writeLastJob(job);
      writeRecents(summary.folderPath);
      spaces.upsert(summary);
      spaces.rename(
        summary,
        swarmName.trim() || `Swarm · ${folderName(summary.folderPath)}`,
      );
      const startedAt = Date.now();
      stuckActed.current = {};
      setNudgedAt({});
      setPaneStatus(
        Object.fromEntries(summary.panes.map((pane) => [pane.paneId, pane.status])),
      );
      setLastOutput(
        Object.fromEntries(summary.panes.map((pane) => [pane.paneId, startedAt])),
      );
      setRun({ session: summary, assignments, isolation, startedAt, stopped: false });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const previewLand = useMutation({
    mutationFn: (branch: string) => {
      if (run === null) throw new Error('No live swarm');
      return window.zero.board.previewLand({
        correlationId: crypto.randomUUID() as CorrelationId,
        repoPath: run.session.folderPath,
        branch,
      });
    },
    onMutate: () => {
      setLandNotice(null);
      setLandPreview(null);
    },
    onSuccess: (preview) => {
      setLandPreview(preview);
      const files =
        preview.files.length === 0 ? 'no file changes' : preview.files.join(', ');
      setLandNotice(
        preview.ahead === 0
          ? `${preview.branch} has no commits ahead of ${preview.base}`
          : `${preview.ahead} commit(s) on ${preview.branch} vs ${preview.base}: ${files}. Click Land again to merge.`,
      );
    },
    onError: (cause: Error) => setLandNotice(cause.message),
  });

  const land = useMutation({
    mutationFn: (branch: string) => {
      if (run === null) throw new Error('No live swarm');
      return window.zero.board.land({
        correlationId: crypto.randomUUID() as CorrelationId,
        repoPath: run.session.folderPath,
        branch,
      });
    },
    onMutate: () => setLandNotice(null),
    onSuccess: (result, branch) => {
      setLandPreview(null);
      setLandNotice(`Landed ${branch} at ${result.head.slice(0, 7)}`);
    },
    onError: (cause: Error) => setLandNotice(cause.message),
  });

  async function stopRun(current: LiveRun): Promise<void> {
    setRun({ ...current, stopped: true });
    for (const pane of current.session.panes) {
      await window.zero.board
        .closePane({
          correlationId: crypto.randomUUID() as CorrelationId,
          sessionId: current.session.sessionId,
          paneId: pane.paneId,
        })
        .catch(() => undefined);
    }
    spaces.drop(current.session.sessionId);
  }

  const members = useMemo(() => {
    if (run === null) return [];
    return run.session.panes.map((pane, index) => {
      const assignment = run.assignments[index];
      const status = swarmMemberStatus({
        paneStatus: paneStatus[pane.paneId] ?? pane.status,
        lastActivityAt: lastOutput[pane.paneId] ?? run.startedAt,
        now,
        stuckAfterMs: SWARM_STUCK_MS,
      });
      return { pane, assignment, status };
    });
  }, [lastOutput, now, paneStatus, run]);

  const status =
    run === null
      ? null
      : swarmRunStatus({
          members: members.map((item) => item.status),
          elapsedMs: now - run.startedAt,
          budgetMs: SWARM_BUDGET_MS,
          stopped: run.stopped,
        });

  useEffect(() => {
    if (run === null || run.stopped || status !== 'budget') return;
    void stopRun(run);
  }, [run, status]);

  useEffect(() => {
    if (run === null || run.stopped) return;
    for (const member of members) {
      const paneId = member.pane.paneId;
      if (member.status === 'running' || member.status === 'starting') {
        if (nudgedAt[paneId] !== undefined) {
          setNudgedAt((current) => {
            const next = { ...current };
            delete next[paneId];
            return next;
          });
          delete stuckActed.current[paneId];
        }
        continue;
      }
      const action = swarmStuckAction({
        status: member.status,
        nudgedAt: nudgedAt[paneId] ?? null,
        now,
        stuckAfterMs: SWARM_STUCK_MS,
      });
      if (action === 'nudge' && stuckActed.current[paneId] === undefined) {
        stuckActed.current[paneId] = 'nudge';
        setNudgedAt((current) => ({ ...current, [paneId]: now }));
        void window.zero.board
          .write({
            correlationId: crypto.randomUUID() as CorrelationId,
            sessionId: run.session.sessionId,
            paneId,
            data: `${SWARM_NUDGE}\r`,
          })
          .catch(() => undefined);
      }
      if (action === 'stop' && stuckActed.current[paneId] !== 'stop') {
        stuckActed.current[paneId] = 'stop';
        void window.zero.board
          .closePane({
            correlationId: crypto.randomUUID() as CorrelationId,
            sessionId: run.session.sessionId,
            paneId,
          })
          .catch(() => undefined);
        setPaneStatus((current) => ({ ...current, [paneId]: 'exited' }));
      }
    }
  }, [members, now, nudgedAt, run]);

  async function browse(): Promise<void> {
    setError(null);
    const picked = await window.zero.board.selectFolder();
    if (picked !== null) setFolderPath(picked);
  }

  if (run !== null) {
    const remain = SWARM_BUDGET_MS - (now - run.startedAt);
    return (
      <>
        {error !== null && (
          <p className="errorBanner" role="alert">
            {error}
          </p>
        )}
        {landNotice !== null && (
          <p className="errorBanner" role="status">
            {landNotice}
          </p>
        )}
        <SwarmLive
          name={swarmName.trim() || `Swarm · ${folderName(run.session.folderPath)}`}
          job={job}
          folder={folderName(run.session.folderPath)}
          isolation={run.isolation}
          status={status ?? 'running'}
          remainLabel={`${formatRemain(remain)} left`}
          members={members}
          stopped={run.stopped}
          onStopAll={() => void stopRun(run)}
          onStopSeat={(paneId) => {
            void window.zero.board
              .closePane({
                correlationId: crypto.randomUUID() as CorrelationId,
                sessionId: run.session.sessionId,
                paneId,
              })
              .catch(() => undefined);
            setPaneStatus((current) => ({ ...current, [paneId]: 'exited' }));
          }}
          onDirect={(paneIds, text) => {
            for (const paneId of paneIds) {
              void window.zero.board
                .write({
                  correlationId: crypto.randomUUID() as CorrelationId,
                  sessionId: run.session.sessionId,
                  paneId,
                  data: `${text}\r`,
                })
                .catch(() => undefined);
            }
          }}
        >
          <div
            className="boardGrid"
            style={{
              gridTemplateColumns: `repeat(${boardGridLayouts[run.session.paneCount].cols}, 1fr)`,
              gridTemplateRows: `repeat(${boardGridLayouts[run.session.paneCount].rows}, 1fr)`,
            }}
          >
            {run.session.panes.map((pane) => {
              const canLand = run.isolation === 'worktree' && pane.branch !== null;
              return (
                <TerminalPane
                  key={pane.paneId}
                  sessionId={run.session.sessionId}
                  pane={pane}
                  maximized={false}
                  landing={canLand && (land.isPending || previewLand.isPending)}
                  confirmLand={
                    canLand &&
                    landPreview?.branch === pane.branch &&
                    landPreview.ahead > 0
                  }
                  onToggleMaximize={() => undefined}
                  onClose={() => undefined}
                  onLand={
                    canLand
                      ? () => {
                          const branch = pane.branch as string;
                          if (landPreview?.branch === branch && landPreview.ahead > 0) {
                            land.mutate(branch);
                            return;
                          }
                          previewLand.mutate(branch);
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        </SwarmLive>
      </>
    );
  }

  const recents = readRecents();

  return (
    <SwarmSetup
      step={step}
      job={job}
      folderPath={folderPath}
      homeDir={homeDir}
      recents={recents}
      preset={preset}
      mode={mode}
      skillIds={skillIds}
      swarmName={swarmName}
      roster={roster}
      detected={detected}
      error={error}
      pending={launch.isPending}
      onStep={setStep}
      onJob={setJob}
      onFolder={setFolderPath}
      onBrowse={() => void browse()}
      onPreset={setPreset}
      onMode={setMode}
      onToggleSkill={(id) =>
        setSkillIds((current) =>
          current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        )
      }
      onName={setSwarmName}
      onSeatAgent={(index, agentId) =>
        setRoster((current) =>
          current.map((seat, seatIndex) =>
            seatIndex === index ? { ...seat, agentId } : seat,
          ),
        )
      }
      onFillAll={(agentId) =>
        setRoster((current) => current.map((seat) => ({ ...seat, agentId })))
      }
      onAddSeat={(role) =>
        setRoster((current) => {
          const fill = current[0]?.agentId ?? detected[0];
          return fill === undefined ? current : swarmAddSeat(current, role, fill);
        })
      }
      onRemoveSeat={(index) =>
        setRoster((current) => current.filter((_, seatIndex) => seatIndex !== index))
      }
      onToggleAuto={(index) =>
        setRoster((current) =>
          current.map((seat, seatIndex) =>
            seatIndex === index ? { ...seat, auto: !seat.auto } : seat,
          ),
        )
      }
      onCancel={() => {
        if (step === 'roster') {
          setStep('mission');
          return;
        }
        if (step === 'launch') {
          setStep('roster');
          return;
        }
        void navigate({ to: '/' });
      }}
      onLaunch={() => launch.mutate()}
    />
  );
}

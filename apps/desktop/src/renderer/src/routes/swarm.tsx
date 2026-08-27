import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { gridForCount, type BoardPaneSummary } from '@zero/protocol/board';
import {
  assignSwarmPanes,
  availableSwarmAgents,
  swarmAddSeat,
  swarmPresetRoles,
  type SwarmAssignment,
  type SwarmLaunchMode,
  type SwarmPresetId,
  type SwarmRole,
  type SwarmRunRecord,
  type SwarmState,
} from '@zero/protocol/swarm';
import type { CorrelationId } from '@zero/shared';
import { useEffect, useMemo, useState } from 'react';
import { TerminalPane } from '../components/terminal-pane.js';
import { SwarmLive, type SwarmLiveSeat } from '../swarm-live.js';
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

export function SwarmPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [job, setJob] = useState(readLastJob());
  const [folderPath, setFolderPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [step, setStep] = useState<WizardStep>('mission');
  const [preset, setPreset] = useState<SwarmPresetId>('frigate');
  const [mode, setMode] = useState<SwarmLaunchMode>('auto');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [skillDirectives, setSkillDirectives] = useState<Record<string, string>>({});
  const [swarmName, setSwarmName] = useState('');
  const [roster, setRoster] = useState<SwarmAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<SwarmRunRecord | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  const agents = useQuery({
    queryKey: ['board-agents'],
    queryFn: () => window.zero.board.detectAgents(),
  });

  useEffect(() => {
    void window.zero.board
      .homeDir()
      .then((home) => setHomeDir(home))
      .catch(() => undefined);
  }, []);

  // A swarm outlives this view: adopt one that is still in flight so leaving
  // and returning never orphans a running run behind the wizard.
  useEffect(() => {
    void window.zero.swarm
      .latest({ correlationId: crypto.randomUUID() as CorrelationId })
      .then((latest) => {
        if (latest !== null && latest.status === 'running') setRun(latest);
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

  // The ledger is the source of truth. Swarm events push invalidations, and
  // a slow fallback poll covers anything the push cannot.
  const state = useQuery({
    queryKey: ['swarm-state', run?.id],
    enabled: run !== null,
    refetchInterval: 5_000,
    queryFn: (): Promise<SwarmState> =>
      window.zero.swarm.state({
        correlationId: crypto.randomUUID() as CorrelationId,
        runId: run!.id,
      }),
  });

  useEffect(() => {
    return window.zero.swarm.onEvent(() => {
      void queryClient.invalidateQueries({ queryKey: ['swarm-state'] });
    });
  }, [queryClient]);

  const liveSessionId = state.data?.run.boardSessionId ?? run?.boardSessionId ?? null;
  useEffect(() => {
    if (liveSessionId === null) return;
    return window.zero.board.onPaneEvent(liveSessionId, (envelope) => {
      if (envelope.event.type !== 'data') return;
      const text = atob(envelope.event.data);
      setPreviews((current) => ({
        ...current,
        [envelope.paneId]: `${current[envelope.paneId] ?? ''}${text}`.slice(-400),
      }));
    });
  }, [liveSessionId]);

  const launch = useMutation({
    mutationFn: async () => {
      if (roster.length === 0) {
        throw new Error(
          'Install an agent CLI (Claude, Codex, Grok…) or open a Space instead.',
        );
      }
      const folder = folderPath.trim();
      if (folder.length === 0) throw new Error('Pick a folder first.');
      if (job.trim().length === 0) throw new Error('Write a mission first.');
      return window.zero.swarm.create({
        correlationId: crypto.randomUUID() as CorrelationId,
        input: {
          name: swarmName.trim() || `Swarm · ${folderName(folder)}`,
          folderPath: folder,
          mission: job.trim(),
          launchMode: mode,
          presetId: preset,
          skillIds,
          skillDirectives,
          seats: roster.map((seat) => ({
            role: seat.role,
            agentId: seat.agentId,
            ...(seat.model === undefined || seat.model.length === 0
              ? {}
              : { model: seat.model }),
          })),
        },
      });
    },
    onMutate: () => setError(null),
    onSuccess: (created) => {
      writeLastJob(job);
      writeRecents(created.folderPath);
      setPreviews({});
      setStopping(false);
      setRun(created);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const stop = useMutation({
    mutationFn: (runId: string) =>
      window.zero.swarm.stop({
        correlationId: crypto.randomUUID() as CorrelationId,
        runId,
      }),
    onMutate: () => setStopping(true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['swarm-state'] });
    },
    onError: (cause: Error) => {
      setStopping(false);
      setError(cause.message);
    },
  });

  const stopSeat = useMutation({
    mutationFn: (seatId: string) =>
      window.zero.swarm.stopSeat({
        correlationId: crypto.randomUUID() as CorrelationId,
        runId: run!.id,
        seatId,
      }),
    onError: (cause: Error) => setError(cause.message),
  });

  const addSeat = useMutation({
    mutationFn: (role: SwarmRole) => {
      const agentId = state.data?.seats[0]?.agentId ?? detected[0];
      if (agentId === undefined) {
        throw new Error('Install an agent CLI first.');
      }
      return window.zero.swarm.addSeat({
        correlationId: crypto.randomUUID() as CorrelationId,
        runId: run!.id,
        role,
        agentId,
      });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const direct = useMutation({
    mutationFn: (input: { readonly seatIds: readonly string[]; readonly body: string }) =>
      window.zero.swarm.direct({
        correlationId: crypto.randomUUID() as CorrelationId,
        input: { runId: run!.id, seatIds: [...input.seatIds], body: input.body },
      }),
    onError: (cause: Error) => setError(cause.message),
  });

  const seats: SwarmLiveSeat[] = useMemo(() => {
    const rows = state.data?.seats ?? [];
    return rows.map((seat) => ({
      seatId: seat.id,
      paneId: seat.paneId,
      role: seat.role,
      agentId: seat.agentId,
      status: seat.status,
      tokensUsed: seat.tokensUsed,
      costUsd: seat.costUsd,
      branch: seat.branch,
    }));
  }, [state.data]);

  async function browse(): Promise<void> {
    setError(null);
    const picked = await window.zero.board.selectFolder();
    if (picked !== null) setFolderPath(picked);
  }

  if (run !== null) {
    const ledger = state.data ?? null;
    const live = ledger?.run ?? run;
    const sessionId = live.boardSessionId;
    const status = stopping ? 'stopped' : (live.status ?? run.status);
    const startedMs = Date.parse(live.startedAt ?? run.startedAt);
    const remain = (live.budgetMs ?? run.budgetMs) - (now - startedMs);
    const stopped = status !== 'running';
    const coordinating =
      !stopping && status === 'running' && (state.data?.tasks.length ?? 0) === 0;
    const grid = gridForCount(Math.max(1, seats.length));

    return (
      <>
        {error !== null && (
          <p className="errorBanner" role="alert">
            {error}
          </p>
        )}
        <SwarmLive
          name={run.name}
          job={run.mission}
          folder={folderName(run.folderPath)}
          isolation="worktree"
          status={coordinating ? 'coordinating' : status}
          remainLabel={
            coordinating ? 'splitting the mission…' : `${formatRemain(remain)} left`
          }
          seats={seats}
          state={ledger}
          previews={previews}
          stopped={stopped}
          onStopAll={() => stop.mutate(run.id)}
          onStopSeat={(seatId) => stopSeat.mutate(seatId)}
          detected={detected}
          onAddSeat={(role) => addSeat.mutate(role)}
          onDirect={(seatIds, text) => direct.mutate({ seatIds, body: text })}
        >
          <div
            className="boardGrid"
            style={{
              gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
              gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
            }}
          >
            {seats.map((seat, index) =>
              seat.paneId !== null && sessionId !== null ? (
                <TerminalPane
                  key={seat.paneId}
                  sessionId={sessionId}
                  pane={{
                    paneId: seat.paneId,
                    slot: index,
                    agentId: seat.agentId as BoardPaneSummary['agentId'],
                    title: `${seat.agentId} · ${seat.role}`,
                    status: seat.status === 'exited' ? 'exited' : 'running',
                    branch: seat.branch,
                    cwd: run.folderPath,
                  }}
                  maximized={false}
                  landing={false}
                  confirmLand={false}
                  onToggleMaximize={() => undefined}
                  onClose={() => undefined}
                  onAdd={undefined}
                  onDragStart={() => undefined}
                  onDrop={() => undefined}
                  onLand={undefined}
                />
              ) : (
                <div
                  key={seat.seatId}
                  className="swarmIdlePane"
                  data-status={seat.status}
                >
                  <strong>{seat.role === 'coordinator' ? 'queen' : seat.role}</strong>
                  <span>{seat.agentId}</span>
                  <em>{seat.status === 'exited' ? 'Stopped' : 'Idle'}</em>
                </div>
              ),
            )}
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
      skillDirectives={skillDirectives}
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
      onSkillDirective={(id, value) =>
        setSkillDirectives((current) => ({ ...current, [id]: value }))
      }
      onName={setSwarmName}
      onSeatAgent={(index, agentId) =>
        setRoster((current) =>
          current.map((seat, seatIndex) => {
            if (seatIndex !== index) return seat;
            const { model: _drop, ...next } = seat;
            void _drop;
            return { ...next, agentId };
          }),
        )
      }
      onSeatModel={(index, model) =>
        setRoster((current) =>
          current.map((seat, seatIndex) => {
            if (seatIndex !== index) return seat;
            const { model: _drop, ...next } = seat;
            void _drop;
            return model.length === 0 ? next : { ...next, model };
          }),
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

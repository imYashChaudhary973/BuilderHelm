import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type {
  BoardIsolation,
  BoardPaneStatus,
  BoardSessionSummary,
} from '@zero/protocol/board';
import {
  SWARM_BUDGET_MS,
  SWARM_NUDGE,
  SWARM_PANE_COUNT,
  SWARM_STUCK_MS,
  assignSwarmPanes,
  availableSwarmAgents,
  swarmBrief,
  swarmMemberStatus,
  swarmRunStatus,
  swarmStuckAction,
  type SwarmAssignment,
} from '@zero/protocol/swarm';
import type { CorrelationId } from '@zero/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TerminalPane } from '../components/terminal-pane.js';
import { useSpaces } from '../space-store.js';

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
  const [job, setJob] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<LiveRun | null>(null);
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
      const detections = agents.data ?? (await window.zero.board.detectAgents());
      const assignments = assignSwarmPanes(availableSwarmAgents(detections));
      if (assignments.length === 0) {
        throw new Error('Install an agent CLI (Claude, Codex, Grok…) or open a Space instead.');
      }
      const folder = folderPath.trim();
      if (folder.length === 0) throw new Error('Pick a folder first.');
      const panes = assignments.map((item, slot) => ({ slot, agentId: item.agentId }));
      const base = {
        correlationId: crypto.randomUUID() as CorrelationId,
        folderPath: folder,
        paneCount: SWARM_PANE_COUNT,
        panes,
      };
      try {
        const summary = await window.zero.board.createSession({
          ...base,
          paneCount: SWARM_PANE_COUNT,
          isolation: 'worktree',
        });
        return { summary, assignments, isolation: 'worktree' as const };
      } catch {
        const summary = await window.zero.board.createSession({
          ...base,
          paneCount: SWARM_PANE_COUNT,
          isolation: 'shared',
        });
        return { summary, assignments, isolation: 'shared' as const };
      }
    },
    onMutate: () => setError(null),
    onSuccess: ({ summary, assignments, isolation }) => {
      writeRecents(summary.folderPath);
      spaces.upsert(summary);
      spaces.rename(summary, `Swarm · ${folderName(summary.folderPath)}`);
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
      window.setTimeout(() => {
        for (const [index, pane] of summary.panes.entries()) {
          const assignment = assignments[index];
          if (assignment === undefined) continue;
          void window.zero.board
            .write({
              correlationId: crypto.randomUUID() as CorrelationId,
              sessionId: summary.sessionId,
              paneId: pane.paneId,
              data: `${swarmBrief(assignment.role, job).trimEnd()}\r`,
            })
            .catch(() => undefined);
        }
      }, 1_500);
    },
    onError: (cause: Error) => setError(cause.message),
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
      <section className="swarmPage" aria-labelledby="swarm-title" data-core-status="ready">
        <header className="memoryHeader">
          <div className="memoryIdentity">
            <span className="swarmMark">
              <SwarmGlyph />
            </span>
            <div>
              <h1 id="swarm-title">BuilderHelm Swarm</h1>
              <p>
                {folderName(run.session.folderPath)} ·{' '}
                {run.isolation === 'worktree' ? 'worktrees' : 'shared folder'} · {status} ·{' '}
                {formatRemain(remain)} left
              </p>
            </div>
          </div>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => void stopRun(run)}
            disabled={run.stopped}
          >
            Stop swarm
          </button>
        </header>
        <p className="swarmJobLine">{job.trim()}</p>
        <ul className="swarmRoles">
          {members.map((item) => {
            const label =
              item.status === 'stuck' && nudgedAt[item.pane.paneId] !== undefined
                ? 'nudged'
                : item.status;
            return (
              <li key={item.pane.paneId}>
                <strong>{item.assignment?.role ?? item.pane.title}</strong>
                <span>{item.assignment?.agentId ?? item.pane.agentId}</span>
                <em data-status={item.status}>{label}</em>
              </li>
            );
          })}
        </ul>
        {error !== null && (
          <p className="errorBanner" role="alert">
            {error}
          </p>
        )}
        <div
          className="boardGrid"
          style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}
        >
          {run.session.panes.map((pane) => (
            <TerminalPane
              key={pane.paneId}
              sessionId={run.session.sessionId}
              pane={pane}
              maximized={false}
              landing={false}
              confirmLand={false}
              onToggleMaximize={() => undefined}
              onClose={() => undefined}
              onLand={undefined}
            />
          ))}
        </div>
      </section>
    );
  }

  const recents = readRecents();
  const ready = job.trim().length > 0 && folderPath.trim().length > 0;

  return (
    <section className="spaceStage" aria-labelledby="swarm-setup-title" data-core-status="ready">
      <div className="boardPage spaceWizard">
        <h1 id="swarm-setup-title">Start a swarm</h1>
        <p className="lede">
          One job. Four roles. Worktrees when the folder is a git repo. Nudge at 90s
          silence, then stop that pane.
        </p>
        <div className="wizardSection">
          <label className="wizardLabel" htmlFor="swarm-job">
            Job <span>What should the agents finish</span>
          </label>
          <textarea
            id="swarm-job"
            className="swarmJob"
            rows={5}
            value={job}
            placeholder="e.g. Add a failing test for the login form, then make it pass."
            onChange={(event) => setJob(event.target.value)}
          />
        </div>
        <div className="wizardSection">
          <label className="wizardLabel" htmlFor="swarm-folder">
            Working folder <span>Git repo → one worktree per role. Else one shared folder.</span>
          </label>
          <div className="folderRow">
            <input
              id="swarm-folder"
              type="text"
              value={folderPath}
              placeholder={homeDir || 'Browse to a project folder'}
              onChange={(event) => setFolderPath(event.target.value)}
            />
            <button className="secondaryButton" type="button" onClick={() => void browse()}>
              Browse…
            </button>
          </div>
          {recents.length > 0 && (
            <div className="recentCards">
              {recents.map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`recentCard${folderPath === path ? ' recentCardActive' : ''}`}
                  onClick={() => setFolderPath(path)}
                >
                  <span>
                    <strong>{folderName(path)}</strong>
                    <small>{path}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="wizardSection">
          <span className="wizardLabel">
            Roles <span>Coordinator · Builder · Scout · Reviewer</span>
          </span>
          <p className="swarmHint">
            Uses installed agent CLIs. Same CLI can hold more than one role. A silent
            pane is nudged once, then closed.
          </p>
        </div>
        {error !== null && (
          <p className="wizardError" role="alert">
            {error}
          </p>
        )}
        <div className="spaceWizardFooter">
          <button className="secondaryButton" type="button" onClick={() => void navigate({ to: '/' })}>
            Back
          </button>
          <button
            className="primaryButton"
            type="button"
            disabled={!ready || launch.isPending}
            onClick={() => launch.mutate()}
          >
            {launch.isPending ? 'Starting…' : 'Launch swarm'}
          </button>
        </div>
      </div>
    </section>
  );
}

function SwarmGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="6.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6.5" cy="16.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.5" cy="16.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M10.6 8.1 7.8 14.4M13.4 8.1l2.8 6.3M8.5 16.5h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  BoardAgentDetection,
  BoardAgentId,
  BoardCreateInput,
  BoardIsolation,
  BoardLandPreview,
  BoardPaneCount,
  BoardPaneSpec,
} from '@zero/protocol/board';
import { BOARD_AGENT_CATALOG, boardGridLayouts } from '@zero/protocol/board';
import type { CorrelationId } from '@zero/shared';
import { useEffect, useState } from 'react';
import { TerminalPane } from '../components/terminal-pane.js';
import { SignalField } from '../components/signal-field.js';
import { AgentMark } from '../components/agent-mark.js';
import { useSpaces } from '../space-store.js';
import logo from '../assets/logo.png';
const PANE_COUNTS: readonly BoardPaneCount[] = [1, 2, 4, 6, 8, 10, 12];
const RECENTS_KEY = 'exeum.space.recents';
const AI_AGENTS = BOARD_AGENT_CATALOG.filter((entry) => entry.id !== 'shell');
const FEATURED_AGENT_IDS: readonly BoardAgentId[] = [
  'claude',
  'codex',
  'grok',
  'kimi',
  'antigravity',
  'opencode',
  'pi',
  'omp',
];
const MODES = [
  {
    id: 'space',
    name: 'Space',
    shortcut: '⌘T',
    enabled: true,
    promise:
      'The terminal built for vibe coding. Split panes, command blocks, and an agent in every shell.',
  },
  {
    id: 'swarm',
    name: 'Swarm',
    shortcut: '⌘S',
    enabled: false,
    promise:
      'Many agents, one job. Coordinators, builders, scouts, and reviewers with budgets and guardrails.',
  },
  {
    id: 'board',
    name: 'Board',
    shortcut: '⌘B',
    enabled: false,
    promise:
      'Plan the work. Work the plan. A Kanban board built for builders — turn loose ideas into shipped tasks.',
  },
  {
    id: 'memory',
    name: 'Memory',
    shortcut: '⌘M',
    enabled: false,
    promise:
      'A living knowledge graph. Persistent memory your agents read and write as they build. Context that compounds.',
  },
] as const;

function SpaceStepper({ step }: { readonly step: 1 | 2 | 3 }): React.JSX.Element {
  const items = [
    { n: 1, label: 'Start' },
    { n: 2, label: 'Layout' },
    { n: 3, label: 'Agents' },
  ] as const;
  return (
    <ol className="spaceStepper">
      {items.map((item) => (
        <li
          key={item.n}
          className={item.n < step ? 'spaceStepperDone' : item.n === step ? 'spaceStepperOn' : ''}
        >
          <i>{item.n < step ? '✓' : item.n}</i>
          {item.label}
        </li>
      ))}
    </ol>
  );
}

function ModeGlyph({ id }: { readonly id: (typeof MODES)[number]['id'] }): React.JSX.Element {
  if (id === 'space') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M7 8.5 10.5 12 7 15.5M13 16.5h4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (id === 'swarm') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="6.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="6.8" cy="16.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="17.2" cy="16.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M10.4 8.1 8.2 14.4M13.6 8.1l2.2 6.3M8.8 16.5h6.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (id === 'board') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="4.5" y="5.5" width="4" height="13" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <rect x="10" y="5.5" width="4" height="8.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <rect x="15.5" y="5.5" width="4" height="11" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="7" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="7.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="16.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 12h6M15.2 8.8 9 11.3M15.2 15.2 9 12.7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LockGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <rect x="6.5" y="11" width="11" height="8.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 11V8.4a3 3 0 0 1 6 0V11" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

interface SlotConfig {
  agentId: BoardAgentId;
  command?: string;
}

type Phase = 'home' | 'workspace' | 'agents' | 'live';

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function writeRecents(folderPath: string): string[] {
  const next = [
    folderPath,
    ...readRecents().filter((item) => item !== folderPath),
  ].slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
}

function firstAvailableAgent(
  detections: readonly BoardAgentDetection[] | undefined,
): BoardAgentId {
  if (detections === undefined) return 'claude';
  const available = new Set(detections.filter((d) => d.available).map((d) => d.id));
  const match = AI_AGENTS.find(
    (entry) => entry.id !== 'custom' && available.has(entry.id),
  );
  return match?.id ?? 'custom';
}

function resizeSlots(
  count: BoardPaneCount,
  current: Record<number, SlotConfig>,
  detections: readonly BoardAgentDetection[] | undefined,
): Record<number, SlotConfig> {
  const fallback = firstAvailableAgent(detections);
  const next: Record<number, SlotConfig> = {};
  for (let slot = 0; slot < count; slot += 1) {
    next[slot] = current[slot] ?? { agentId: fallback };
  }
  return next;
}

function shellSlots(count: BoardPaneCount): Record<number, SlotConfig> {
  const next: Record<number, SlotConfig> = {};
  for (let slot = 0; slot < count; slot += 1) next[slot] = { agentId: 'shell' };
  return next;
}

function assignedCount(counts: Partial<Record<BoardAgentId, number>>): number {
  return Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
}

function resolveFolder(base: string, cd: string, home: string): string {
  let spec = cd.trim().replace(/^cd(?:\s+|$)/i, '');
  if (spec.length === 0) return base.trim().length > 0 ? base.trim() : home;
  if (spec === '~') return home;
  if (spec.startsWith('~/')) spec = `${home}/${spec.slice(2)}`;
  const origin = base.trim().length === 0 ? home : base.trim();
  const parts = (spec.startsWith('/') ? [] : origin.split('/').filter(Boolean)).slice();
  const source = spec.startsWith('/') ? spec.slice(1).split('/') : spec.split('/');
  for (const part of source) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function looksLikeCd(value: string): boolean {
  const trimmed = value.trim();
  return /^cd\s+/i.test(trimmed) || trimmed.startsWith('~');
}

export function BoardPage(): React.JSX.Element {
  const spaceStore = useSpaces();
  const session =
    spaceStore.spaces.find((item) => item.sessionId === spaceStore.activeId) ?? null;
  const [phase, setPhase] = useState<Phase>('home');
  const [folderPath, setFolderPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [paneCount, setPaneCount] = useState<BoardPaneCount>(2);
  const [, setSlots] = useState<Record<number, SlotConfig>>(() =>
    resizeSlots(2, {}, undefined),
  );
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [error, setError] = useState<string | null>(null);
  const [landNotice, setLandNotice] = useState<string | null>(null);
  const [landPreview, setLandPreview] = useState<BoardLandPreview | null>(null);
  const [maximizedBySession, setMaximizedBySession] = useState<
    Record<string, number | null>
  >({});
  const [exitedBySession, setExitedBySession] = useState<Record<string, string[]>>(
    {},
  );
  const [agentCounts, setAgentCounts] = useState<Partial<Record<BoardAgentId, number>>>(
    {},
  );
  const [customCommand, setCustomCommand] = useState('');
  const [showMoreAgents, setShowMoreAgents] = useState(false);
  const [cdInput, setCdInput] = useState('');

  const maximizedSlot =
    session === null ? null : (maximizedBySession[session.sessionId] ?? null);
  const exitedPaneIds = new Set(
    session === null ? [] : (exitedBySession[session.sessionId] ?? []),
  );

  const projects = useQuery({
    queryKey: ['projects-dashboard'],
    queryFn: () => window.zero.projects.dashboard(),
  });
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
    if (phase !== 'home') return;
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        setPhase('workspace');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  useEffect(() => {
    if (!spaceStore.wantSetup) return;
    setPhase('home');
    setError(null);
  }, [spaceStore.wantSetup, spaceStore.draftSeq]);

  function changePaneCount(count: BoardPaneCount): void {
    setPaneCount(count);
    setSlots((current) => resizeSlots(count, current, agents.data));
  }

  const folderReady = folderPath.trim().length > 0 || cdInput.trim().length > 0;


  const launch = useMutation({
    mutationFn: (input: BoardCreateInput) => window.zero.board.createSession(input),
    onMutate: () => setError(null),
    onSuccess: (summary) => {
      setRecents(writeRecents(summary.folderPath));
      spaceStore.upsert(summary);
      setExitedBySession((current) => ({ ...current, [summary.sessionId]: [] }));
      setMaximizedBySession((current) => ({ ...current, [summary.sessionId]: null }));
      setPhase('live');
    },
    onError: (cause: Error) => setError(cause.message),
  });

  function launchSpace(nextSlots: Record<number, SlotConfig>, nextIsolation: BoardIsolation): void {
    setSlots(nextSlots);
    const panes: BoardPaneSpec[] = [];
    for (let slot = 0; slot < paneCount; slot += 1) {
      const config = nextSlots[slot];
      if (config === undefined) continue;
      panes.push({
        slot,
        agentId: config.agentId,
        ...(config.agentId === 'custom' ? { command: config.command?.trim() ?? '' } : {}),
      });
    }
    const working = looksLikeCd(folderPath)
      ? resolveFolder(homeDir, folderPath, homeDir)
      : folderPath.trim();
    launch.mutate({
      correlationId: crypto.randomUUID() as CorrelationId,
      folderPath: resolveFolder(working, cdInput, homeDir),
      paneCount,
      isolation: nextIsolation,
      panes: panes.sort((a, b) => a.slot - b.slot),
    });
  }

  const previewLand = useMutation({
    mutationFn: (branch: string) => {
      if (session === null) throw new Error('No live Space session');
      return window.zero.board.previewLand({
        correlationId: crypto.randomUUID() as CorrelationId,
        repoPath: session.folderPath,
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
      if (session === null) throw new Error('No live Space session');
      return window.zero.board.land({
        correlationId: crypto.randomUUID() as CorrelationId,
        repoPath: session.folderPath,
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


  async function browse(): Promise<void> {
    setError(null);
    const picked = await window.zero.board.selectFolder();
    if (picked !== null) setFolderPath(picked);
  }

  async function closeOnePane(paneId: string): Promise<void> {
    if (session === null) return;
    const sessionId = session.sessionId;
    try {
      await window.zero.board.closePane({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId,
        paneId,
      });
    } catch {
      setError('The pane could not be closed.');
    }
    setExitedBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), paneId],
    }));
  }

  const exitBoard = useMutation({
    mutationFn: async () => {
      if (session === null) return;
      for (const pane of session.panes) {
        await window.zero.board.closePane({
          correlationId: crypto.randomUUID() as CorrelationId,
          sessionId: session.sessionId,
          paneId: pane.paneId,
        });
      }
      return session.sessionId;
    },
    onMutate: () => setError(null),
    onSuccess: (sessionId) => {
      if (sessionId !== undefined) spaceStore.drop(sessionId);
      setPhase('home');
    },
    onError: () => setError('Space could not be closed.'),
  });

  const projectRecents = (projects.data?.projects ?? [])
    .filter((item) => item.repository !== null)
    .slice(0, 8);
  const taken = assignedCount(agentCounts);
  const remaining = paneCount - taken;

  function setAgentCount(id: BoardAgentId, next: number): void {
    setAgentCounts((current) => {
      const others = assignedCount(current) - (current[id] ?? 0);
      return { ...current, [id]: Math.max(0, Math.min(next, paneCount - others)) };
    });
  }

  function slotsFromCounts(): Record<number, SlotConfig> {
    const list: SlotConfig[] = [];
    for (const entry of AI_AGENTS) {
      const copies = agentCounts[entry.id] ?? 0;
      for (let index = 0; index < copies; index += 1) {
        list.push({
          agentId: entry.id,
          ...(entry.id === 'custom' && customCommand.trim().length > 0
            ? { command: customCommand.trim() }
            : {}),
        });
      }
    }
    const next: Record<number, SlotConfig> = {};
    for (let slot = 0; slot < paneCount; slot += 1) {
      next[slot] = list[slot] ?? { agentId: 'shell' };
    }
    return next;
  }

  function fillAgents(mode: 'all' | 'one' | 'split'): void {
    const pool = AI_AGENTS.filter((entry) => entry.id !== 'custom');
    const next: Partial<Record<BoardAgentId, number>> = {};
    if (mode === 'one') {
      pool.slice(0, paneCount).forEach((entry, index) => {
        if (index < paneCount) next[entry.id] = 1;
      });
    } else if (mode === 'all') {
      pool.forEach((entry, index) => {
        if (index < paneCount) next[entry.id] = 1;
      });
    } else {
      const chosen = FEATURED_AGENT_IDS.filter((id) => id !== 'custom');
      const base = Math.floor(paneCount / chosen.length);
      let extra = paneCount % chosen.length;
      for (const id of chosen) {
        next[id] = base + (extra > 0 ? 1 : 0);
        if (extra > 0) extra -= 1;
      }
    }
    setAgentCounts(next);
  }

  if (!spaceStore.draft && session !== null) {
    const layout = boardGridLayouts[session.paneCount];
    const maximized = maximizedSlot !== null;
    const visiblePanes = session.panes
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .filter((pane) => !maximized || pane.slot === maximizedSlot);

    return (
      <section className="boardPage" aria-labelledby="board-title" data-core-status="ready">
        <div className="boardToolbar">
          <h1 id="board-title">
            Space · {folderName(session.folderPath)} · {session.paneCount} terminals
          </h1>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => exitBoard.mutate()}
            disabled={exitBoard.isPending}
          >
            Close Space
          </button>
        </div>
        {landNotice !== null && (
          <p className="wizardError" role="status">
            {landNotice}
          </p>
        )}
        {error !== null && (
          <p className="wizardError" role="alert">
            {error}
          </p>
        )}
        <div
          className={`boardGrid${maximized ? ' boardGridMaximized' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${maximized ? 1 : layout.cols}, 1fr)`,
            gridTemplateRows: `repeat(${maximized ? 1 : layout.rows}, 1fr)`,
          }}
        >
          {visiblePanes.map((pane) =>
            exitedPaneIds.has(pane.paneId) ? (
              <div key={pane.paneId} className="terminalPane">
                <header className="paneHeader">
                  <span className="paneDot dot-exited" />
                  <span className="paneTitle">{pane.title}</span>
                  <span className="paneExitedLabel">exited</span>
                </header>
              </div>
            ) : (
              <TerminalPane
                key={pane.paneId}
                sessionId={session.sessionId}
                pane={pane}
                maximized={maximized}
                landing={land.isPending || previewLand.isPending}
                confirmLand={landPreview?.branch === pane.branch && landPreview.ahead > 0}
                onToggleMaximize={() => {
                  const sessionId = session.sessionId;
                  setMaximizedBySession((current) => ({
                    ...current,
                    [sessionId]: current[sessionId] === pane.slot ? null : pane.slot,
                  }));
                }}
                onClose={() => void closeOnePane(pane.paneId)}
                onLand={
                  pane.branch === null
                    ? undefined
                    : () => {
                        const branch = pane.branch as string;
                        if (landPreview?.branch === branch && landPreview.ahead > 0) {
                          land.mutate(branch);
                          return;
                        }
                        previewLand.mutate(branch);
                      }
                }
              />
            ),
          )}
        </div>
      </section>
    );
  }

  if (phase === 'home') {
    return (
      <section className="spaceStage" aria-labelledby="space-home-title" data-core-status="ready">
        <SignalField />
        <div className="spaceHome">
          <div className="spaceHomeBrand">
            <img className="spaceHomeLogo" src={logo} width={56} height={56} alt="" />
            BuilderHelm
          </div>
          <h1 id="space-home-title">
            Your agents.
            <br />
            You at the helm.
          </h1>
          <p className="wizardLabel">
            Workspaces <span>Choose how you want to work</span>
          </p>
          <ul className="spaceModes">
            {MODES.map((mode) => (
              <li key={mode.id}>
                <button
                  type="button"
                  className="spaceMode"
                  disabled={!mode.enabled}
                  onClick={() => {
                    if (mode.enabled) setPhase('workspace');
                  }}
                >
                  <span className="spaceModeIcon">
                    <ModeGlyph id={mode.id} />
                  </span>
                  <span className="spaceModeText">
                    <strong>{mode.name}</strong>
                    <span className="spaceModeHint" aria-hidden="true">
                      <span>{mode.promise}</span>
                    </span>
                  </span>
                  {mode.enabled ? (
                    <>
                      <kbd>{mode.shortcut}</kbd>
                      <span className="spaceModeOpen">Open →</span>
                    </>
                  ) : (
                    <span className="spaceModeSoon">
                      <LockGlyph />
                      Soon
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="spaceHomeKeys">
            <span>
              <kbd>⌘T</kbd> Space
            </span>
            <span>
              <kbd>⌘S</kbd> Swarm
            </span>
            <Link to="/settings/providers">
              <kbd>⌘,</kbd> Settings
            </Link>
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'agents') {
    const visibleAgents = AI_AGENTS.filter(
      (entry) =>
        entry.id === 'custom' ||
        showMoreAgents ||
        FEATURED_AGENT_IDS.includes(entry.id),
    );
    const hiddenCount = AI_AGENTS.filter(
      (entry) => entry.id !== 'custom' && !FEATURED_AGENT_IDS.includes(entry.id),
    ).length;
    const customAssigned = agentCounts.custom ?? 0;
    const canOpen =
      taken > 0 && (customAssigned === 0 || customCommand.trim().length > 0);
    return (
      <section className="spaceStage" aria-labelledby="space-agents-title" data-core-status="ready">
        <SignalField />
        <div className="boardPage spaceWizard spaceAgents">
        <SpaceStepper step={3} />
        <h1 id="space-agents-title">Add AI coding agents</h1>
        <p className="lede">
          Pick which agents launch in your {paneCount} terminal
          {paneCount === 1 ? '' : 's'} — or skip this step entirely.
        </p>
        <div className="wizardSection">
          <span className="wizardLabel">
            Agents <span>Pick who launches in your {paneCount} terminals</span>
          </span>
          <div className="agentProgress">
            <strong>
              {taken} / {paneCount}
            </strong>
            <span className="agentProgressTrack" aria-hidden="true">
              <span
                className="agentProgressFill"
                style={{ width: `${(taken / paneCount) * 100}%` }}
              />
            </span>
            <em>{taken === 0 ? 'No agents yet' : `${remaining} left`}</em>
          </div>
          <div className="agentQuick">
            <span>Quick fill</span>
            <button type="button" className="chip" onClick={() => fillAgents('all')}>
              Enable all
            </button>
            <button type="button" className="chip" onClick={() => fillAgents('one')}>
              One of each
            </button>
            <button type="button" className="chip" onClick={() => fillAgents('split')}>
              Split evenly
            </button>
          </div>
        <div className="agentGrid">
          {visibleAgents
            .filter((entry) => entry.id !== 'custom')
            .map((entry) => {
              const count = agentCounts[entry.id] ?? 0;
              return (
                <div
                  className={`agentRow${count > 0 ? ' agentRowOn' : ''}`}
                  key={entry.id}
                >
                  <AgentMark
                    id={entry.id}
                    on={count > 0}
                    onClick={() => setAgentCount(entry.id, count > 0 ? 0 : 1)}
                  />
                  <span className="agentName">{entry.label}</span>
                  <button
                    type="button"
                    className="agentAll"
                    onClick={() => setAgentCounts({ [entry.id]: paneCount })}
                  >
                    All
                  </button>
                  <div className="agentStepper">
                    <button
                      type="button"
                      disabled={count === 0}
                      onClick={() => setAgentCount(entry.id, count - 1)}
                    >
                      −
                    </button>
                    <strong>{count}</strong>
                    <button
                      type="button"
                      disabled={remaining === 0}
                      onClick={() => setAgentCount(entry.id, count + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
        {!showMoreAgents && hiddenCount > 0 && (
          <button
            type="button"
            className="agentMore"
            onClick={() => setShowMoreAgents(true)}
          >
            Show {hiddenCount} more agents
          </button>
        )}
        <div className={`agentCustom${customAssigned > 0 ? ' agentRowOn' : ''}`}>
          <div className="agentRow">
            <AgentMark
              id="custom"
              on={customAssigned > 0}
              onClick={() => setAgentCount('custom', customAssigned > 0 ? 0 : 1)}
            />
            <span className="agentName">
              Custom command
              <small>Any CLI agent or shell command</small>
            </span>
            <button
              type="button"
              className="agentAll"
              onClick={() => setAgentCounts({ custom: paneCount })}
            >
              All
            </button>
            <div className="agentStepper">
              <button
                type="button"
                disabled={customAssigned === 0}
                onClick={() => setAgentCount('custom', customAssigned - 1)}
              >
                −
              </button>
              <strong>{customAssigned}</strong>
              <button
                type="button"
                disabled={remaining === 0}
                onClick={() => setAgentCount('custom', customAssigned + 1)}
              >
                +
              </button>
            </div>
          </div>
          <input
            type="text"
            placeholder="e.g. aider --yes-always"
            value={customCommand}
            onChange={(event) => setCustomCommand(event.target.value)}
          />
        </div>
        </div>
        {error !== null && (
          <p className="wizardError" role="alert">
            {error}
          </p>
        )}
        <div className="spaceWizardFooter">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => setPhase('workspace')}
          >
            Back
          </button>
          <div className="spaceWizardActions">
            <button
              className="secondaryButton"
              type="button"
              disabled={!folderReady || launch.isPending}
              onClick={() => launchSpace(shellSlots(paneCount), 'shared')}
            >
              Skip — no agents
            </button>
            <button
              className="primaryButton"
              type="button"
              disabled={!folderReady || !canOpen || launch.isPending}
              onClick={() => launchSpace(slotsFromCounts(), 'shared')}
            >
              {canOpen ? 'Open Space' : 'Pick at least one agent'}
            </button>
          </div>
        </div>
        </div>
      </section>
    );
  }

  return (
    <section className="spaceStage" aria-labelledby="space-setup-title" data-core-status="ready">
      <SignalField />
      <div className="boardPage spaceWizard">
      <SpaceStepper step={2} />
      <h1 id="space-setup-title">Set up your workspace</h1>
      <p className="lede">Pick a folder to work in and choose how many terminals you want.</p>

      <div className="wizardSection">
        <label className="wizardLabel" htmlFor="board-folder">
          Working folder <span>Where your terminals will start</span>
        </label>
        <div className="folderRow">
          <input
            id="board-folder"
            type="text"
            value={folderPath}
            placeholder="Browse to a project folder"
            onChange={(event) => setFolderPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !looksLikeCd(folderPath)) return;
              event.preventDefault();
              setFolderPath(resolveFolder(homeDir, folderPath, homeDir));
            }}
          />
          <button className="secondaryButton" type="button" onClick={() => void browse()}>
            Browse…
          </button>
        </div>
        <div className="folderRow">
          <input
            type="text"
            value={cdInput}
            placeholder="cd Developer"
            onChange={(event) => setCdInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && cdInput.trim().length > 0) {
                setFolderPath(resolveFolder(folderPath, cdInput, homeDir));
                setCdInput('');
              }
            }}
          />
        </div>
      </div>

      <div className="wizardSection">
        <div className="wizardLabelRow">
          <span className="wizardLabel">
            How many terminals? <span>Tap a tile to choose a layout</span>
          </span>
          <small>
            {paneCount} terminal{paneCount === 1 ? '' : 's'} · {boardGridLayouts[paneCount].cols}×
            {boardGridLayouts[paneCount].rows} grid
          </small>
        </div>
        <div className="layoutTiles">
          {PANE_COUNTS.map((count) => {
            const layout = boardGridLayouts[count];
            return (
              <button
                key={count}
                type="button"
                className={`layoutTile${count === paneCount ? ' layoutTileActive' : ''}`}
                onClick={() => changePaneCount(count)}
              >
                <span
                  className="layoutPreview"
                  style={{
                    gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                    gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
                  }}
                >
                  {Array.from({ length: count }, (_, index) => (
                    <i key={index} />
                  ))}
                </span>
                {count}
              </button>
            );
          })}
        </div>
      </div>

      {(recents.length > 0 || projectRecents.length > 0) && (
        <div className="wizardSection">
          <span className="wizardLabel">
            Recent <span>Last opened workspaces</span>
          </span>
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
            {projectRecents.map((item) => {
              const repo = item.repository;
              if (repo === null) return null;
              return (
                <button
                  key={item.project.id}
                  type="button"
                  className={`recentCard${folderPath === repo.rootPath ? ' recentCardActive' : ''}`}
                  onClick={() => setFolderPath(repo.rootPath)}
                >
                  <span>
                    <strong>{repo.directoryName}</strong>
                    <small>{repo.rootPath}</small>
                  </span>
                  <em>{item.tasks.length}</em>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error !== null && (
        <p className="wizardError" role="alert">
          {error}
        </p>
      )}

      <div className="spaceWizardFooter">
        <button
          className="secondaryButton"
          type="button"
          onClick={() => {
            spaceStore.hideSetup();
            setPhase('home');
          }}
        >
          Back
        </button>
        <div className="spaceWizardActions">
          <button
            className="secondaryButton"
            type="button"
            disabled={!folderReady || launch.isPending}
            onClick={() => launchSpace(shellSlots(paneCount), 'shared')}
          >
            Open without AI
          </button>
          <button
            className="primaryButton"
            type="button"
            disabled={!folderReady}
            onClick={() => setPhase('agents')}
          >
            Next: Add AI agents
          </button>
        </div>
      </div>
      </div>
    </section>
  );
}

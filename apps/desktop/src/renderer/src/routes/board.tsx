import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type {
  BoardAgentDetection,
  BoardAgentId,
  BoardCreateInput,
  BoardIsolation,
  BoardLandPreview,
  BoardPaneCount,
  BoardPaneSpec,
} from '@builderhelm/protocol/board';
import {
  BOARD_AGENT_CATALOG,
  BOARD_WORKTREE_BRANCH_PREFIX,
  boardGridLayouts,
  gridForCount,
} from '@builderhelm/protocol/board';
import type { CorrelationId } from '@builderhelm/shared';
import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from '../components/terminal-pane.js';
import { AgentGlyph, AgentMark } from '../components/agent-mark.js';
import { useBoards } from '../board-store.js';
import { useSpaces } from '../space-store.js';

const PANE_COUNTS: readonly BoardPaneCount[] = [1, 2, 4, 6, 8, 10, 12, 16];
const RECENTS_KEY = 'builderhelm.space.recents';
const AI_AGENTS = BOARD_AGENT_CATALOG.filter((entry) => entry.id !== 'shell');
const FEATURED_AGENT_IDS: readonly BoardAgentId[] = [
  'claude',
  'codex',
  'grok',
  'kimi',
  'kiro',
  'antigravity',
  'opencode',
  'pi',
  'omp',
];
const VIBE_AGENT_IDS: readonly BoardAgentId[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'copilot',
  'omp',
  'shell',
];

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
          className={
            item.n < step ? 'spaceStepperDone' : item.n === step ? 'spaceStepperOn' : ''
          }
        >
          <i>{item.n < step ? '✓' : item.n}</i>
          {item.label}
        </li>
      ))}
    </ol>
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

function usableRecent(path: string): boolean {
  return path.startsWith('/') && !/^\/Users\/[^/]+\/private\//.test(path);
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string => typeof item === 'string' && usableRecent(item),
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function writeRecents(folderPath: string): string[] {
  if (!usableRecent(folderPath)) return readRecents();
  const next = [folderPath, ...readRecents().filter((item) => item !== folderPath)].slice(
    0,
    8,
  );
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
  const navigate = useNavigate();
  const boards = useBoards();
  const spaceStore = useSpaces();
  const session =
    spaceStore.spaces.find((item) => item.sessionId === spaceStore.activeId) ?? null;
  const panePicker = useRef<HTMLDialogElement>(null);
  const [addAfter, setAddAfter] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('home');
  const [folderPath, setFolderPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [isolation, setIsolation] = useState<BoardIsolation>('worktree');
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

  const [agentCounts, setAgentCounts] = useState<Partial<Record<BoardAgentId, number>>>(
    {},
  );
  const [customCommand, setCustomCommand] = useState('');
  const [showMoreAgents, setShowMoreAgents] = useState(false);
  const [cdInput, setCdInput] = useState('');
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [cdError, setCdError] = useState<string | null>(null);

  const maximizedSlot =
    session === null ? null : (maximizedBySession[session.sessionId] ?? null);

  const projects = useQuery({
    queryKey: ['projects-dashboard'],
    queryFn: () => window.builderHelm.projects.dashboard(),
  });
  const agents = useQuery({
    queryKey: ['board-agents'],
    queryFn: () => window.builderHelm.board.detectAgents(),
  });

  useEffect(() => {
    void window.builderHelm.board
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
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        boards.choose();
        void navigate({ to: '/board' });
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        void navigate({ to: '/memory' });
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void navigate({ to: '/swarm' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, navigate, boards]);

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
    mutationFn: (input: BoardCreateInput) =>
      window.builderHelm.board.createSession(input),
    onMutate: () => setError(null),
    onSuccess: (summary) => {
      setRecents(writeRecents(summary.folderPath));
      spaceStore.upsert(summary);
      setMaximizedBySession((current) => ({ ...current, [summary.sessionId]: null }));
      setPhase('live');
    },
    onError: (cause: Error) => setError(cause.message),
  });

  async function applyCd(input: string): Promise<boolean> {
    const target = resolveFolder(folderPath, input, homeDir);
    try {
      await window.builderHelm.editor.list({ root: target });
    } catch {
      setCdError(`Not found: ${input.trim()}`);
      return false;
    }
    setCdError(null);
    setFolderPath(target);
    return true;
  }

  async function launchSpace(
    nextSlots: Record<number, SlotConfig>,
    nextIsolation: BoardIsolation,
  ): Promise<void> {
    if (cdInput.trim().length > 0 && !(await applyCd(cdInput))) return;
    const working = looksLikeCd(folderPath)
      ? resolveFolder(homeDir, folderPath, homeDir)
      : folderPath.trim();
    const panes: BoardPaneSpec[] = [];
    for (let slot = 0; slot < paneCount; slot += 1) {
      const config = nextSlots[slot];
      if (config === undefined) continue;
      const catalog = BOARD_AGENT_CATALOG.find((entry) => entry.id === config.agentId);
      panes.push({
        slot,
        agentId: config.agentId,
        ...(config.agentId === 'custom'
          ? { command: config.command?.trim() ?? '' }
          : catalog !== undefined && catalog.command.length > 0
            ? { command: catalog.command }
            : {}),
      });
    }
    launch.mutate({
      correlationId: crypto.randomUUID() as CorrelationId,
      folderPath: working,
      paneCount,
      isolation: nextIsolation,
      panes: panes.sort((a, b) => a.slot - b.slot),
    });
  }

  async function launchOne(agentId: BoardAgentId): Promise<void> {
    let working = looksLikeCd(folderPath)
      ? resolveFolder(homeDir, folderPath, homeDir)
      : folderPath.trim();
    if (working.length === 0 || working === homeDir) {
      try {
        const picked = await window.builderHelm.board.selectFolder();
        if (picked === null) return;
        working = picked;
        setFolderPath(picked);
      } catch {
        setError('The project folder could not be opened.');
        return;
      }
    }
    const catalog = BOARD_AGENT_CATALOG.find((entry) => entry.id === agentId);
    launch.mutate({
      correlationId: crypto.randomUUID() as CorrelationId,
      folderPath: working,
      paneCount: 1,
      isolation,
      panes: [
        {
          slot: 0,
          agentId,
          ...(catalog !== undefined && catalog.command.length > 0
            ? { command: catalog.command }
            : {}),
        },
      ],
    });
  }
  const previewLand = useMutation({
    mutationFn: (branch: string) => {
      if (session === null) throw new Error('No live Space session');
      return window.builderHelm.board.previewLand({
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
      return window.builderHelm.board.land({
        correlationId: crypto.randomUUID() as CorrelationId,
        repoPath: session.folderPath,
        branch,
        reviewedHead: landPreview?.headSha,
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
    const picked = await window.builderHelm.board.selectFolder();
    if (picked !== null) setFolderPath(picked);
  }

  async function closeOnePane(paneId: string): Promise<void> {
    if (session === null) return;
    const sessionId = session.sessionId;
    try {
      await window.builderHelm.board.closePane({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId,
        paneId,
      });
    } catch {
      setError('The pane could not be closed.');
      return;
    }
    const remaining = session.panes
      .filter((pane) => pane.paneId !== paneId)
      .sort((left, right) => left.slot - right.slot)
      .map((pane, index) => ({ ...pane, slot: index }));
    if (remaining.length === 0) {
      spaceStore.drop(sessionId);
      setPhase('home');
      return;
    }
    spaceStore.upsert({
      ...session,
      panes: remaining,
      paneCount: remaining.length,
    });
    setMaximizedBySession((current) => ({ ...current, [sessionId]: null }));
  }

  async function addTerminal(afterPaneId: string, agentId: BoardAgentId): Promise<void> {
    if (session === null || session.panes.length >= 16) return;
    try {
      const pane = await window.builderHelm.board.addPane({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId: session.sessionId,
        agentId,
      });
      const ordered = session.panes.slice().sort((left, right) => left.slot - right.slot);
      const index = ordered.findIndex((item) => item.paneId === afterPaneId);
      const insertAt = index < 0 ? ordered.length : index + 1;
      const next = ordered.slice();
      next.splice(insertAt, 0, pane);
      spaceStore.upsert({
        ...session,
        panes: next.map((item, slot) => ({ ...item, slot })),
        paneCount: next.length,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add a terminal');
    }
  }

  function reorderPanes(fromId: string, toId: string): void {
    if (session === null || fromId === toId) return;
    const ordered = session.panes.slice().sort((left, right) => left.slot - right.slot);
    const from = ordered.findIndex((pane) => pane.paneId === fromId);
    const to = ordered.findIndex((pane) => pane.paneId === toId);
    if (from < 0 || to < 0) return;
    const next = ordered.slice();
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    spaceStore.upsert({
      ...session,
      panes: next.map((pane, index) => ({ ...pane, slot: index })),
    });
  }

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
    const layout =
      session.panes.length === 3
        ? { cols: 2, rows: 2 }
        : gridForCount(session.panes.length);
    const maximized = maximizedSlot !== null;
    const visiblePanes = session.panes
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .filter((pane) => !maximized || pane.slot === maximizedSlot);

    return (
      <section
        className="boardPage"
        aria-label={`BuilderHelm Space · ${folderName(session.folderPath)}`}
        data-core-status="ready"
      >
        <p className="workspaceContext">
          {session.isolation === 'worktree' ? 'Isolated checkouts' : 'Shared folder'} ·{' '}
          {session.folderPath}
        </p>
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
        <dialog
          ref={panePicker}
          className="profileDialog paneLauncher"
          aria-labelledby="pane-launch-title"
        >
          <h2 id="pane-launch-title">Add an agent or terminal</h2>
          <div className="vibeAgents">
            {VIBE_AGENT_IDS.map((id) => {
              const item = BOARD_AGENT_CATALOG.find((entry) => entry.id === id);
              const available =
                id === 'shell' ||
                agents.data?.some((entry) => entry.id === id && entry.available);
              return (
                <button
                  key={id}
                  type="button"
                  className="vibeAgent"
                  disabled={!available}
                  onClick={() => {
                    panePicker.current?.close();
                    if (addAfter !== null) void addTerminal(addAfter, id);
                  }}
                >
                  <AgentGlyph id={id} />
                  {item?.label ?? id}
                </button>
              );
            })}
          </div>
          <div className="profileDialogActions">
            <span className="profileDialogSpacer" />
            <button
              type="button"
              className="profileButton"
              onClick={() => panePicker.current?.close()}
            >
              Cancel
            </button>
          </div>
        </dialog>
        <div
          className={`boardGrid${maximized ? ' boardGridMaximized' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${maximized ? 1 : layout.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${maximized ? 1 : layout.rows}, minmax(0, 1fr))`,
          }}
        >
          {visiblePanes.map((pane) => (
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
              onAdd={
                session.panes.length >= 16
                  ? undefined
                  : () => {
                      setAddAfter(pane.paneId);
                      panePicker.current?.showModal();
                    }
              }
              onDragStart={() => setDraggedPaneId(pane.paneId)}
              onDrop={() => {
                if (draggedPaneId !== null) reorderPanes(draggedPaneId, pane.paneId);
                setDraggedPaneId(null);
              }}
              onLand={
                pane.branch === null ||
                !pane.branch.startsWith(BOARD_WORKTREE_BRANCH_PREFIX)
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
          ))}
        </div>
      </section>
    );
  }

  if (phase === 'home') {
    const folder = folderName(folderPath);
    const named = folder.length > 0 && folderPath !== homeDir;
    const available = new Set(
      (agents.data ?? []).filter((entry) => entry.available).map((entry) => entry.id),
    );
    return (
      <section
        className="spaceStage"
        aria-labelledby="space-home-title"
        data-core-status="ready"
      >
        <div className="vibeHome">
          <h1 id="space-home-title">Start vibe coding{named ? ` in ${folder}` : ''}</h1>
          <p>Choose an agent or open a simple terminal.</p>
          <div className="vibeAgents">
            {VIBE_AGENT_IDS.map((id) => {
              const entry = BOARD_AGENT_CATALOG.find((item) => item.id === id);
              const ready = id === 'shell' || available.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className="vibeAgent"
                  disabled={!ready || launch.isPending}
                  onClick={() => void launchOne(id)}
                >
                  <AgentGlyph id={id} />
                  {entry?.label ?? id}
                </button>
              );
            })}
          </div>
          <p className="vibeHint">
            These run in real terminals over your own folders. Swarm and Board stay on ⌘K.
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'agents') {
    const visibleAgents = AI_AGENTS.filter(
      (entry) =>
        entry.id === 'custom' || showMoreAgents || FEATURED_AGENT_IDS.includes(entry.id),
    );
    const hiddenCount = AI_AGENTS.filter(
      (entry) => entry.id !== 'custom' && !FEATURED_AGENT_IDS.includes(entry.id),
    ).length;
    const customAssigned = agentCounts.custom ?? 0;
    const canOpen =
      taken > 0 && (customAssigned === 0 || customCommand.trim().length > 0);
    return (
      <section
        className="spaceStage"
        aria-labelledby="space-agents-title"
        data-core-status="ready"
      >
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
                onClick={() => launchSpace(shellSlots(paneCount), isolation)}
              >
                Skip — no agents
              </button>
              <button
                className="primaryButton"
                type="button"
                disabled={!folderReady || !canOpen || launch.isPending}
                onClick={() => launchSpace(slotsFromCounts(), isolation)}
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
    <section
      className="spaceStage"
      aria-labelledby="space-setup-title"
      data-core-status="ready"
    >
      <div className="boardPage spaceWizard">
        <SpaceStepper step={2} />
        <h1 id="space-setup-title">Set up your workspace</h1>
        <p className="lede">
          Pick a folder to work in and choose how many terminals you want.
        </p>

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
              className={cdError !== null ? 'inputInvalid' : undefined}
              onChange={(event) => setFolderPath(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key !== 'Enter' || !looksLikeCd(folderPath)) return;
                event.preventDefault();
                const resolved = resolveFolder(homeDir, folderPath, homeDir);
                try {
                  await window.builderHelm.editor.list({ root: resolved });
                  setCdError(null);
                  setFolderPath(resolved);
                } catch {
                  setCdError(`Not found: ${folderPath.trim()}`);
                }
              }}
            />
            <button
              className="iconButton folderBrowseButton"
              type="button"
              onClick={() => void browse()}
              title="Browse…"
              aria-label="Browse for folder"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <circle
                  cx="10.5"
                  cy="10.5"
                  r="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <line
                  x1="15.5"
                  y1="15.5"
                  x2="20"
                  y2="20"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="folderRow">
            <input
              type="text"
              value={cdInput}
              placeholder="cd Developer"
              className={cdError !== null ? 'inputInvalid' : undefined}
              onChange={(event) => {
                setCdInput(event.target.value);
                if (cdError !== null) setCdError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || cdInput.trim().length === 0) return;
                event.preventDefault();
                void applyCd(cdInput).then((ok) => {
                  if (ok) setCdInput('');
                });
              }}
            />
          </div>
          {cdError !== null && (
            <p className="cdError" role="alert">
              {cdError}
            </p>
          )}
        </div>

        <div className="wizardSection">
          <div className="wizardLabelRow">
            <span className="wizardLabel">
              How many terminals? <span>Tap a tile to choose a layout</span>
            </span>
            <small>
              {paneCount} terminal{paneCount === 1 ? '' : 's'} ·{' '}
              {boardGridLayouts[paneCount].cols}×{boardGridLayouts[paneCount].rows} grid
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
                      gridTemplateColumns: `repeat(${layout.cols}, 8px)`,
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

        <div className="wizardSection">
          <label className="wizardLabel" htmlFor="space-isolation">
            Isolation <span>Independent checkouts, or one shared folder</span>
          </label>
          <select
            id="space-isolation"
            aria-label="Workspace isolation"
            value={isolation}
            onChange={(event) => setIsolation(event.target.value as BoardIsolation)}
          >
            <option value="worktree">Isolated Git worktree per agent</option>
            <option value="shared">Shared folder — agents edit the same files</option>
          </select>
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
              onClick={() => launchSpace(shellSlots(paneCount), isolation)}
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

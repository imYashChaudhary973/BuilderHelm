import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BoardAgentDetection,
  BoardAgentId,
  BoardCreateInput,
  BoardIsolation,
  BoardPaneCount,
  BoardPaneSpec,
  BoardSessionSummary,
} from '@zero/protocol/board';
import { BOARD_AGENT_CATALOG, boardGridLayouts } from '@zero/protocol/board';
import type { CorrelationId } from '@zero/shared';
import { useState } from 'react';

import { TerminalPane } from '../components/terminal-pane.js';

const PANE_COUNTS: readonly BoardPaneCount[] = [1, 2, 4, 6, 8, 10, 12];

interface SlotConfig {
  agentId: BoardAgentId;
  command?: string;
}

function firstAvailableAgent(
  detections: readonly BoardAgentDetection[] | undefined,
): BoardAgentId {
  if (detections === undefined || detections.length === 0) {
    return BOARD_AGENT_CATALOG[0]?.id ?? 'custom';
  }
  const available = new Set(detections.filter((d) => d.available).map((d) => d.id));
  const match = BOARD_AGENT_CATALOG.find(
    (entry) => entry.id !== 'custom' && available.has(entry.id),
  );
  return match?.id ?? 'custom';
}

function resizeSlots(
  count: BoardPaneCount,
  current: Record<number, SlotConfig>,
  detections: readonly BoardAgentDetection[] | undefined,
): Record<number, SlotConfig> {
  const next: Record<number, SlotConfig> = {};
  const fallback = firstAvailableAgent(detections);
  for (let slot = 0; slot < count; slot += 1) {
    next[slot] = current[slot] ?? { agentId: fallback };
  }
  return next;
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function BoardPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<'setup' | 'live'>('setup');
  const [folderPath, setFolderPath] = useState('');
  const [paneCount, setPaneCount] = useState<BoardPaneCount>(4);
  const [slots, setSlots] = useState<Record<number, SlotConfig>>(() =>
    resizeSlots(4, {}, undefined),
  );
  const [isolation, setIsolation] = useState<BoardIsolation>('worktree');
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<BoardSessionSummary | null>(null);
  const [maximizedSlot, setMaximizedSlot] = useState<number | null>(null);
  const [exitedPaneIds, setExitedPaneIds] = useState<ReadonlySet<string>>(new Set());

  const projects = useQuery({
    queryKey: ['projects-dashboard'],
    queryFn: () => window.zero.projects.dashboard(),
  });
  const agents = useQuery({
    queryKey: ['board-agents'],
    queryFn: () => window.zero.board.detectAgents(),
  });
  const presets = useQuery({
    queryKey: ['board-presets'],
    queryFn: () => window.zero.board.listPresets(),
  });

  function updateSlot(slot: number, patch: Partial<SlotConfig>): void {
    setSlots((current) => {
      const base = current[slot];
      if (base === undefined) return current;
      const next: Record<number, SlotConfig> = { ...current };
      next[slot] = {
        agentId: patch.agentId ?? base.agentId,
        ...(patch.command !== undefined
          ? { command: patch.command }
          : base.command !== undefined
            ? { command: base.command }
            : {}),
      };
      return next;
    });
  }

  function applyToAll(): void {
    const source = slots[0];
    if (source === undefined) return;
    const next: Record<number, SlotConfig> = {};
    for (let slot = 0; slot < paneCount; slot += 1) next[slot] = { ...source };
    setSlots(next);
  }

  function changePaneCount(count: BoardPaneCount): void {
    setPaneCount(count);
    setSlots((current) => resizeSlots(count, current, agents.data));
    setMaximizedSlot(null);
  }

  const launchReady =
    folderPath.trim().length > 0 &&
    Array.from({ length: paneCount }, (_, slot) => slots[slot]).every(
      (config) =>
        config !== undefined &&
        (config.agentId !== 'custom' || (config.command?.trim().length ?? 0) > 0),
    );

  function launchBoard(): void {
    const panes: BoardPaneSpec[] = [];
    for (let slot = 0; slot < paneCount; slot += 1) {
      const config = slots[slot];
      if (config === undefined) continue;
      panes.push({
        slot,
        agentId: config.agentId,
        ...(config.agentId === 'custom' ? { command: config.command?.trim() ?? '' } : {}),
      });
    }
    launch.mutate({
      correlationId: crypto.randomUUID() as CorrelationId,
      folderPath: folderPath.trim(),
      paneCount,
      isolation,
      panes: panes.sort((a, b) => a.slot - b.slot),
    });
  }

  const launch = useMutation({
    mutationFn: (input: BoardCreateInput) => window.zero.board.createSession(input),
    onMutate: () => setError(null),
    onSuccess: (summary) => {
      setSession(summary);
      setExitedPaneIds(new Set());
      setMaximizedSlot(null);
      setPhase('live');
    },
    onError: () => setError('The board could not be launched.'),
  });

  const savePreset = useMutation({
    mutationFn: () =>
      window.zero.board.savePreset({
        correlationId: crypto.randomUUID() as CorrelationId,
        preset: {
          name: presetName.trim(),
          folderPath: folderPath.trim(),
          paneCount,
          isolation,
          panes: Array.from({ length: paneCount }, (_, slot) => {
            const config = slots[slot];
            return {
              slot,
              agentId: config?.agentId ?? 'custom',
              ...(config?.command?.trim() ? { command: config.command.trim() } : {}),
            };
          }),
        },
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setPresetName('');
      await queryClient.invalidateQueries({ queryKey: ['board-presets'] });
    },
    onError: () => setError('The preset could not be saved.'),
  });

  const deletePreset = useMutation({
    mutationFn: (id: string) =>
      window.zero.board.deletePreset({
        correlationId: crypto.randomUUID() as CorrelationId,
        id,
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['board-presets'] });
    },
    onError: () => setError('The preset could not be deleted.'),
  });

  function loadPreset(id: string): void {
    const preset = presets.data?.find((record) => record.id === id);
    if (preset === undefined) return;
    setError(null);
    setFolderPath(preset.folderPath);
    setPaneCount(preset.paneCount);
    setIsolation(preset.isolation);
    const base = resizeSlots(preset.paneCount, {}, agents.data);
    for (const pane of preset.panes) {
      base[pane.slot] = {
        agentId: pane.agentId,
        ...(pane.command !== undefined ? { command: pane.command } : {}),
      };
    }
    setSlots(base);
  }

  async function browse(): Promise<void> {
    setError(null);
    const picked = await window.zero.board.selectFolder();
    if (picked !== null) setFolderPath(picked);
  }

  async function closeOnePane(paneId: string): Promise<void> {
    if (session === null) return;
    try {
      await window.zero.board.closePane({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId: session.sessionId,
        paneId,
      });
    } catch {
      setError('The pane could not be closed.');
    }
    setExitedPaneIds((current) => new Set(current).add(paneId));
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
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setPhase('setup');
      setSession(null);
      setMaximizedSlot(null);
      setExitedPaneIds(new Set());
    },
    onError: () => setError('The board could not be exited.'),
  });

  if (phase === 'live' && session !== null) {
    const layout = boardGridLayouts[session.paneCount];
    const maximized = maximizedSlot !== null;
    const visiblePanes = session.panes
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .filter((pane) => !maximized || pane.slot === maximizedSlot);

    return (
      <section className="boardPage" aria-labelledby="board-title">
        <div className="boardToolbar">
          <h1 id="board-title">
            Board · {folderName(session.folderPath)} · {session.paneCount} panes
          </h1>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => exitBoard.mutate()}
            disabled={exitBoard.isPending}
          >
            Exit board
          </button>
        </div>
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
                onToggleMaximize={() =>
                  setMaximizedSlot((current) =>
                    current === pane.slot ? null : pane.slot,
                  )
                }
                onClose={() => void closeOnePane(pane.paneId)}
              />
            ),
          )}
        </div>
      </section>
    );
  }

  const availableById = new Map((agents.data ?? []).map((d) => [d.id, d.available]));
  const recentChips = projects.data?.projects.slice(0, 8) ?? [];

  return (
    <section className="boardPage" aria-labelledby="board-setup-title">
      <h1 id="board-setup-title">Board</h1>

      <div className="wizardSection">
        <label className="wizardLabel" htmlFor="board-folder">
          Working folder
        </label>
        <div className="folderRow">
          <input
            id="board-folder"
            type="text"
            value={folderPath}
            placeholder="/path/to/project"
            onChange={(event) => setFolderPath(event.target.value)}
          />
          <button className="secondaryButton" type="button" onClick={() => void browse()}>
            Browse…
          </button>
        </div>
        {recentChips.length > 0 && (
          <div className="recentChips">
            {recentChips.map((item) => (
              <button
                key={item.project.id}
                type="button"
                className={`chip${folderPath === item.repository?.directoryName ? ' chipActive' : ''}`}
                disabled={item.repository === null}
                onClick={() => setFolderPath(item.repository?.directoryName ?? '')}
              >
                {item.project.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wizardSection">
        <span className="wizardLabel">Agents detected</span>
        <div className="recentChips">
          {BOARD_AGENT_CATALOG.map((entry) => {
            const available =
              entry.id === 'custom' ? true : (availableById.get(entry.id) ?? false);
            return (
              <span
                key={entry.id}
                className={`chip${available ? ' chipActive' : ' chipDim'}`}
              >
                <span
                  className={`agentDot ${available ? 'agentDotOn' : 'agentDotOff'}`}
                />
                {entry.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="wizardSection">
        <span className="wizardLabel">Panes</span>
        <div className="countButtons">
          {PANE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              className={`countBtn${count === paneCount ? ' countBtnActive' : ''}`}
              onClick={() => changePaneCount(count)}
            >
              {count}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Isolation mode">
          <button
            type="button"
            className={`segmentBtn${isolation === 'shared' ? ' segmentBtnActive' : ''}`}
            onClick={() => setIsolation('shared')}
          >
            Shared folder
          </button>
          <button
            type="button"
            className={`segmentBtn${isolation === 'worktree' ? ' segmentBtnActive' : ''}`}
            onClick={() => setIsolation('worktree')}
          >
            Worktree per pane
          </button>
        </div>
      </div>

      <div className="wizardSection">
        <span className="wizardLabel">Pane commands</span>
        <div
          className="slotGrid"
          style={{ gridTemplateColumns: `repeat(${Math.min(paneCount, 3)}, 1fr)` }}
        >
          {Array.from({ length: paneCount }, (_, slot) => {
            const config = slots[slot];
            return (
              <article key={slot} className="slotCard">
                <header>
                  Slot {slot + 1}
                  {slot === 0 && (
                    <button className="iconButton" type="button" onClick={applyToAll}>
                      Apply to all
                    </button>
                  )}
                </header>
                <select
                  className="slotSelect"
                  value={config?.agentId ?? 'claude'}
                  onChange={(event) =>
                    updateSlot(slot, { agentId: event.target.value as BoardAgentId })
                  }
                >
                  {BOARD_AGENT_CATALOG.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                {config?.agentId === 'custom' && (
                  <input
                    type="text"
                    placeholder="command e.g. vitest --watch"
                    value={config.command ?? ''}
                    onChange={(event) =>
                      updateSlot(slot, { command: event.target.value })
                    }
                  />
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="wizardSection">
        <span className="wizardLabel">Presets</span>
        {presets.data?.map((preset) => (
          <div key={preset.id} className="presetRow">
            <span className="presetName">{preset.name}</span>
            <span className="presetMeta">
              {preset.paneCount} panes · {folderName(preset.folderPath)}
            </span>
            <button
              className="secondaryButton"
              type="button"
              onClick={() => loadPreset(preset.id)}
            >
              Load
            </button>
            <button
              className="iconButton"
              type="button"
              disabled={deletePreset.isPending}
              onClick={() => deletePreset.mutate(preset.id)}
            >
              ×
            </button>
          </div>
        ))}
        {(presets.data?.length ?? 0) === 0 && <small>No presets saved yet.</small>}
        <div className="presetRow">
          <input
            className="presetNameInput"
            type="text"
            placeholder="Preset name"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
          />
          <button
            className="secondaryButton"
            type="button"
            disabled={
              savePreset.isPending || presetName.trim().length === 0 || !launchReady
            }
            onClick={() => savePreset.mutate()}
          >
            Save preset
          </button>
        </div>
      </div>

      {error !== null && (
        <p className="wizardError" role="alert">
          {error}
        </p>
      )}

      <button
        className="primaryButton"
        type="button"
        disabled={!launchReady || launch.isPending}
        onClick={launchBoard}
      >
        Launch board
      </button>
    </section>
  );
}

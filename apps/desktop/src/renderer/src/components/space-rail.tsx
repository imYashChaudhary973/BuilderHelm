import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { BoardSessionSummary } from '@builderhelm/protocol/board';
import type { CorrelationId } from '@builderhelm/shared';

import { useBoards } from '../board-store.js';
import { SPACE_COLORS, useSpaces } from '../space-store.js';

function TerminalGlyph(): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="15"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 9.5 11 12 8 14.5M13 15.5h3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function BoardGlyph(): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="4.5"
        y="5.5"
        width="4"
        height="13"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="10"
        y="5.5"
        width="4"
        height="8.5"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="15.5"
        y="5.5"
        width="4"
        height="11"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function MemoryGlyph(): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle
        cx="17"
        cy="7.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="17"
        cy="16.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M9 12h6M15.2 8.8 9 11.3M15.2 15.2 9 12.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SwarmGlyph(): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="6.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="6.5"
        cy="16.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="17.5"
        cy="16.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M10.6 8.1 7.8 14.4M13.4 8.1l2.8 6.3M8.5 16.5h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function SpaceRail({
  collapsed,
}: {
  readonly collapsed: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const featureOpen =
    pathname === '/board' || pathname === '/memory' || pathname === '/swarm';
  const boards = useBoards();
  const boardProjects = useQuery({
    queryKey: ['kanban-projects'],
    queryFn: () => window.builderHelm.board.listProjects({}),
  });
  // A rail entry earns its place by being in use, so these say what each
  // feature is currently doing rather than that it exists.
  const swarmRun = useQuery({
    queryKey: ['rail-swarm-latest'],
    refetchInterval: 5_000,
    queryFn: () =>
      window.builderHelm.swarm.latest({
        correlationId: crypto.randomUUID() as CorrelationId,
      }),
  });
  const vaults = useQuery({
    queryKey: ['rail-memory-vaults'],
    queryFn: () => window.builderHelm.knowledge.listVaults({}),
  });
  const spaces = useSpaces();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  useEffect(() => {
    if (menuId === null) return;
    const close = (): void => {
      if (renamingId !== null) return;
      setMenuId(null);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuId, renamingId]);

  function openSpace(session: BoardSessionSummary): void {
    spaces.activate(session.sessionId);
    void navigate({ to: '/space' });
  }

  const activeBoard =
    (boardProjects.data ?? []).find((project) => project.id === boards.activeId) ?? null;
  const run = swarmRun.data ?? null;
  const liveVault = (vaults.data ?? [])[0] ?? null;
  // A Board or a vault is stored data, not running work, so those rows belong to
  // the open route only. A swarm run and a Space keep working while you look
  // elsewhere, so they stay pinned until they end.
  const showBoard = pathname === '/board';
  const showSwarm = pathname === '/swarm' || (run !== null && run.status === 'running');
  const showMemory = pathname === '/memory';

  return (
    <aside
      className={collapsed ? 'rail railCollapsed' : 'rail'}
      aria-label="BuilderHelm navigation"
    >
      <button
        type="button"
        className={spaces.draft && !featureOpen ? 'railNew railItemOn' : 'railNew'}
        title="New Space"
        onClick={() => {
          spaces.startDraft();
          void navigate({ to: '/space' });
          setMenuId(null);
        }}
      >
        <span className="railNewMark" aria-hidden="true">
          {/* Geometric cross: a text `+` centres its line box, not its ink, so
              asymmetric font ascent and descent left it below the middle. */}
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path
              d="M12 5.5v13M5.5 12h13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </span>
        {collapsed ? null : <span className="railNewCopy">New Space</span>}
      </button>
      <div className="railDivider" role="presentation" />
      <div className="railList">
        {showBoard && (
          <div
            className={pathname === '/board' ? 'railRow railItemOn' : 'railRow'}
            style={{ '--tile': '#b6d475' } as React.CSSProperties}
          >
            <button
              type="button"
              className={collapsed ? 'railTile' : 'railItem'}
              title={activeBoard?.name ?? 'BuilderHelm Board'}
              aria-current={pathname === '/board' ? 'page' : undefined}
              onClick={() => {
                if (activeBoard === null) boards.choose();
                void navigate({ to: '/board' });
              }}
            >
              <BoardGlyph />
              {collapsed ? (
                activeBoard === null ? null : (
                  <span className="railBadge">{activeBoard.taskCount}</span>
                )
              ) : (
                <span className="railCopy">
                  <strong>{activeBoard?.name ?? 'BuilderHelm Board'}</strong>
                  <small>
                    {activeBoard === null
                      ? 'Choosing a project'
                      : `Board · ${activeBoard.taskCount} ${
                          activeBoard.taskCount === 1 ? 'task' : 'tasks'
                        }`}
                  </small>
                </span>
              )}
            </button>
          </div>
        )}
        {showSwarm && (
          <div
            className={pathname === '/swarm' ? 'railRow railItemOn' : 'railRow'}
            style={{ '--tile': '#7ec8e3' } as React.CSSProperties}
          >
            <button
              type="button"
              className={collapsed ? 'railTile' : 'railItem'}
              title={run?.name ?? 'BuilderHelm Swarm'}
              aria-current={pathname === '/swarm' ? 'page' : undefined}
              onClick={() => void navigate({ to: '/swarm' })}
            >
              <SwarmGlyph />
              {collapsed ? null : (
                <span className="railCopy">
                  <strong>{run?.name ?? 'BuilderHelm Swarm'}</strong>
                  <small>
                    {run === null ? 'Planning a mission' : `Swarm · ${run.status}`}
                  </small>
                </span>
              )}
            </button>
          </div>
        )}
        {showMemory && (
          <div
            className={pathname === '/memory' ? 'railRow railItemOn' : 'railRow'}
            style={{ '--tile': '#c9a0ff' } as React.CSSProperties}
          >
            <button
              type="button"
              className={collapsed ? 'railTile' : 'railItem'}
              title={liveVault?.name ?? 'BuilderHelm Memory'}
              aria-current={pathname === '/memory' ? 'page' : undefined}
              onClick={() => void navigate({ to: '/memory' })}
            >
              <MemoryGlyph />
              {collapsed ? (
                liveVault === null ? null : (
                  <span className="railBadge">{liveVault.noteCount}</span>
                )
              ) : (
                <span className="railCopy">
                  <strong>{liveVault?.name ?? 'BuilderHelm Memory'}</strong>
                  <small>
                    {liveVault === null
                      ? 'No vault connected'
                      : `Memory · ${liveVault.noteCount} ${
                          liveVault.noteCount === 1 ? 'note' : 'notes'
                        }`}
                  </small>
                </span>
              )}
            </button>
          </div>
        )}
        {spaces.spaces.map((space) => {
          const on = !featureOpen && !spaces.draft && spaces.activeId === space.sessionId;
          const meta = spaces.meta(space);
          const menuOpen = menuId === space.sessionId;
          const renaming = renamingId === space.sessionId;
          return (
            <div
              key={space.sessionId}
              className={on ? 'railRow railItemOn' : 'railRow'}
              style={{ '--tile': meta.color } as React.CSSProperties}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenuId(space.sessionId);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={collapsed ? 'railTile' : 'railItem'}
                title={meta.label}
                onClick={() => openSpace(space)}
              >
                <TerminalGlyph />
                {collapsed ? (
                  <span className="railBadge">{space.paneCount}</span>
                ) : (
                  <span className="railCopy">
                    <strong>{meta.label}</strong>
                    <small>
                      {space.paneCount} terminal{space.paneCount === 1 ? '' : 's'}
                    </small>
                  </span>
                )}
              </button>
              {menuOpen && (
                <div className="railMenu" role="menu">
                  {renaming ? (
                    <input
                      className="railRename"
                      defaultValue={meta.label}
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onBlur={(event) => {
                        spaces.rename(space, event.currentTarget.value);
                        setRenamingId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button type="button" onClick={() => setRenamingId(space.sessionId)}>
                      Rename
                    </button>
                  )}
                  <div className="railSwatches">
                    {SPACE_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="railSwatch"
                        style={{ background: color }}
                        aria-label={`Color ${color}`}
                        onClick={() => spaces.setColor(space, color)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="railMenuDanger"
                    onClick={() => {
                      void spaces.close(space.sessionId);
                      setMenuId(null);
                    }}
                  >
                    Close workspace
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

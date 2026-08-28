import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { BoardSessionSummary } from '@builderhelm/protocol/board';

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
  return (
    <aside
      className={collapsed ? 'rail railCollapsed' : 'rail'}
      aria-label="BuilderHelm navigation"
    >
      <div
        className={
          pathname === '/board' && boards.activeId === null
            ? 'railRow railItemOn'
            : 'railRow'
        }
        style={{ '--tile': '#b6d475' } as React.CSSProperties}
      >
        <button
          type="button"
          className={collapsed ? 'railTile' : 'railItem'}
          title="BuilderHelm Board"
          aria-current={
            pathname === '/board' && boards.activeId === null ? 'page' : undefined
          }
          onClick={() => {
            boards.choose();
            void navigate({ to: '/board' });
          }}
        >
          <BoardGlyph />
          {collapsed ? null : (
            <span className="railCopy">
              <strong>BuilderHelm Board</strong>
              <small>Choose project</small>
            </span>
          )}
        </button>
      </div>
      <div
        className={pathname === '/memory' ? 'railRow railItemOn' : 'railRow'}
        style={{ '--tile': '#c9a0ff' } as React.CSSProperties}
      >
        <button
          type="button"
          className={collapsed ? 'railTile' : 'railItem'}
          title="BuilderHelm Memory"
          aria-current={pathname === '/memory' ? 'page' : undefined}
          onClick={() => void navigate({ to: '/memory' })}
        >
          <MemoryGlyph />
          {collapsed ? null : (
            <span className="railCopy">
              <strong>BuilderHelm Memory</strong>
              <small>Private recall</small>
            </span>
          )}
        </button>
      </div>
      <div
        className={pathname === '/swarm' ? 'railRow railItemOn' : 'railRow'}
        style={{ '--tile': '#7ec8e3' } as React.CSSProperties}
      >
        <button
          type="button"
          className={collapsed ? 'railTile' : 'railItem'}
          title="BuilderHelm Swarm"
          aria-current={pathname === '/swarm' ? 'page' : undefined}
          onClick={() => void navigate({ to: '/swarm' })}
        >
          <SwarmGlyph />
          {collapsed ? null : (
            <span className="railCopy">
              <strong>BuilderHelm Swarm</strong>
              <small>Many agents, one job</small>
            </span>
          )}
        </button>
      </div>
      <div className="railModeDivider" />
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
        {collapsed ? '+' : '+ New Space'}
      </button>
      <div className="railList">
        {(boardProjects.data ?? []).map((project) => {
          const on = pathname === '/board' && boards.activeId === project.id;
          return (
            <div
              key={project.id}
              className={on ? 'railRow railItemOn' : 'railRow'}
              style={{ '--tile': '#b6d475' } as React.CSSProperties}
            >
              <button
                type="button"
                className={collapsed ? 'railTile' : 'railItem'}
                title={project.name}
                aria-label={`${project.name} Board, ${project.taskCount} ${
                  project.taskCount === 1 ? 'task' : 'tasks'
                }`}
                aria-current={on ? 'page' : undefined}
                onClick={() => {
                  boards.open(project.id);
                  void navigate({ to: '/board' });
                }}
              >
                <BoardGlyph />
                {collapsed ? (
                  <span className="railBadge">{project.taskCount}</span>
                ) : (
                  <span className="railCopy">
                    <strong>{project.name}</strong>
                    <small>
                      Board · {project.taskCount}{' '}
                      {project.taskCount === 1 ? 'task' : 'tasks'}
                    </small>
                  </span>
                )}
              </button>
            </div>
          );
        })}
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

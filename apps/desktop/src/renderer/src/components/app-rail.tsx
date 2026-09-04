import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { BoardSessionSummary } from '@builderhelm/protocol/board';

import { useBoards } from '../board-store.js';
import { SPACE_COLORS, useSpaces } from '../space-store.js';
import {
  AutomationsIcon,
  CreditsIcon,
  GitHubMark,
  LinearMark,
  PluginsIcon,
  SearchIcon,
  SettingsIcon,
  SkillsIcon,
  TasksIcon,
  TerminalGlyph,
  UsageIcon,
} from './rail-icons.js';

/**
 * Rail entries that have a surface behind them, and entries that are chrome
 * for a feature nobody has built. Keeping the split explicit means a nav item
 * cannot quietly imply a product that does not exist: `to` navigates, `stub`
 * routes to a panel that says plainly it is not built.
 */
type NavEntry = {
  readonly id: string;
  readonly label: string;
  readonly icon: React.JSX.Element;
  readonly to: string;
};

export function AppRail({
  collapsed,
}: {
  readonly collapsed: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const spaces = useSpaces();
  const boards = useBoards();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const boardProjects = useQuery({
    queryKey: ['kanban-projects'],
    queryFn: () => window.builderHelm.board.listProjects({}),
  });

  useEffect(() => {
    if (menuId === null && renamingId === null) return undefined;
    function dismiss(): void {
      setMenuId(null);
      setRenamingId(null);
    }
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [menuId, renamingId]);

  const activeBoard =
    (boardProjects.data ?? []).find((project) => project.id === boards.activeId) ?? null;

  const primary: readonly NavEntry[] = [
    { id: 'search', label: 'Search', icon: <SearchIcon />, to: '/search' },
    { id: 'tasks', label: 'Tasks', icon: <TasksIcon />, to: '/board' },
    { id: 'plugins', label: 'Plugins', icon: <PluginsIcon />, to: '/plugins' },
    { id: 'skills', label: 'Skills', icon: <SkillsIcon />, to: '/skills' },
    {
      id: 'automations',
      label: 'Automations',
      icon: <AutomationsIcon />,
      to: '/automations',
    },
  ];

  const footer: readonly NavEntry[] = [
    { id: 'credits', label: 'Credits', icon: <CreditsIcon />, to: '/credits' },
    { id: 'usage', label: 'Usage', icon: <UsageIcon />, to: '/settings/usage' },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon />, to: '/settings/voice' },
  ];

  function openSpace(session: BoardSessionSummary): void {
    spaces.activate(session.sessionId);
    void navigate({ to: '/space' });
  }

  function navRow(entry: NavEntry): React.JSX.Element {
    const on = pathname === entry.to || (entry.to === '/board' && pathname === '/board');
    return (
      <button
        key={entry.id}
        type="button"
        className={on ? 'navRow navRowOn' : 'navRow'}
        title={collapsed ? entry.label : undefined}
        aria-current={on ? 'page' : undefined}
        onClick={() => {
          if (entry.id === 'tasks' && activeBoard === null) boards.choose();
          void navigate({ to: entry.to });
        }}
      >
        <span className="navIcon" aria-hidden="true">
          {entry.icon}
        </span>
        {collapsed ? null : <span className="navLabel">{entry.label}</span>}
        {collapsed ? null : entry.id === 'tasks' ? (
          <span className="navSources" aria-hidden="true">
            <GitHubMark />
            <LinearMark />
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <aside
      className={collapsed ? 'rail railCollapsed' : 'rail'}
      aria-label="BuilderHelm navigation"
    >
      <nav className="navGroup" aria-label="Tools">
        {primary.map(navRow)}
      </nav>

      <div className="railDivider" role="presentation" />

      <div className="railWorkspaces">
        <div className="railSectionHead">
          {collapsed ? null : <span>Workspaces</span>}
          <button
            type="button"
            className="railAdd"
            title="New workspace"
            onClick={() => {
              spaces.startDraft();
              void navigate({ to: '/space' });
              setMenuId(null);
            }}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M12 5.5v13M5.5 12h13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="railList">
          {spaces.spaces.length === 0 && !collapsed ? (
            <p className="railEmpty">No workspaces yet. Open a folder to start one.</p>
          ) : null}
          {spaces.spaces.map((space) => {
            const on =
              pathname === '/space' &&
              !spaces.draft &&
              spaces.activeId === space.sessionId;
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
                      <button
                        type="button"
                        onClick={() => setRenamingId(space.sessionId)}
                      >
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
      </div>

      <nav className="navFooter" aria-label="Account">
        {footer.map(navRow)}
      </nav>
    </aside>
  );
}

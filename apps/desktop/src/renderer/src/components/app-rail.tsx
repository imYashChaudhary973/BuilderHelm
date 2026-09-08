import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { BoardSessionSummary } from '@builderhelm/protocol/board';

import { SPACE_COLORS, useSpaces } from '../space-store.js';
import {
  AccountIcon,
  BackIcon,
  BrowserIcon,
  GeneralIcon,
  TerminalGlyph,
  VoiceIcon,
} from './rail-icons.js';

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
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const settingsOn = pathname.startsWith('/settings');
  const iconOnly = !settingsOn && collapsed;
  useEffect(() => {
    if (menuId === null && renamingId === null) return undefined;
    function dismiss(): void {
      setMenuId(null);
      setRenamingId(null);
    }
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [menuId, renamingId]);

  function openSpace(session: BoardSessionSummary): void {
    spaces.activate(session.sessionId);
    void navigate({ to: '/space' });
  }

  function navRow(entry: NavEntry): React.JSX.Element {
    const on = pathname === entry.to;
    return (
      <button
        key={entry.id}
        type="button"
        className={on ? 'navRow navRowOn' : 'navRow'}
        title={iconOnly ? entry.label : undefined}
        aria-current={on ? 'page' : undefined}
        onClick={() => void navigate({ to: entry.to })}
      >
        <span className="navIcon" aria-hidden="true">
          {entry.icon}
        </span>
        {iconOnly ? null : <span className="navLabel">{entry.label}</span>}
      </button>
    );
  }

  const settingsRows: readonly NavEntry[] = [
    {
      id: 'general',
      label: 'General',
      icon: <GeneralIcon />,
      to: '/settings/general',
    },
    { id: 'voice', label: 'Voice', icon: <VoiceIcon />, to: '/settings/voice' },
    { id: 'browser', label: 'Browser', icon: <BrowserIcon />, to: '/settings/browser' },
    { id: 'account', label: 'Account', icon: <AccountIcon />, to: '/settings/accounts' },
  ];

  if (settingsOn) {
    return (
      <aside className="rail settingsRail" aria-label="Settings">
        <button
          type="button"
          className="settingsNavBack"
          onClick={() => void navigate({ to: '/agents' })}
        >
          <BackIcon />
          Back
        </button>
        <p className="settingsTitle">Settings</p>
        <nav className="navGroup" aria-label="Settings">
          {settingsRows.map(navRow)}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className={
        collapsed ? 'rail railCollapsed railWorkspacesOnly' : 'rail railWorkspacesOnly'
      }
      aria-label="Workspaces"
    >
      <div className="railWorkspaces">
        <div className="railWorkspaceHead">
          {collapsed ? null : <h1>Workspaces</h1>}
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
    </aside>
  );
}

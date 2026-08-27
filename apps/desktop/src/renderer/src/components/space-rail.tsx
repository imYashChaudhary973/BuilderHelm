import { useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { BoardSessionSummary } from '@zero/protocol/board';

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

function PlusGlyph(): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 6.5v11M6.5 12h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M7 7l10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
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
    setMenuId(null);
  }

  return (
    <aside className={collapsed ? 'rail railCollapsed' : 'rail'} aria-label="Spaces">
      <div className="railHead" onClick={(event) => event.stopPropagation()}>
        {collapsed ? null : (
          <p className="railGroup">
            Workspaces <span>{spaces.spaces.length}</span>
          </p>
        )}
        <button
          type="button"
          className="railAdd"
          title="New Space"
          aria-label="New Space"
          onClick={() => {
            spaces.startDraft();
            void navigate({ to: '/' });
            setMenuId(null);
            setRenamingId(null);
          }}
        >
          <PlusGlyph />
        </button>
      </div>
      <div className="railList">
        {spaces.spaces.map((space) => {
          const on =
            (pathname === '/' || pathname === '/space') &&
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
                setRenamingId(null);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={collapsed ? 'railTile' : 'railItem'}
                title={meta.label}
                aria-label={`${meta.label}, ${space.paneCount} terminal${
                  space.paneCount === 1 ? '' : 's'
                }`}
                aria-current={on ? 'page' : undefined}
                onClick={() => openSpace(space)}
              >
                {collapsed ? (
                  <>
                    <TerminalGlyph />
                    <span className="railBadge">{space.paneCount}</span>
                  </>
                ) : (
                  <>
                    <span className="railGlyph">
                      <TerminalGlyph />
                    </span>
                    <span className="railName">{meta.label}</span>
                    <span className="railCount">{space.paneCount}</span>
                  </>
                )}
              </button>
              {collapsed || !on ? null : (
                <button
                  type="button"
                  className="railClose"
                  title="Close workspace"
                  aria-label={`Close ${meta.label}`}
                  onClick={() => void spaces.close(space.sessionId)}
                >
                  <CloseGlyph />
                </button>
              )}
              {menuOpen ? (
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
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

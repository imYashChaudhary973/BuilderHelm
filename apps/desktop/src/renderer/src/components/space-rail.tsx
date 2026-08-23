import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
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
      <path d="M8 9.5 11 12 8 14.5M13 15.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function SpaceRail({ collapsed }: { readonly collapsed: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  const spaces = useSpaces();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  function openSpace(session: BoardSessionSummary): void {
    spaces.activate(session.sessionId);
    void navigate({ to: '/board' });
  }

  return (
    <aside className={collapsed ? 'rail railCollapsed' : 'rail'} aria-label="Spaces">
      <button
        type="button"
        className={spaces.draft ? 'railNew railItemOn' : 'railNew'}
        title="New Space"
        onClick={() => {
          spaces.startDraft();
          void navigate({ to: '/board' });
          setMenuId(null);
        }}
      >
        {collapsed ? '+' : '+ New Space'}
      </button>
      <div className="railList">
        {spaces.spaces.map((space) => {
          const on = !spaces.draft && spaces.activeId === space.sessionId;
          const meta = spaces.meta(space);
          const hovered = menuId === space.sessionId;
          const renaming = renamingId === space.sessionId;
          return (
            <div
              key={space.sessionId}
              className={on ? 'railRow railItemOn' : 'railRow'}
              style={{ '--tile': meta.color } as React.CSSProperties}
              onMouseEnter={() => setMenuId(space.sessionId)}
              onMouseLeave={() => {
                if (renaming) return;
                setMenuId((current) => (current === space.sessionId ? null : current));
              }}
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
              {hovered && (
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

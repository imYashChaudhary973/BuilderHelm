import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { BoardSessionSummary } from '@zero/protocol/board';

import { SPACE_COLORS, useSpaces } from '../space-store.js';

function TerminalIcon({ color }: { readonly color: string }): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true" style={{ color }}>
      <polyline points="4 17 10 11 4 5" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="12" y1="19" x2="20" y2="19" stroke="currentColor" strokeWidth="2" />
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
      <div className="railList">
        {spaces.spaces.map((space) => {
          const on = !spaces.draft && spaces.activeId === space.sessionId;
          const meta = spaces.meta(space);
          const menuOpen = menuId === space.sessionId;
          const renaming = renamingId === space.sessionId;
          return (
            <div key={space.sessionId} className={on ? 'railRow railItemOn' : 'railRow'}>
              <button
                type="button"
                className="railItem"
                title={meta.label}
                onClick={() => openSpace(space)}
              >
                <TerminalIcon color={meta.color} />
                {collapsed ? null : (
                  <span className="railCopy">
                    <strong>{meta.label}</strong>
                    <small>
                      {space.paneCount} terminal{space.paneCount === 1 ? '' : 's'}
                    </small>
                  </span>
                )}
              </button>
              <button
                type="button"
                className="railMore"
                aria-label={`Options for ${meta.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuId((current) => (current === space.sessionId ? null : space.sessionId));
                  setRenamingId(null);
                }}
              >
                ···
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
                        setMenuId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          setRenamingId(null);
                          setMenuId(null);
                        }
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
    </aside>
  );
}

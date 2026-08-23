import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { BrowserSidebar } from './components/browser-sidebar.js';
import { PreviewProvider, usePreview } from './preview-store.js';
import { SpaceProvider, useSpaces } from './space-store.js';

const MODES = [
  { id: 'space', label: 'Space', to: '/board', live: true },
  { id: 'swarm', label: 'Swarm', live: false },
  { id: 'board', label: 'Board', live: false },
  { id: 'memory', label: 'Memory', live: false },
  { id: 'skills', label: 'Skills', live: false },
] as const;

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function Shell(): React.JSX.Element {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const spaces = useSpaces();
  const preview = usePreview();
  const spaceActive = pathname === '/' || pathname === '/board';
  const settingsActive = pathname.startsWith('/settings');

  useEffect(() => {
    if (preview.open) return;
    void window.zero.browser.command({ action: 'hide' }).catch(() => undefined);
  }, [preview.open]);

  return (
    <div className={preview.open ? 'shell shellBrowserOn' : 'shell'}>
      <header className="topbar">
        <div className="brand" aria-label="Exeum">
          Exeum
        </div>
        <nav className="topbarNav" aria-label="Modes">
          {MODES.map((mode) =>
            mode.live ? (
              <Link
                key={mode.id}
                className={spaceActive ? 'topbarItem topbarItemOn' : 'topbarItem'}
                to={mode.to}
              >
                {mode.label}
              </Link>
            ) : (
              <button
                key={mode.id}
                type="button"
                className="topbarItem"
                disabled
                title="Coming later"
              >
                {mode.label}
              </button>
            ),
          )}
        </nav>
        <div className="topbarEnd">
          <span className="privacyBadge">
            <span className="privacyDot" aria-hidden="true" />
            Local
          </span>
          <Link
            className={settingsActive ? 'topbarItem topbarItemOn' : 'topbarItem'}
            to="/settings/providers"
          >
            Settings
          </Link>
          <button
            type="button"
            className={preview.open ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
            title="Preview"
            aria-pressed={preview.open}
            onClick={() => preview.toggle()}
          >
            <PanelIcon />
          </button>
        </div>
      </header>
      <aside className="rail" aria-label="Spaces">
        <div className="railList">
          {spaces.spaces.map((space) => {
            const on = !spaces.draft && spaces.activeId === space.sessionId;
            return (
              <button
                key={space.sessionId}
                type="button"
                className={on ? 'railItem railItemOn' : 'railItem'}
                onClick={() => {
                  spaces.activate(space.sessionId);
                  void navigate({ to: '/board' });
                }}
              >
                <span className="railMark" aria-hidden="true">
                  {folderName(space.folderPath).slice(0, 1).toUpperCase()}
                </span>
                <span className="railCopy">
                  <strong>{folderName(space.folderPath)}</strong>
                  <small>
                    {space.paneCount} terminal{space.paneCount === 1 ? '' : 's'}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={spaces.draft ? 'railNew railItemOn' : 'railNew'}
          onClick={() => {
            spaces.startDraft();
            void navigate({ to: '/board' });
          }}
        >
          + New Space
        </button>
      </aside>
      <main className="content" role="main">
        <Outlet />
      </main>
      {preview.open ? <BrowserSidebar startUrl={preview.url} /> : null}
    </div>
  );
}

function PanelIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="15"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path d="M15 4.5v15" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function App(): React.JSX.Element {
  return (
    <SpaceProvider>
      <PreviewProvider>
        <Shell />
      </PreviewProvider>
    </SpaceProvider>
  );
}

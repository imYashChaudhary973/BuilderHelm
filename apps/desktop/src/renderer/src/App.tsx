import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';

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
  const spaceActive = pathname === '/' || pathname === '/board';
  const settingsActive = pathname.startsWith('/settings');

  return (
    <div className="shell">
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
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <SpaceProvider>
      <Shell />
    </SpaceProvider>
  );
}

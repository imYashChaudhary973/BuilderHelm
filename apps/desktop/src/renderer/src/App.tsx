import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import logo from './assets/logo.png';
import { SidePanel } from './components/side-panel.js';
import { SpaceRail } from './components/space-rail.js';
import { PreviewProvider, usePreview } from './preview-store.js';
import { SpaceProvider } from './space-store.js';
const MODES = [
  { id: 'space', label: 'Space', to: '/board', live: true },
  { id: 'swarm', label: 'Swarm', live: false },
  { id: 'board', label: 'Board', live: false },
  { id: 'memory', label: 'Memory', live: false },
  { id: 'skills', label: 'Skills', live: false },
] as const;

function Shell(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const preview = usePreview();
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem('exeum.rail.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const spaceActive = pathname === '/' || pathname === '/board';
  const settingsActive = pathname.startsWith('/settings');

  useEffect(() => {
    if (preview.open && preview.tab === 'browser') return;
    void window.zero.browser.command({ action: 'hide' }).catch(() => undefined);
  }, [preview.open, preview.tab]);

  function toggleRail(): void {
    setRailCollapsed((current) => {
      const next = !current;
      localStorage.setItem('exeum.rail.collapsed', next ? '1' : '0');
      return next;
    });
  }

  const shellClass = [
    'shell',
    preview.open ? 'shellBrowserOn' : '',
    railCollapsed ? 'shellRailOff' : '',
  ]
    .filter((item) => item.length > 0)
    .join(' ');

  return (
    <div className={shellClass}>
      <header className="topbar">
        <button
          type="button"
          className={railCollapsed ? 'topbarIcon' : 'topbarIcon topbarIconOn'}
          title={railCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={!railCollapsed}
          onClick={toggleRail}
        >
          <RailIcon />
        </button>
        <div className="brand">
          <img className="brandLogo" src={logo} width={22} height={22} alt="" />
          BuilderHelm
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
            title="Tools"
            aria-pressed={preview.open}
            onClick={() => preview.toggle()}
          >
            <PanelIcon />
          </button>
        </div>
      </header>
      <SpaceRail collapsed={railCollapsed} />
      <main className="content" role="main">
        <Outlet />
      </main>
      {preview.open ? <SidePanel /> : null}
    </div>
  );
}

function RailIcon(): React.JSX.Element {
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
      <path d="M9 4.5v15" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
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

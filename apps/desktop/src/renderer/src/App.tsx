import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { BoardProvider } from './board-store.js';
import logo from './assets/logo.png';
import { SidePanel } from './components/side-panel.js';
import { SpaceRail } from './components/space-rail.js';
import { SettingsNav } from './routes/settings/nav.js';
import { PreviewProvider, usePreview } from './preview-store.js';
import { SpaceProvider } from './space-store.js';

function Shell(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const preview = usePreview();
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('exeum.rail.collapsed');
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });
  const settingsActive = pathname.startsWith('/settings');
  const navigate = useNavigate();

  // Escape leaves Settings, mirroring the visible back control. The router has
  // nowhere back when a deep link opened the app, so it goes home instead.
  useEffect(() => {
    if (!settingsActive) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsActive, navigate]);

  useEffect(() => {
    if (preview.open && preview.tab === 'browser') return;
    void window.builderHelm?.browser.command({ action: 'hide' }).catch(() => undefined);
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
    pathname.startsWith('/settings') ? 'shellSettingsOn' : '',
    preview.open ? 'shellBrowserOn' : '',
    railCollapsed ? 'shellRailOff' : '',
  ]
    .filter((item) => item.length > 0)
    .join(' ');

  if (typeof window.builderHelm === 'undefined') {
    return (
      <main className="content" role="main">
        <p className="errorBanner" role="alert">
          Open BuilderHelm from the desktop app.
        </p>
      </main>
    );
  }

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
          <span className="buildStamp" title="Branch and commit this build came from">
            {__BUILD_STAMP__}
          </span>
        </div>
        <div className="topbarEnd">
          <button
            type="button"
            className={settingsActive ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
            title={settingsActive ? 'Leave settings (Esc)' : 'Settings'}
            aria-pressed={settingsActive}
            onClick={() =>
              void navigate({ to: settingsActive ? '/' : '/settings/voice' })
            }
          >
            <GearIcon />
          </button>
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
      {pathname.startsWith('/settings') ? (
        <SettingsNav active={pathname} />
      ) : (
        <SpaceRail collapsed={railCollapsed} />
      )}
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

function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function App(): React.JSX.Element {
  return (
    <BoardProvider>
      <SpaceProvider>
        <PreviewProvider>
          <Shell />
        </PreviewProvider>
      </SpaceProvider>
    </BoardProvider>
  );
}

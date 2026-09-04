import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { AuthState } from '@builderhelm/protocol/auth';

import { BoardProvider } from './board-store.js';
import logo from './assets/logo.png';
import { SidePanel } from './components/side-panel.js';
import { AppRail } from './components/app-rail.js';
import { BellIcon } from './components/rail-icons.js';
import { UsageBar } from './components/usage-bar.js';
import { SplashScreen, splashEnabled } from './components/splash-screen.js';
import { LoginScreen } from './components/login-screen.js';
import { DictationHud } from './components/dictation-hud.js';
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
    settingsActive ? 'shellSettingsOn' : '',
    preview.open ? 'shellBrowserOn' : '',
    !settingsActive && railCollapsed ? 'shellRailOff' : '',
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
        <div className="topbarStart">
          <div className="brand">
            <img className="brandLogo" src={logo} width={22} height={22} alt="" />
            BuilderHelm
          </div>
          <button
            type="button"
            className={railCollapsed ? 'topbarIcon' : 'topbarIcon topbarIconOn'}
            title={railCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={!railCollapsed}
            onClick={toggleRail}
          >
            <RailIcon />
          </button>
        </div>

        <ModeTabs />

        <div className="topbarEnd">
          <span className="buildStamp" title="Branch and commit this build came from">
            {__BUILD_STAMP__}
          </span>
          <button
            type="button"
            className={preview.open ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
            title="Tools"
            aria-pressed={preview.open}
            onClick={() => preview.toggle()}
          >
            <PanelIcon />
          </button>
          <button type="button" className="topbarIcon" title="Notifications">
            <BellIcon />
          </button>
        </div>
      </header>
      {/* The rail is the app's spine and never swaps out: Plugins, Skills and
          Credits stay reachable while Settings is open. Settings keeps its own
          section list, nested one level in rather than taking the rail slot. */}
      <AppRail collapsed={railCollapsed} />
      <main className="content" role="main">
        {settingsActive ? (
          <div className="settingsLayout">
            <SettingsNav active={pathname} />
            <div className="settingsBody">
              <Outlet />
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      {preview.open ? <SidePanel /> : null}
      <UsageBar />
      <DictationHud />
    </div>
  );
}

/**
 * The three ways to work. Each maps to a surface that exists: Agents is the
 * installed-agent grid, Code is the terminal/editor/Git workspace, Chat is the
 * model conversation. Settings replaces the rail rather than a fourth mode, so
 * the tabs stay a statement about work, not navigation chrome.
 */
const MODES: readonly { readonly label: string; readonly to: string }[] = [
  { label: 'Agents', to: '/agents' },
  { label: 'Code', to: '/space' },
  { label: 'Chat', to: '/chat' },
];

function ModeTabs(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  return (
    <div className="modeTabs" role="tablist" aria-label="Mode">
      {MODES.map((mode) => {
        const on = pathname === mode.to;
        return (
          <button
            key={mode.to}
            type="button"
            role="tab"
            aria-selected={on}
            className={on ? 'modeTab modeTabOn' : 'modeTab'}
            onClick={() => void navigate({ to: mode.to })}
          >
            {mode.label}
          </button>
        );
      })}
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
  // Launch-only: App mounts once per window, so the storm never returns on a
  // route change.
  const [splashDone, setSplashDone] = useState(() => !splashEnabled());
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    if (typeof window.builderHelm === 'undefined') return undefined;
    void window.builderHelm.auth.read().then(setAuth);
    return window.builderHelm.auth.onChange(setAuth);
  }, []);

  if (typeof window.builderHelm === 'undefined') {
    return (
      <main className="content" role="main">
        <p className="errorBanner" role="alert">
          Open BuilderHelm from the desktop app.
        </p>
      </main>
    );
  }

  const locked = auth === null || auth.status !== 'signed-in';

  return (
    <BoardProvider>
      <SpaceProvider>
        <PreviewProvider>
          {locked ? <LoginScreen state={auth} /> : <Shell />}
          {splashDone ? null : <SplashScreen onDone={() => setSplashDone(true)} />}
        </PreviewProvider>
      </SpaceProvider>
    </BoardProvider>
  );
}

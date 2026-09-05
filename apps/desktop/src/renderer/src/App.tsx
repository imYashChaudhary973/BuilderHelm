import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { AuthState } from '@builderhelm/protocol/auth';

import { BoardProvider } from './board-store.js';
import logo from './assets/logo.png';
import { SidePanel } from './components/side-panel.js';
import { AppRail } from './components/app-rail.js';
import { Launcher } from './components/launcher.js';
import {
  BellIcon,
  RailToggleIcon,
  SearchIcon,
  ToolsIcon,
} from './components/rail-icons.js';
import { SplashScreen, splashEnabled } from './components/splash-screen.js';
import { LoginScreen } from './components/login-screen.js';
import { DictationHud } from './components/dictation-hud.js';
import { NoSleep } from './components/no-sleep.js';
import { PreviewProvider, usePreview } from './preview-store.js';
import { SpaceProvider } from './space-store.js';

function Shell(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const preview = usePreview();
  const [launcherOpen, setLauncherOpen] = useState(false);
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
    if (!settingsActive || launcherOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsActive, launcherOpen, navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setLauncherOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (launcherOpen) {
      void window.builderHelm?.browser.command({ action: 'hide' }).catch(() => undefined);
      return;
    }
    if (preview.open && preview.tab === 'browser') {
      void window.builderHelm?.browser
        .command({ action: 'visible', visible: true })
        .catch(() => undefined);
      return;
    }
    void window.builderHelm?.browser.command({ action: 'hide' }).catch(() => undefined);
  }, [preview.open, preview.tab, launcherOpen]);

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
        <div className="topbarRail">
          <div className="brand">
            <img className="brandLogo" src={logo} width={24} height={24} alt="" />
            BuilderHelm
          </div>
        </div>
        <button
          type="button"
          className={
            railCollapsed ? 'topbarIcon railToggle' : 'topbarIcon topbarIconOn railToggle'
          }
          title={railCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={!railCollapsed}
          onClick={toggleRail}
        >
          <RailToggleIcon />
        </button>
        <ModeTabs />
        <div className="topbarMain">
          <div className="topbarEnd">
            <span className="buildStamp" title="Branch and commit this build came from">
              {__BUILD_STAMP__}
            </span>
            <button
              type="button"
              className={launcherOpen ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
              title="Search (⌘K)"
              aria-pressed={launcherOpen}
              onClick={() => setLauncherOpen(true)}
            >
              <SearchIcon />
            </button>
            <button
              type="button"
              className={preview.open ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
              title="Tools"
              aria-pressed={preview.open}
              onClick={() => preview.toggle()}
            >
              <ToolsIcon />
            </button>
            <button type="button" className="topbarIcon" title="Notifications">
              <BellIcon />
            </button>
            <NoSleep />
          </div>
        </div>
      </header>
      <AppRail collapsed={railCollapsed} onSearch={() => setLauncherOpen(true)} />
      <main className="content" role="main">
        <Outlet />
      </main>
      {preview.open ? <SidePanel /> : null}
      <Launcher open={launcherOpen} onClose={() => setLauncherOpen(false)} />
      <DictationHud />
    </div>
  );
}

/**
 * The three ways to work. Code covers Space, Board, and Swarm. Chats is the
 * ACP host. Agents is the installed-CLI grid. Settings is not a mode.
 */
const MODES: readonly {
  readonly label: string;
  readonly to: string;
  readonly match: (pathname: string) => boolean;
}[] = [
  { label: 'Agents', to: '/agents', match: (path) => path.startsWith('/agents') },
  {
    label: 'Code',
    to: '/space',
    match: (path) =>
      path.startsWith('/space') || path.startsWith('/board') || path.startsWith('/swarm'),
  },
  { label: 'Chats', to: '/chat', match: (path) => path.startsWith('/chat') },
];

function ModeTabs(): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  return (
    <div className="modeTabs" role="tablist" aria-label="Mode">
      {MODES.map((mode) => {
        const on = mode.match(pathname);
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

import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { AuthState } from '@builderhelm/protocol/auth';

import { BoardProvider } from './board-store.js';
import logo from './assets/logo.png';
import { SidePanel } from './components/side-panel.js';
import { AppRail } from './components/app-rail.js';
import { Launcher } from './components/launcher.js';
import {
  AgentsModeIcon,
  BellIcon,
  ChatsModeIcon,
  CodeModeIcon,
  SettingsIcon,
  ToolsIcon,
} from './components/rail-icons.js';
import { SplashScreen, splashEnabled } from './components/splash-screen.js';
import { LoginScreen } from './components/login-screen.js';
import { NoSleep } from './components/no-sleep.js';
import { DictationHud } from './components/dictation-hud.js';
import { PreviewProvider, usePreview } from './preview-store.js';
import { SpaceProvider } from './space-store.js';

const LOCAL_DEVELOPMENT = import.meta.env.DEV && __LOCAL_DEVELOPMENT__;

function Shell({
  localDevelopment,
  onExitLocal,
}: {
  readonly localDevelopment: boolean;
  readonly onExitLocal: () => void;
}): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const preview = usePreview();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const settingsActive = pathname.startsWith('/settings');
  const ownSidebar = pathname.startsWith('/agents') || pathname.startsWith('/chat');
  const codeChrome = !ownSidebar && !settingsActive;
  const navigate = useNavigate();

  // Escape leaves Settings, mirroring the visible back control.
  useEffect(() => {
    if (!settingsActive || launcherOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void navigate({ to: '/agents' });
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

  const shellClass = [
    'shell',
    preview.open ? 'shellBrowserOn' : '',
    settingsActive ? 'shellSettingsOn' : '',
    ownSidebar ? 'shellSolo' : '',
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
        <div className="brand">
          <img className="brandLogo" src={logo} width={24} height={24} alt="" />
          BuilderHelm
        </div>
        <ModeTabs />
        <div className="topbarEnd">
          {localDevelopment ? (
            <button
              type="button"
              className="localDevelopmentExit"
              title="Return to sign-in"
              aria-label="Local development, signed out. Return to sign-in"
              onClick={onExitLocal}
            >
              Local · signed out
            </button>
          ) : null}
          {codeChrome ? (
            <button
              type="button"
              className={preview.open ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
              title="Tools"
              aria-pressed={preview.open}
              onClick={() => preview.toggle()}
            >
              <ToolsIcon />
            </button>
          ) : null}
          <NoSleep />
          <button type="button" className="topbarIcon" title="Notifications">
            <BellIcon />
          </button>
          <button
            type="button"
            className={settingsActive ? 'topbarIcon topbarIconOn' : 'topbarIcon'}
            title="Settings"
            aria-pressed={settingsActive}
            onClick={() => void navigate({ to: '/settings/general' })}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>
      {ownSidebar ? null : <AppRail collapsed={false} />}
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
  readonly Icon: () => React.JSX.Element;
  readonly match: (pathname: string) => boolean;
}[] = [
  {
    label: 'Agents',
    to: '/agents',
    Icon: AgentsModeIcon,
    match: (path) => path.startsWith('/agents'),
  },
  {
    label: 'Code',
    to: '/space',
    Icon: CodeModeIcon,
    match: (path) =>
      path.startsWith('/space') || path.startsWith('/board') || path.startsWith('/swarm'),
  },
  {
    label: 'Chats',
    to: '/chat',
    Icon: ChatsModeIcon,
    match: (path) => path.startsWith('/chat'),
  },
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
            <mode.Icon />
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
  const [localChosen, setLocalChosen] = useState(LOCAL_DEVELOPMENT);
  const [localOpening, setLocalOpening] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window.builderHelm === 'undefined') return undefined;
    const receiveAuth = (next: AuthState): void => {
      setAuth(next);
      if (next.status === 'signed-in') setLocalChosen(false);
    };
    void window.builderHelm.auth.read().then(receiveAuth);
    return window.builderHelm.auth.onChange(receiveAuth);
  }, []);

  const continueLocally = async (): Promise<void> => {
    if (!LOCAL_DEVELOPMENT || localOpening) return;
    setLocalOpening(true);
    setLocalError(null);
    try {
      // Close an outstanding browser handoff without altering credentials.
      const next = await window.builderHelm.auth.cancel();
      setAuth(next);
      setLocalChosen(next.status !== 'signed-in');
    } catch {
      setLocalError('Could not close the sign-in attempt. Try again.');
    } finally {
      setLocalOpening(false);
    }
  };

  if (typeof window.builderHelm === 'undefined') {
    return (
      <main className="content" role="main">
        <p className="errorBanner" role="alert">
          Open BuilderHelm from the desktop app.
        </p>
      </main>
    );
  }

  const localDevelopment =
    LOCAL_DEVELOPMENT && localChosen && auth?.status !== 'signed-in';
  const locked = auth === null || (auth.status !== 'signed-in' && !localDevelopment);

  return (
    <BoardProvider>
      <SpaceProvider>
        <PreviewProvider>
          {locked ? (
            <LoginScreen
              state={auth}
              onContinueLocal={
                LOCAL_DEVELOPMENT ? () => void continueLocally() : undefined
              }
              localOpening={localOpening}
              localError={localError}
            />
          ) : (
            <Shell
              localDevelopment={localDevelopment}
              onExitLocal={() => setLocalChosen(false)}
            />
          )}
          {splashDone ? null : <SplashScreen onDone={() => setSplashDone(true)} />}
        </PreviewProvider>
      </SpaceProvider>
    </BoardProvider>
  );
}

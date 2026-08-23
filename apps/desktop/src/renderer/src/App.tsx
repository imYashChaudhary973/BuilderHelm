import { Link, Outlet } from '@tanstack/react-router';

import { Aurora } from './components/fx.js';

const futureSections = [
  'Code',
  'Research',
  'Health',
  'Content',
  'Automations',
  'Activity',
];

const nav = [
  { label: 'Projects', to: '/projects', icon: LayersIcon },
  { label: 'Today', to: '/', icon: SunIcon },
  { label: 'Knowledge', to: '/knowledge', icon: BookIcon },
  { label: 'Chat', to: '/chat', icon: ChatIcon },
  { label: 'Actions', to: '/actions', icon: ZapIcon },
];

function LayersIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function SunIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function BookIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function ChatIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ZapIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.21l-.19.1a2 2 0 0 1-2.19-.37l-.29-.29a2 2 0 0 0-2.83 0l-.42.42a2 2 0 0 0 0 2.83l.29.29a2 2 0 0 1 .37 2.19l-.1.19a2 2 0 0 1-1.21 1h-.18A2 2 0 0 0 2 12.22v.44a2 2 0 0 0 2 2h.18a2 2 0 0 1 1.21 1l.1.19a2 2 0 0 1-.37 2.19l-.29.29a2 2 0 0 0 0 2.83l.42.42a2 2 0 0 0 2.83 0l.29-.29a2 2 0 0 1 2.19-.37l.19.1a2 2 0 0 1 1 1.21v.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.21l.19-.1a2 2 0 0 1 2.19.37l.29.29a2 2 0 0 0 2.83 0l.42-.42a2 2 0 0 0 0-2.83l-.29-.29a2 2 0 0 1-.37-2.19l.1-.19a2 2 0 0 1 1.21-1h.18a2 2 0 0 0 2-2v-.44a2 2 0 0 0-2-2h-.18a2 2 0 0 1-1.21-1l-.1-.19a2 2 0 0 1 .37-2.19l.29-.29a2 2 0 0 0 0-2.83l-.42-.42a2 2 0 0 0-2.83 0l-.29.29a2 2 0 0 1-2.19.37l-.19-.1a2 2 0 0 1-1-1.21V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function App(): React.JSX.Element {
  return (
    <div className="shell">
      <Aurora />
      <aside className="sidebar">
        <div className="brand" aria-label="Zero OS">
          <span className="brandMark">0</span>
          <span>Zero</span>
        </div>
        <nav aria-label="Primary navigation">
          {nav.map((item) => (
            <Link
              className="navItem"
              activeProps={{ className: 'navItem navItemActive' }}
              {...(item.to === '/' ? { activeOptions: { exact: true } } : {})}
              to={item.to}
              key={item.to}
            >
              <item.icon />
              <span>{item.label}</span>
            </Link>
          ))}
          {futureSections.map((section) => (
            <button className="navItem" type="button" disabled key={section}>
              <LayersIcon />
              <span>{section}</span>
            </button>
          ))}
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/settings/providers"
          >
            <SettingsIcon />
            <span>Settings</span>
          </Link>
        </nav>
        <div className="privacyBadge">
          <span className="privacyDot" aria-hidden="true" />
          Keychain protected
        </div>
      </aside>
      <main className="content" role="main">
        <Outlet />
      </main>
    </div>
  );
}

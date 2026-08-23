import { Link, Outlet } from '@tanstack/react-router';

const nav = [
  { label: 'Board', to: '/board', icon: TerminalIcon },
  { label: 'Settings', to: '/settings/providers', icon: SettingsIcon },
];

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
      <aside className="sidebar">
        <div className="brand" aria-label="Exeum">
          Exeum
        </div>
        <nav aria-label="Primary navigation">
          {nav.map((item) => (
            <Link
              className="navItem"
              activeProps={{ className: 'navItem navItemActive' }}
              to={item.to}
              key={item.to}
            >
              <item.icon />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="privacyBadge">
          <span className="privacyDot" aria-hidden="true" />
          Local
        </div>
      </aside>
      <main className="content" role="main">
        <Outlet />
      </main>
    </div>
  );
}

function TerminalIcon(): React.JSX.Element {
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

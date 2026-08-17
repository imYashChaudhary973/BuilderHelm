import { Link, Outlet } from '@tanstack/react-router';

const futureSections = [
  'Code',
  'Research',
  'Health',
  'Content',
  'Automations',
  'Activity',
];

export function App(): React.JSX.Element {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" aria-label="Zero OS">
          <span className="brandMark">0</span>
          <span>Zero</span>
        </div>
        <nav aria-label="Primary navigation">
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/projects"
          >
            Projects
          </Link>
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/"
          >
            Today
          </Link>
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/knowledge"
          >
            Knowledge
          </Link>
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/chat"
          >
            Chat
          </Link>
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/actions"
          >
            Actions
          </Link>
          {futureSections.map((section) => (
            <button className="navItem" type="button" disabled key={section}>
              {section}
            </button>
          ))}
          <Link
            className="navItem"
            activeProps={{ className: 'navItem navItemActive' }}
            to="/settings/providers"
          >
            Settings
          </Link>
        </nav>
        <div className="privacyBadge">
          <span className="privacyDot" aria-hidden="true" />
          Keychain protected
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

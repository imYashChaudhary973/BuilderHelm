'use client';

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';

const SECTIONS = [
  {
    to: '/settings/voice',
    title: 'Voice',
    active: (path: string) => path === '/settings/voice',
  },
  {
    to: '/settings/browser',
    title: 'Browser',
    active: (path: string) => path === '/settings/browser',
  },
  {
    to: '/settings/accounts',
    title: 'Account',
    active: (path: string) => path === '/settings/accounts',
  },
] as const;

/**
 * Settings has its own sidebar. The feature rail shows what is running; this
 * one only navigates the settings sections, so it is a different component on
 * a different grid column — never the feature rail dressed up.
 */
export function SettingsNav({ active }: { readonly active: string }): React.JSX.Element {
  const path = useRouterState({ select: (s) => s.location.pathname }) || active;
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <nav className="settingsNav" aria-label="Settings sections">
      <button
        type="button"
        className="settingsNavBack"
        title="Back to app (Esc)"
        onClick={() => void navigate({ to: '/' })}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M15 5 8 12l7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to app
      </button>
      <div className="settingsNavDivider" role="presentation" />
      <div className="settingsSearch">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle
            cx="10.5"
            cy="10.5"
            r="6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <line
            x1="15.5"
            y1="15.5"
            x2="20"
            y2="20"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search settings"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <kbd className="settingsSearchKey">⌘</kbd>
        <kbd className="settingsSearchKey">F</kbd>
      </div>
      <div className="settingsNavDivider" role="presentation" />
      {SECTIONS.filter((section) =>
        section.title.toLowerCase().includes(filter.toLowerCase()),
      ).map((section) => {
        const on = section.active(path);
        return (
          <Link
            key={section.to}
            className={on ? 'settingsNavLink settingsNavLinkOn' : 'settingsNavLink'}
            to={section.to}
            aria-current={on ? 'page' : undefined}
          >
            <strong>{section.title}</strong>
          </Link>
        );
      })}
    </nav>
  );
}

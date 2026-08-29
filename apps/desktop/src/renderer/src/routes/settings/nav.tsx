'use client';

import { Link, useNavigate, useRouterState } from '@tanstack/react-router';

const SECTIONS = [
  {
    to: '/settings/voice',
    title: 'Voice',
    active: (path: string) => path === '/settings/voice',
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
  return (
    <nav className="settingsNav" aria-label="Settings sections">
      <button
        type="button"
        className="settingsNavBack"
        title="Back (Esc)"
        onClick={() => void navigate({ to: '/' })}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M14.5 5.5 8 12l6.5 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back
      </button>
      <p className="settingsNavLabel">Settings</p>
      {SECTIONS.map((section) => {
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

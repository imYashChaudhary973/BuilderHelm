'use client';

import { Link, useRouterState } from '@tanstack/react-router';

const SECTIONS = [
  {
    to: '/settings/providers',
    title: 'Models & Providers',
    active: (path: string) => path === '/settings/providers',
  },
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
  return (
    <nav className="settingsNav" aria-label="Settings sections">
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

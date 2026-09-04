/**
 * Rail and topbar glyphs. One family, one geometry: 24-unit box, 1.7 stroke,
 * round caps, currentColor. Mixed icon styles are the fastest way to make a
 * product UI feel assembled rather than designed, so nothing here deviates.
 */

function Icon({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SearchIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l4.5 4.5" />
    </Icon>
  );
}

export function TasksIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <path d="M8 10.5l2 2 3.5-4" />
      <path d="M8 16.5h8" />
    </Icon>
  );
}

export function PluginsIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M9 3.5v4M15 3.5v4" />
      <rect x="6" y="7.5" width="12" height="7" rx="2.5" />
      <path d="M12 14.5v6" />
    </Icon>
  );
}

export function SkillsIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.05 5.8L12 16.9l-5.25 2.7L7.8 13.8 3.5 9.7l5.9-.8z" />
    </Icon>
  );
}

export function AutomationsIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="4" y="8.5" width="16" height="11" rx="3" />
      <path d="M12 4v4.5" />
      <circle cx="9" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CreditsIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M6.5 14.5h3" />
    </Icon>
  );
}

export function UsageIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M5 19.5v-6M12 19.5V6M19 19.5v-9" />
    </Icon>
  );
}

export function SettingsIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1" />
    </Icon>
  );
}

export function BellIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.2.8 5 1.6 6H4.9c.8-1 1.6-2.8 1.6-6z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

/** Matches the workspace rows in the rail, which are terminal-backed. */
export function TerminalGlyph(): React.JSX.Element {
  return (
    <svg className="railTerm" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="2.5"
        y="4.5"
        width="19"
        height="15"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7 10.5l2.4 2.4L7 15.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.6 15.4h4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Task sources. Brand marks, so these are filled paths at their own geometry
 * rather than members of the stroke family above.
 */
export function GitHubMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export function LinearMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.2 9.5a6.8 6.8 0 0 0 5.3 5.3L1.2 9.5zM1.03 7.7 8.3 14.97a6.8 6.8 0 0 0 1.66-.36L1.39 6.04a6.8 6.8 0 0 0-.36 1.66zM2.1 4.6l9.3 9.3a6.9 6.9 0 0 0 1.15-.9L3 3.45a6.9 6.9 0 0 0-.9 1.15zM4.35 2.36 13.64 11.65a6.8 6.8 0 1 0-9.29-9.29z"
      />
    </svg>
  );
}

/**
 * Toolbar glyphs. Inline SVG on `currentColor` so hover, disabled, and active
 * states come from the button's own colour, and no icon package ships with the
 * app. Every icon is decorative: the accessible name lives on the button.
 */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Glyph({
  children,
  size = 16,
}: {
  readonly children: React.ReactNode;
  readonly size?: number;
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconBack(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M14 6 8 12l6 6" {...STROKE} />
    </Glyph>
  );
}

export function IconForward(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M10 6l6 6-6 6" {...STROKE} />
    </Glyph>
  );
}

export function IconReload(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M19 12a7 7 0 1 1-2.05-4.95" {...STROKE} />
      <path d="M19 4v4h-4" {...STROKE} />
    </Glyph>
  );
}

export function IconLock(): React.JSX.Element {
  return (
    <Glyph size={14}>
      <rect x="5" y="10.5" width="14" height="9" rx="2" {...STROKE} />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" {...STROKE} />
    </Glyph>
  );
}

export function IconWeb(): React.JSX.Element {
  return (
    <Glyph size={14}>
      <circle cx="12" cy="12" r="8" {...STROKE} />
      <path
        d="M4 12h16M12 4c2.2 2.3 2.2 13.7 0 16M12 4c-2.2 2.3-2.2 13.7 0 16"
        {...STROKE}
      />
    </Glyph>
  );
}

export function IconImport(): React.JSX.Element {
  return (
    <Glyph size={14}>
      <path d="M12 4v8m0 0 3-3m-3 3-3-3" {...STROKE} />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" {...STROKE} />
    </Glyph>
  );
}

/** Crosshair over a target: pick one element out of the page. */
export function IconGrab(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="5.5" {...STROKE} />
      <path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21" {...STROKE} />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </Glyph>
  );
}

/** Speech bubble with a plus: attach a note to an element. */
export function IconAnnotate(): React.JSX.Element {
  return (
    <Glyph>
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H13l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"
        {...STROKE}
      />
      <path d="M12 8v4M10 10h4" {...STROKE} />
    </Glyph>
  );
}

/** Pen over a frame: mark up the captured screenshot, not the live page. */
export function IconDraw(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 16.5V20h3.5L18 9.5 14.5 6z" {...STROKE} />
      <path d="M13 7.5 16.5 11" {...STROKE} />
      <path d="M15.5 4.5 17 3l4 4-1.5 1.5z" {...STROKE} />
    </Glyph>
  );
}

/** Angle brackets in a frame: the page's own devtools. */
export function IconDevtools(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...STROKE} />
      <path d="M10 9.5 7.5 12l2.5 2.5M14 9.5 16.5 12 14 14.5" {...STROKE} />
    </Glyph>
  );
}

export function IconExternal(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M14 5h5v5" {...STROKE} />
      <path d="M19 5l-7 7" {...STROKE} />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" {...STROKE} />
    </Glyph>
  );
}

export function IconOverflow(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" />
    </Glyph>
  );
}

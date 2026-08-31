/**
 * Toolbar glyphs, drawn to the reference chrome: thin round strokes on a 24px
 * box, `currentColor` so hover, disabled, and active states come from the
 * button, and no icon package in the bundle. Every icon is decorative — the
 * accessible name lives on the button.
 */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Glyph({
  children,
  size = 20,
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
      <path d="M20 12H4.5" {...STROKE} />
      <path d="M10.5 5.5 4 12l6.5 6.5" {...STROKE} />
    </Glyph>
  );
}

export function IconForward(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 12h15.5" {...STROKE} />
      <path d="M13.5 5.5 20 12l-6.5 6.5" {...STROKE} />
    </Glyph>
  );
}

/** Two-headed circular arrow, matching the reference reload glyph. */
export function IconReload(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M20 11.2a8 8 0 0 0-13.4-4.3L4 9.4" {...STROKE} />
      <path d="M4 4.6v4.8h4.8" {...STROKE} />
      <path d="M4 12.8a8 8 0 0 0 13.4 4.3L20 14.6" {...STROKE} />
      <path d="M20 19.4v-4.8h-4.8" {...STROKE} />
    </Glyph>
  );
}

export function IconLock(): React.JSX.Element {
  return (
    <Glyph size={17}>
      <rect x="5" y="10.5" width="14" height="9" rx="2.4" {...STROKE} />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" {...STROKE} />
    </Glyph>
  );
}

/** Meridian globe: the reference security affordance for a plain http page. */
export function IconWeb(): React.JSX.Element {
  return (
    <Glyph size={17}>
      <circle cx="12" cy="12" r="8.4" {...STROKE} />
      <path d="M3.6 12h16.8" {...STROKE} />
      <path d="M12 3.6c2.6 2.4 2.6 14.4 0 16.8" {...STROKE} />
      <path d="M12 3.6c-2.6 2.4-2.6 14.4 0 16.8" {...STROKE} />
    </Glyph>
  );
}

export function IconImport(): React.JSX.Element {
  return (
    <Glyph size={17}>
      <path d="M12 3.8v8.4" {...STROKE} />
      <path d="m8.8 9 3.2 3.2L15.2 9" {...STROKE} />
      <path
        d="M5 14.6v3.2a2.4 2.4 0 0 0 2.4 2.4h9.2a2.4 2.4 0 0 0 2.4-2.4v-3.2"
        {...STROKE}
      />
    </Glyph>
  );
}

/** Target ring with four notches: pick one element out of the page. */
export function IconGrab(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8.2" {...STROKE} />
      <path d="M12 3.8v3.4M12 16.8v3.4M3.8 12h3.4M16.8 12h3.4" {...STROKE} />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </Glyph>
  );
}

/** Rounded bubble with a plus: attach a note to an element. */
export function IconAnnotate(): React.JSX.Element {
  return (
    <Glyph>
      <path
        d="M4.6 7.2A2.6 2.6 0 0 1 7.2 4.6h9.6a2.6 2.6 0 0 1 2.6 2.6v6.6a2.6 2.6 0 0 1-2.6 2.6H13l-3.6 3.2v-3.2H7.2a2.6 2.6 0 0 1-2.6-2.6z"
        {...STROKE}
      />
      <path d="M12 8.4v4M10 10.4h4" {...STROKE} />
    </Glyph>
  );
}

/** Marker nib with its stroke: mark up the capture, not the live page. */
export function IconDraw(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M17.6 3.9a2.3 2.3 0 0 1 3.2 3.2l-8.7 8.7-4.2 1 1-4.2z" {...STROKE} />
      <path d="M4 20.4c1.6.4 3.2.2 4.4-.8" {...STROKE} />
    </Glyph>
  );
}

/** Angle brackets in a rounded square: the page's own devtools. */
export function IconDevtools(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="3.2" {...STROKE} />
      <path d="M10.2 9.4 7.6 12l2.6 2.6M13.8 9.4 16.4 12l-2.6 2.6" {...STROKE} />
    </Glyph>
  );
}

export function IconExternal(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M14.4 4.4h5.2v5.2" {...STROKE} />
      <path d="M19.6 4.4 12 12" {...STROKE} />
      <path
        d="M18 14v3.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 17.6V8.4A2.4 2.4 0 0 1 6.4 6H10"
        {...STROKE}
      />
    </Glyph>
  );
}

export function IconOverflow(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="5.6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18.4" cy="12" r="1.6" fill="currentColor" />
    </Glyph>
  );
}

/* ---------- MARKUP TOOLS ---------- */

export function IconPen(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M16.8 3.6a2.2 2.2 0 0 1 3.6 2.4L9.6 16.8l-4.4 1.6 1.6-4.4z" {...STROKE} />
    </Glyph>
  );
}

export function IconHighlighter(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M8.4 15.6 4.8 19.2h5.6l9.6-9.6-3.6-3.6-8 8z" {...STROKE} />
      <path d="M4.8 21.6h6.4" {...STROKE} />
    </Glyph>
  );
}

export function IconArrow(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M5.6 18.4 18.4 5.6" {...STROKE} />
      <path d="M11.2 5.6h7.2v7.2" {...STROKE} />
    </Glyph>
  );
}

export function IconSquare(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <rect x="4.8" y="4.8" width="14.4" height="14.4" rx="2.2" {...STROKE} />
    </Glyph>
  );
}

export function IconCircle(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <circle cx="12" cy="12" r="7.6" {...STROKE} />
    </Glyph>
  );
}

export function IconText(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M5.6 6.4h12.8" {...STROKE} />
      <path d="M12 6.4v12" {...STROKE} />
    </Glyph>
  );
}

export function IconUndo(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M8.4 9.2H15a4.8 4.8 0 1 1 0 9.6h-6" {...STROKE} />
      <path d="M11.2 5.6 7.2 9.2l4 3.6" {...STROKE} />
    </Glyph>
  );
}

export function IconRedo(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M15.6 9.2H9a4.8 4.8 0 1 0 0 9.6h6" {...STROKE} />
      <path d="M12.8 5.6l4 3.6-4 3.6" {...STROKE} />
    </Glyph>
  );
}

export function IconTrash(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M4.8 7.2h14.4" {...STROKE} />
      <path
        d="M9.6 7.2V5.6a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v1.6"
        {...STROKE}
      />
      <path
        d="M6.8 7.2l.8 11.2a1.6 1.6 0 0 0 1.6 1.6h5.6a1.6 1.6 0 0 0 1.6-1.6l.8-11.2"
        {...STROKE}
      />
    </Glyph>
  );
}

export function IconCheck(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M5.6 12.8l4 4L18.4 7.2" {...STROKE} />
    </Glyph>
  );
}

export function IconClose(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" {...STROKE} />
    </Glyph>
  );
}

/* ---------- MENU ---------- */

export function IconPlus(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <path d="M12 5.6v12.8M5.6 12h12.8" {...STROKE} />
    </Glyph>
  );
}

export function IconDisplay(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <rect x="3.6" y="5.2" width="16.8" height="11.2" rx="2" {...STROKE} />
      <path d="M9.2 19.6h5.6" {...STROKE} />
    </Glyph>
  );
}

export function IconGear(): React.JSX.Element {
  return (
    <Glyph size={18}>
      <circle cx="12" cy="12" r="2.8" {...STROKE} />
      <path
        d="M12 3.6v2M12 18.4v2M4.8 12h2M17.2 12h2M6.9 6.9l1.4 1.4M15.7 15.7l1.4 1.4M17.1 6.9l-1.4 1.4M8.3 15.7l-1.4 1.4"
        {...STROKE}
      />
    </Glyph>
  );
}

export function IconChevron(): React.JSX.Element {
  return (
    <Glyph size={16}>
      <path d="M9.6 6.4 15.2 12l-5.6 5.6" {...STROKE} />
    </Glyph>
  );
}

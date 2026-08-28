import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { BoardPaneStatus, BoardPaneSummary } from '@builderhelm/protocol/board';
import type { CorrelationId } from '@builderhelm/shared';
import { useEffect, useRef, useState } from 'react';

const MIN_COLS = 2;
const MIN_ROWS = 2;
// Must stay a monospace stack, and must match `--font-mono` in styles.css.
// xterm.js measures one cell from this family and then positions every glyph on
// that grid. Left unset it inherits the application sans-serif, where a space
// is 4.2px but U+2500 is 16px, so box borders and padding drift apart and every
// bordered CLI panel tears. The terminal buffer stays correct either way; only
// the drawing is wrong, which makes it look like a CLI bug rather than a font one.
const TERMINAL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';
interface TerminalPaneProps {
  readonly sessionId: string;
  readonly pane: BoardPaneSummary;
  readonly maximized: boolean;
  readonly landing: boolean;
  readonly confirmLand: boolean;
  readonly onToggleMaximize: () => void;
  readonly onClose: () => void;
  readonly onAdd: (() => void) | undefined;
  readonly onLand: (() => void) | undefined;
  readonly onDragStart: () => void;
  readonly onDrop: () => void;
}

export function TerminalPane({
  sessionId,
  pane,
  maximized,
  landing,
  confirmLand,
  onToggleMaximize,
  onClose,
  onAdd,
  onLand,
  onDragStart,
  onDrop,
}: TerminalPaneProps): React.JSX.Element {
  const serializeRef = useRef<SerializeAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<BoardPaneStatus>(pane.status);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const term = new Terminal({
      convertEol: false,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      windowOptions: {
        getWinSizePixels: true,
        getCellSizePixels: true,
        getWinSizeChars: true,
      },
      theme: { background: '#0b0d12', foreground: '#e8eaf0', cursor: '#b6d475' },
    });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serialize);
    serializeRef.current = serialize;
    termRef.current = term;
    term.open(host);

    const applySize = (): void => {
      try {
        fit.fit();
      } catch {
        return;
      }
      void window.builderHelm.board.resize({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId,
        paneId: pane.paneId,
        cols: Math.max(MIN_COLS, term.cols),
        rows: Math.max(MIN_ROWS, term.rows),
      });
    };
    applySize();

    const observer = new ResizeObserver(() => {
      applySize();
    });
    observer.observe(host);

    const dataDisposable = term.onData((data) => {
      void window.builderHelm.board.write({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId,
        paneId: pane.paneId,
        data,
      });
    });

    const textarea = term.textarea;
    const handleFocus = (): void => setFocused(true);
    const handleBlur = (): void => setFocused(false);
    textarea?.addEventListener('focus', handleFocus);
    textarea?.addEventListener('blur', handleBlur);

    const unsubscribe = window.builderHelm.board.onPaneEvent(sessionId, (envelope) => {
      if (envelope.paneId !== pane.paneId) return;
      if (envelope.event.type === 'data') {
        const bytes = Uint8Array.from(atob(envelope.event.data), (c) => c.charCodeAt(0));
        term.write(bytes);
      } else {
        setStatus(envelope.event.status);
      }
    });

    void window.builderHelm.board
      .drainPane({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId,
        paneId: pane.paneId,
      })
      .then((snapshot) => {
        if (snapshot.data.length > 0) term.write(snapshot.data);
      })
      .catch(() => undefined);

    term.focus();

    return () => {
      observer.disconnect();
      unsubscribe();
      textarea?.removeEventListener('focus', handleFocus);
      textarea?.removeEventListener('blur', handleBlur);
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      serializeRef.current = null;
    };
  }, [sessionId, pane.paneId]);

  function copyOutput(): void {
    const text = serializeRef.current?.serialize() ?? '';
    void navigator.clipboard.writeText(text);
  }

  return (
    <div
      ref={paneRef}
      className={`terminalPane${focused ? ' terminalPaneFocused' : ''}${
        maximized ? ' terminalPaneMaximized' : ''
      }${dragging ? ' terminalPaneDragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={() => {
        ghostRef.current?.remove();
        ghostRef.current = null;
        setDragging(false);
      }}
    >
      <header
        className="paneHeader"
        draggable
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest('button') !== null) {
            event.preventDefault();
            return;
          }
          const paneEl = paneRef.current;
          const hostEl = hostRef.current;
          if (paneEl !== null) {
            const rect = paneEl.getBoundingClientRect();
            const ghost = paneEl.cloneNode(true) as HTMLElement;
            ghost.classList.add('terminalPaneGhost');
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${rect.height}px`;
            // The clone leaves the grid, so flex stops sizing the terminal
            // body and only the header would rasterize into the drag image.
            const ghostHost = ghost.querySelector('.paneTerminalHost');
            if (ghostHost instanceof HTMLElement && hostEl !== null) {
              ghostHost.style.flex = '0 0 auto';
              ghostHost.style.height = `${hostEl.getBoundingClientRect().height}px`;
            }
            document.body.appendChild(ghost);
            const sources = paneEl.querySelectorAll('canvas');
            const copies = ghost.querySelectorAll('canvas');
            sources.forEach((source, index) => {
              const copy = copies[index];
              if (
                !(source instanceof HTMLCanvasElement) ||
                !(copy instanceof HTMLCanvasElement)
              ) {
                return;
              }
              copy.width = source.width;
              copy.height = source.height;
              copy.getContext('2d')?.drawImage(source, 0, 0);
            });
            ghostRef.current?.remove();
            ghostRef.current = ghost;
            event.dataTransfer.setDragImage(
              ghost,
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
          }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', pane.paneId);
          setDragging(true);
          onDragStart();
        }}
      >
        <span className={`paneDot dot-${status}`} aria-label={`status: ${status}`} />
        <span className="paneTitle">{pane.title}</span>
        {pane.branch !== null && (
          <span className="paneBranch" title={pane.cwd}>
            {pane.branch}
          </span>
        )}
        {onLand !== undefined && (
          <button
            className="iconButton"
            type="button"
            onClick={onLand}
            disabled={landing}
            title={
              confirmLand
                ? 'Confirm merge into the primary repo'
                : 'Preview branch before landing'
            }
          >
            {confirmLand ? 'Confirm' : 'Land'}
          </button>
        )}
        <button
          className="iconButton"
          type="button"
          onClick={onToggleMaximize}
          title={maximized ? 'Exit full screen' : 'Full screen'}
        >
          {maximized ? (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M10 4v6H4M4 4l6 6M14 20v-6h6M20 20l-6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <button
          className="iconButton"
          type="button"
          onClick={copyOutput}
          title="Copy output"
        >
          ⧉
        </button>
        {onAdd !== undefined ? (
          <button
            className="iconButton"
            type="button"
            onClick={onAdd}
            title="New terminal to the right"
          >
            +
          </button>
        ) : null}
        <button className="iconButton" type="button" onClick={onClose} title="Close pane">
          ×
        </button>
      </header>
      <div
        className="paneTerminalHost"
        ref={hostRef}
        onMouseDown={() => termRef.current?.focus()}
      />
    </div>
  );
}

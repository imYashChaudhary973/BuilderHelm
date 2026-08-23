import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { BoardPaneStatus, BoardPaneSummary } from '@zero/protocol/board';
import type { CorrelationId } from '@zero/shared';
import { useEffect, useRef, useState } from 'react';

interface TerminalPaneProps {
  readonly sessionId: string;
  readonly pane: BoardPaneSummary;
  readonly maximized: boolean;
  readonly landing: boolean;
  readonly confirmLand: boolean;
  readonly onToggleMaximize: () => void;
  readonly onClose: () => void;
  readonly onLand: (() => void) | undefined;
}

export function TerminalPane({
  sessionId,
  pane,
  maximized,
  landing,
  confirmLand,
  onToggleMaximize,
  onClose,
  onLand,
}: TerminalPaneProps): React.JSX.Element {
  const serializeRef = useRef<SerializeAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<BoardPaneStatus>(pane.status);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const term = new Terminal({
      convertEol: false,
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0b0d12', foreground: '#e8eaf0', cursor: '#b6d475' },
    });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serialize);
    serializeRef.current = serialize;
    termRef.current = term;
    term.open(host);
    fit.fit();

    const observer = new ResizeObserver(() => {
      fit.fit();
      void window.zero.board.resize({
        correlationId: crypto.randomUUID() as CorrelationId,
        sessionId,
        paneId: pane.paneId,
        cols: term.cols,
        rows: term.rows,
      });
    });
    observer.observe(host);

    const dataDisposable = term.onData((data) => {
      void window.zero.board.write({
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

    const unsubscribe = window.zero.board.onPaneEvent(sessionId, (envelope) => {
      if (envelope.paneId !== pane.paneId) return;
      if (envelope.event.type === 'data') {
        const bytes = Uint8Array.from(atob(envelope.event.data), (c) => c.charCodeAt(0));
        term.write(bytes);
      } else {
        setStatus(envelope.event.status);
      }
    });

    void window.zero.board
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
      className={`terminalPane${focused ? ' terminalPaneFocused' : ''}${
        maximized ? ' terminalPaneMaximized' : ''
      }`}
    >
      <header className="paneHeader">
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
          title="Maximize"
        >
          {maximized ? '❐' : '□'}
        </button>
        <button
          className="iconButton"
          type="button"
          onClick={copyOutput}
          title="Copy output"
        >
          ⧉
        </button>
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

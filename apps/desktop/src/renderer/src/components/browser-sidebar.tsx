import { useCallback, useEffect, useRef, useState } from 'react';

function stageBounds(el: HTMLDivElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function BrowserSidebar({
  startUrl,
}: {
  readonly startUrl: string | null;
}): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(startUrl ?? 'localhost:3000');
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const syncBounds = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    void window.zero.browser
      .command({ action: 'bounds', bounds: stageBounds(stage) })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(stage);
    window.addEventListener('resize', syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
      void window.zero.browser.command({ action: 'hide' }).catch(() => undefined);
    };
  }, [syncBounds]);

  useEffect(() => {
    if (startUrl === null) return;
    const stage = stageRef.current;
    if (stage === null) return;
    setDraft(startUrl);
    void window.zero.browser
      .command({ action: 'open', url: startUrl, bounds: stageBounds(stage) })
      .then((state) => {
        if (state.url.length > 0) setDraft(state.url);
        setCanGoBack(state.canGoBack);
        setCanGoForward(state.canGoForward);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Preview failed');
      });
  }, [startUrl]);

  async function run(
    input:
      | { action: 'open'; url: string }
      | { action: 'back' }
      | { action: 'forward' }
      | { action: 'reload' },
  ): Promise<void> {
    const stage = stageRef.current;
    if (stage === null) return;
    setError(null);
    try {
      const state = await window.zero.browser.command(
        input.action === 'open'
          ? { action: 'open', url: input.url, bounds: stageBounds(stage) }
          : input,
      );
      if (state.url.length > 0) setDraft(state.url);
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview failed');
    }
  }

  return (
    <aside className="browserSide" aria-label="Browser">
      <form
        className="browserBar"
        onSubmit={(event) => {
          event.preventDefault();
          void run({ action: 'open', url: draft });
        }}
      >
        <button type="button" disabled={!canGoBack} onClick={() => void run({ action: 'back' })}>
          ←
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          onClick={() => void run({ action: 'forward' })}
        >
          →
        </button>
        <button type="button" onClick={() => void run({ action: 'reload' })}>
          ↻
        </button>
        <input
          aria-label="Address"
          value={draft}
          placeholder="localhost:3000"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Go</button>
      </form>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      <div ref={stageRef} className="browserStage" />
    </aside>
  );
}

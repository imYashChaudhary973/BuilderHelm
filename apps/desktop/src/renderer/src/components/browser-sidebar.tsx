import { useCallback, useEffect, useRef, useState } from 'react';

interface RecentHit {
  readonly url: string;
  readonly label: string;
}

const RECENTS_KEY = 'exeum.browser.recents';

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

function readRecents(): RecentHit[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentHit => {
        if (item === null || typeof item !== 'object') return false;
        const row = item as { url?: unknown; label?: unknown };
        return typeof row.url === 'string' && typeof row.label === 'string';
      })
      .slice(0, 10);
  } catch {
    return [];
  }
}

function remember(url: string): RecentHit[] {
  let label = url;
  try {
    const parsed = new URL(url);
    label = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      ? `localhost${parsed.port.length > 0 ? `:${parsed.port}` : ''}`
      : parsed.hostname;
  } catch {
    // keep raw url
  }
  const next = [{ url, label }, ...readRecents().filter((item) => item.url !== url)].slice(
    0,
    10,
  );
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
}

export function BrowserSidebar({
  startUrl,
}: {
  readonly startUrl: string | null;
}): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(startUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  const [recents, setRecents] = useState(readRecents);

  const syncBounds = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    void window.zero?.browser
      .command({ action: 'bounds', bounds: stageBounds(stage) })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    syncBounds();
    window.addEventListener('resize', syncBounds);
    const frame = requestAnimationFrame(syncBounds);
    return () => {
      window.removeEventListener('resize', syncBounds);
      cancelAnimationFrame(frame);
      void window.zero?.browser.command({ action: 'hide' }).catch(() => undefined);
    };
  }, [syncBounds, page]);

  useEffect(() => {
    if (startUrl === null || startUrl.length === 0) return;
    setDraft(startUrl);
    void openUrl(startUrl);
  }, [startUrl]);

  async function openUrl(raw: string): Promise<void> {
    const stage = stageRef.current;
    const url = raw.trim();
    if (stage === null || url.length === 0) return;
    setError(null);
    try {
      const state = await window.zero.browser.command({
        action: 'open',
        url,
        bounds: stageBounds(stage),
      });
      setDraft(state.url.length > 0 ? state.url : url);
      setPage(state.url.length > 0 ? state.url : url);
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      setRecents(remember(state.url.length > 0 ? state.url : url));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that URL');
    }
  }

  async function run(action: 'back' | 'forward' | 'reload'): Promise<void> {
    try {
      const state = await window.zero.browser.command({ action });
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      if (state.url.length > 0) {
        setDraft(state.url);
        setPage(state.url);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Browser action failed');
    }
  }

  function newTab(): void {
    setPage(null);
    setDraft('');
    setError(null);
    void window.zero?.browser.command({ action: 'hide' }).catch(() => undefined);
  }

  return (
    <aside className="browserSide" aria-label="Browser">
      <form
        className="browserBar"
        onSubmit={(event) => {
          event.preventDefault();
          void openUrl(draft);
        }}
      >
        <button type="button" disabled={!canGoBack} onClick={() => void run('back')}>
          ←
        </button>
        <button type="button" disabled={!canGoForward} onClick={() => void run('forward')}>
          →
        </button>
        <button type="button" disabled={page === null} onClick={() => void run('reload')}>
          ↻
        </button>
        <input
          aria-label="Address"
          value={draft}
          placeholder="enter a url to open a tab"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" title="New tab" onClick={newTab}>
          +
        </button>
      </form>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      <div
        ref={stageRef}
        className={page === null ? 'browserStage browserStageIdle' : 'browserStage'}
      >
        {page === null ? (
          <div className="browserHome">
            <div className="browserHomeMark" aria-hidden="true">
              ⌂
            </div>
            <h2>Preview</h2>
            <p>
              Open <button type="button" className="browserChip" onClick={() => void openUrl('localhost:3000')}>localhost</button>
              , docs, or any URL without leaving BuilderHelm.
            </p>
            <button
              type="button"
              className="browserNewTab"
              onClick={() => {
                const field = document.querySelector<HTMLInputElement>(
                  '.browserBar input',
                );
                field?.focus();
              }}
            >
              + New tab
            </button>
            {recents.length > 0 && (
              <div className="browserRecents">
                <span>Recently opened</span>
                <ul>
                  {recents.map((item) => (
                    <li key={item.url}>
                      <button type="button" onClick={() => void openUrl(item.url)}>
                        <em>{item.label.slice(0, 1).toUpperCase()}</em>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.url}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

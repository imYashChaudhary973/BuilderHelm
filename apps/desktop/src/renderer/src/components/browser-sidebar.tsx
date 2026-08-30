import { useQuery } from '@tanstack/react-query';
import {
  PREVIEW_VIEWPORTS,
  type DesktopActApproval,
  type PreviewDriveApproval,
  type PreviewSnapshot,
  type PreviewViewportId,
} from '@builderhelm/protocol/browser';
import type { CorrelationId } from '@builderhelm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSpaces } from '../space-store.js';

interface RecentHit {
  readonly url: string;
  readonly label: string;
}

const RECENTS_KEY = 'exeum.browser.recents';
const LAST_KEY = 'exeum.browser.last';
const VIEWPORTS = [
  'desktop',
  'tablet',
  'phone',
] as const satisfies readonly PreviewViewportId[];

function stageBounds(el: HTMLDivElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function readRecents(): RecentHit[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is RecentHit =>
        typeof item === 'object' &&
        item !== null &&
        'url' in item &&
        typeof item.url === 'string',
    );
  } catch {
    return [];
  }
}

function remember(url: string): RecentHit[] {
  let label = url;
  try {
    label = new URL(url).host || url;
  } catch {
    // keep raw url
  }
  const next = [
    { url, label },
    ...readRecents().filter((item) => item.url !== url),
  ].slice(0, 10);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
}

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null
  );
}

export function BrowserSidebar({
  startUrl,
}: {
  readonly startUrl: string | null;
}): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(startUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [viewport, setViewport] = useState<PreviewViewportId>('desktop');
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [fillText, setFillText] = useState('');
  const [approval, setApproval] = useState<PreviewDriveApproval | null>(null);
  const [pickNote, setPickNote] = useState('this is stuck');
  const [desktopApproval, setDesktopApproval] = useState<DesktopActApproval | null>(null);
  const [menu, setMenu] = useState<
    'import' | 'history' | 'overflow' | 'viewport' | 'settings' | null
  >(null);
  const [designOn, setDesignOn] = useState(false);
  const events = useQuery({
    queryKey: ['preview-events'],
    queryFn: () => window.builderHelm.browser.events(),
    refetchInterval: page === null ? false : 1500,
  });

  const origins = useQuery({
    queryKey: ['preview-origins'],
    queryFn: () => window.builderHelm.browser.origins(),
    refetchInterval: 2000,
  });
  const swarm = useQuery({
    queryKey: ['preview-swarm'],
    queryFn: () =>
      window.builderHelm.swarm.latest({
        correlationId: crypto.randomUUID() as CorrelationId,
      }),
  });
  const artifacts = useQuery({
    queryKey: ['preview-artifacts', root, swarm.data?.id],
    queryFn: () =>
      window.builderHelm.browser.artifacts({
        ...(root === null ? {} : { root }),
        runId: swarm.data?.id ?? null,
      }),
    enabled: page !== null,
  });

  const syncBounds = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null || page === null) return;
    void window.builderHelm.browser
      .command({ action: 'bounds', bounds: stageBounds(stage) })
      .catch(() => undefined);
  }, [page]);

  useEffect(() => {
    syncBounds();
    window.addEventListener('resize', syncBounds);
    return () => window.removeEventListener('resize', syncBounds);
  }, [syncBounds, page]);

  useEffect(() => {
    localStorage.setItem(LAST_KEY, page ?? '');
  }, [page]);

  useEffect(() => {
    const last = localStorage.getItem(LAST_KEY);
    if (last !== null && last.length > 0 && startUrl === null) setDraft(last);
  }, []);

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
      const state = await window.builderHelm.browser.command({
        action: 'open',
        url,
        bounds: stageBounds(stage),
      });
      setDraft(state.url.length > 0 ? state.url : url);
      setPage(state.url.length > 0 ? state.url : url);
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      setViewport(state.viewport);
      const opened = state.url.length > 0 ? state.url : url;
      setRecents(remember(opened));
      localStorage.setItem(LAST_KEY, opened);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that URL');
    }
  }

  async function run(action: 'back' | 'forward' | 'reload' | 'external'): Promise<void> {
    try {
      const state = await window.builderHelm.browser.command({ action });
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      setViewport(state.viewport);
      if (state.url.length > 0) {
        setDraft(state.url);
        setPage(state.url);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Browser action failed');
    }
  }

  async function applyViewport(preset: PreviewViewportId): Promise<void> {
    const stage = stageRef.current;
    if (stage === null) return;
    try {
      const state = await window.builderHelm.browser.command({
        action: 'viewport',
        preset,
        bounds: stageBounds(stage),
      });
      setViewport(state.viewport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Viewport failed');
    }
  }

  async function takeSnapshot(): Promise<void> {
    try {
      const next = await window.builderHelm.browser.snapshot({
        ...(root === null ? {} : { root }),
        runId: swarm.data?.id ?? null,
      });
      setSnapshot(next);
      await artifacts.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Snapshot failed');
    }
  }

  async function takeScreenshot(): Promise<void> {
    try {
      const artifact = await window.builderHelm.browser.screenshot({
        ...(root === null ? {} : { root }),
        runId: swarm.data?.id ?? null,
      });
      if (artifact.pngBase64 !== null)
        setShot(`data:image/png;base64,${artifact.pngBase64}`);
      await artifacts.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Screenshot failed');
    }
  }

  async function drive(
    action: 'click' | 'type' | 'fill' | 'scroll',
    ref: string,
  ): Promise<void> {
    try {
      const result = await window.builderHelm.browser.drive({
        action,
        ref,
        ...(action === 'fill' || action === 'type' ? { text: fillText } : {}),
      });
      if (result.kind === 'approval_required') setApproval(result.approval);
      else setApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Drive failed');
    }
  }

  async function resolveApproval(allow: boolean): Promise<void> {
    if (approval === null) return;
    try {
      await window.builderHelm.browser.approve({ id: approval.id, allow });
      setApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval failed');
    }
  }

  async function desktopAct(action: 'click' | 'type'): Promise<void> {
    try {
      const input =
        action === 'click'
          ? (() => {
              const [xRaw, yRaw] = fillText.split(',');
              const x = Number(xRaw);
              const y = Number(yRaw);
              if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error('Click needs x,y');
              }
              return { action, x: Math.round(x), y: Math.round(y) } as const;
            })()
          : { action, text: fillText };
      const result = await window.builderHelm.desktop.act(input);
      if (result.kind === 'approval_required') setDesktopApproval(result.approval);
      else setDesktopApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Desktop act failed');
    }
  }

  async function resolveDesktop(allow: boolean): Promise<void> {
    if (desktopApproval === null) return;
    try {
      await window.builderHelm.desktop.approve({ id: desktopApproval.id, allow });
      setDesktopApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Desktop approval failed');
    }
  }

  async function desktopShot(): Promise<void> {
    try {
      const shot = await window.builderHelm.desktop.screenshot();
      setShot(`data:image/png;base64,${shot.pngBase64}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Desktop screenshot failed');
    }
  }

  async function pickElement(): Promise<void> {
    try {
      const picked = await window.builderHelm.browser.pick();
      if (picked.pngBase64 !== null) {
        setShot(`data:image/png;base64,${picked.pngBase64}`);
      }
      setError(`Picked ${picked.role} “${picked.name}”. Send to builder when ready.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pick failed');
    }
  }

  async function sendPicked(): Promise<void> {
    try {
      const result = await window.builderHelm.browser.sendPick({ note: pickNote });
      setError(result.sent ? 'Sent to builder seats.' : 'No swarm builder to send to.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Send failed');
    }
  }

  function newTab(): void {
    setPage(null);
    setDraft('');
    setError(null);
    setSnapshot(null);
    setShot(null);
    void window.builderHelm?.browser.command({ action: 'hide' }).catch(() => undefined);
  }

  const ports = origins.data ?? [];

  return (
    <aside className="browserSide" aria-label="Browser">
      <form
        className="browserBar"
        onSubmit={(event) => {
          event.preventDefault();
          setMenu(null);
          void openUrl(draft);
        }}
      >
        <button
          type="button"
          className="browserIcon"
          disabled={!canGoBack}
          aria-label="Back"
          onClick={() => void run('back')}
        >
          ←
        </button>
        <button
          type="button"
          className="browserIcon"
          disabled={!canGoForward}
          aria-label="Forward"
          onClick={() => void run('forward')}
        >
          →
        </button>
        <button
          type="button"
          className="browserIcon"
          disabled={page === null}
          aria-label="Reload"
          onClick={() => void run('reload')}
        >
          ↻
        </button>
        <div className="browserOmnibox">
          <span aria-hidden="true">{draft.startsWith('https:') ? '🔒' : '🌐'}</span>
          <input
            aria-label="Address"
            value={draft}
            placeholder="http or https only"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="browserImport"
          aria-haspopup="menu"
          aria-expanded={menu === 'import'}
          onClick={() => setMenu(menu === 'import' ? null : 'import')}
        >
          Import
        </button>
        <button
          type="button"
          className="browserIcon"
          aria-label="History"
          onClick={() => setMenu(menu === 'history' ? null : 'history')}
        >
          🕐
        </button>
        <button
          type="button"
          className="browserIcon"
          disabled={page === null}
          aria-label="Send to agent"
          onClick={() => void sendPicked()}
        >
          💬
        </button>
        <button
          type="button"
          className={designOn ? 'browserIcon browserIconOn' : 'browserIcon'}
          disabled={page === null}
          aria-label="Design Mode"
          aria-pressed={designOn}
          onClick={() => {
            setDesignOn(true);
            void pickElement().finally(() => setDesignOn(false));
          }}
        >
          ✨
        </button>
        <button
          type="button"
          className="browserIcon"
          aria-label="Viewport size"
          onClick={() => setMenu(menu === 'viewport' ? null : 'viewport')}
        >
          ⛶
        </button>
        <button
          type="button"
          className="browserIcon"
          disabled={page === null}
          aria-label="Open in system browser"
          onClick={() => void run('external')}
        >
          ↗
        </button>
        <button
          type="button"
          className="browserIcon"
          aria-label="Browser menu"
          aria-haspopup="menu"
          aria-expanded={menu === 'overflow' || menu === 'settings'}
          onClick={() => setMenu(menu === 'overflow' ? null : 'overflow')}
        >
          ⋯
        </button>
      </form>
      {menu === 'import' ? (
        <div className="browserMenu" role="menu" aria-label="Import local origin">
          {ports.length === 0 ? (
            <p className="browserHint">No localhost URLs in pane output yet.</p>
          ) : (
            ports.map((origin) => (
              <button
                key={origin.url}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void openUrl(origin.url);
                }}
              >
                {origin.port}
              </button>
            ))
          )}
        </div>
      ) : null}
      {menu === 'history' ? (
        <div className="browserMenu" role="menu" aria-label="History">
          {recents.length === 0 ? (
            <p className="browserHint">No recently opened pages.</p>
          ) : (
            recents.map((item) => (
              <button
                key={item.url}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void openUrl(item.url);
                }}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      ) : null}
      {menu === 'viewport' ? (
        <div className="browserMenu" role="menu" aria-label="Viewport size">
          {VIEWPORTS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={viewport === id ? 'browserChipOn' : undefined}
              onClick={() => {
                setMenu(null);
                void applyViewport(id);
              }}
            >
              {id} {PREVIEW_VIEWPORTS[id].width}
            </button>
          ))}
        </div>
      ) : null}
      {menu === 'overflow' ? (
        <div className="browserMenu" role="menu" aria-label="Browser menu">
          <button type="button" role="menuitem" onClick={() => setMenu('viewport')}>
            Viewport Size
          </button>
          <button type="button" role="menuitem" onClick={() => setMenu('settings')}>
            Browser Settings…
          </button>
        </div>
      ) : null}
      {menu === 'settings' ? (
        <div className="browserMenu" role="menu" aria-label="Browser settings">
          <button
            type="button"
            role="menuitem"
            disabled={page === null}
            onClick={() => {
              setMenu(null);
              void takeSnapshot();
            }}
          >
            Snapshot
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={page === null}
            onClick={() => {
              setMenu(null);
              void takeScreenshot();
            }}
          >
            Screenshot
          </button>
          <button type="button" role="menuitem" onClick={() => void desktopShot()}>
            Desktop shot
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              newTab();
            }}
          >
            New tab
          </button>
          <input
            aria-label="Fill text"
            value={fillText}
            placeholder="fill / type / click x,y"
            onChange={(event) => setFillText(event.target.value)}
          />
          <button type="button" role="menuitem" onClick={() => void desktopAct('click')}>
            Desktop click
          </button>
          <button type="button" role="menuitem" onClick={() => void desktopAct('type')}>
            Desktop type
          </button>
        </div>
      ) : null}
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
            <p>Open a mapped local port from a live Space or Swarm pane.</p>
            {ports.length === 0 ? (
              <p className="browserHint">No localhost URLs in pane output yet.</p>
            ) : (
              <div className="browserPorts">
                {ports.map((origin) => (
                  <button
                    key={origin.url}
                    type="button"
                    className="browserChip"
                    onClick={() => void openUrl(origin.url)}
                  >
                    {origin.port}
                  </button>
                ))}
              </div>
            )}
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
      {approval !== null ? (
        <p className="browserError" role="alertdialog">
          Approve {approval.summary}?
          <button type="button" onClick={() => void resolveApproval(true)}>
            Allow
          </button>
          <button type="button" onClick={() => void resolveApproval(false)}>
            Deny
          </button>
        </p>
      ) : null}
      {desktopApproval !== null ? (
        <p className="browserError" role="alertdialog">
          Approve {desktopApproval.summary}?
          <button type="button" onClick={() => void resolveDesktop(true)}>
            Allow
          </button>
          <button type="button" onClick={() => void resolveDesktop(false)}>
            Deny
          </button>
        </p>
      ) : null}
      {snapshot !== null ? (
        <ol className="browserSnapshot" aria-label="Page snapshot">
          {snapshot.nodes.map((node) => (
            <li key={node.ref}>
              <code>{node.ref}</code> {node.role} {node.name}
              <button type="button" onClick={() => void drive('click', node.ref)}>
                Click
              </button>
              <button type="button" onClick={() => void drive('fill', node.ref)}>
                Fill
              </button>
              <button type="button" onClick={() => void drive('scroll', node.ref)}>
                Scroll
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <input
        aria-label="Pick note"
        value={pickNote}
        onChange={(event) => setPickNote(event.target.value)}
      />
      {(events.data ?? []).length > 0 ? (
        <ul className="browserSnapshot" aria-label="Console and network">
          {(events.data ?? []).slice(-12).map((item, index) => (
            <li key={`${item.createdAt}-${String(index)}`}>
              {item.kind} {item.text} {item.url}
            </li>
          ))}
        </ul>
      ) : null}
      {shot !== null ? (
        <img className="browserShot" src={shot} alt="Preview screenshot" />
      ) : null}
      {(artifacts.data ?? []).length > 0 ? (
        <ul className="browserArtifacts" aria-label="Run artifacts">
          {(artifacts.data ?? []).map((item) => (
            <li key={item.id}>
              <strong>{item.kind}</strong>
              <small>
                {item.viewport} · {item.headSha.slice(0, 7)}
              </small>
              {item.pngBase64 !== null ? (
                <button
                  type="button"
                  onClick={() => setShot(`data:image/png;base64,${item.pngBase64}`)}
                >
                  Open
                </button>
              ) : null}
              {item.nodes !== null ? (
                <button
                  type="button"
                  onClick={() =>
                    setSnapshot({
                      url: item.url,
                      viewport: item.viewport,
                      nodes: item.nodes ?? [],
                    })
                  }
                >
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

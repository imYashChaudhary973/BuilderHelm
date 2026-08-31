import { useQuery } from '@tanstack/react-query';
import {
  resolveOmniboxTarget,
  type PreviewDriveApproval,
  type PreviewPick,
  type PreviewToolMode,
  type PreviewViewportId,
} from '@builderhelm/protocol/browser';
import type { CorrelationId } from '@builderhelm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { useSpaces, type SpaceStore } from '../space-store.js';
import { ScreenshotEditor } from './screenshot-editor.js';
import {
  IconAnnotate,
  IconBack,
  IconDevtools,
  IconDraw,
  IconExternal,
  IconForward,
  IconGrab,
  IconImport,
  IconLock,
  IconOverflow,
  IconReload,
  IconWeb,
} from './browser-icons.js';

interface RecentHit {
  readonly url: string;
  readonly label: string;
}

const RECENTS_KEY = 'exeum.browser.recents';
const LAST_KEY = 'exeum.browser.last';

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
  return next;
}

function workspaceFolder(spaces: SpaceStore): string | null {
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
  const navigate = useNavigate();
  const root = workspaceFolder(spaces);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const omniboxRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(startUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [approval, setApproval] = useState<PreviewDriveApproval | null>(null);
  const [tool, setTool] = useState<PreviewToolMode | null>(null);
  const [picked, setPicked] = useState<PreviewPick | null>(null);
  const [note, setNote] = useState('');
  const [drawing, setDrawing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const origins = useQuery({
    queryKey: ['preview-origins'],
    queryFn: () => window.builderHelm.browser.origins(),
    refetchInterval: 2000,
  });
  const settings = useQuery({
    queryKey: ['browser-settings'],
    queryFn: () => window.builderHelm.browser.settings(),
  });
  const swarm = useQuery({
    queryKey: ['preview-swarm'],
    queryFn: () =>
      window.builderHelm.swarm.latest({
        correlationId: crypto.randomUUID() as CorrelationId,
      }),
  });

  const evidence = {
    ...(root === null ? {} : { root }),
    runId: swarm.data?.id ?? null,
  };

  const syncBounds = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null || page === null) return;
    void window.builderHelm.browser
      .command({ action: 'bounds', bounds: stageBounds(stage) })
      .catch(() => undefined);
  }, [page]);

  /**
   * The embedded view is a native child of the window, not a DOM child of the
   * stage, so nothing moves it when the panel reflows. Anything that changes
   * the stage — the window resizing, the panel being dragged, a tray or error
   * banner appearing above it — has to push new bounds, or the page keeps its
   * old rectangle and paints over the very tray that just opened.
   */
  useEffect(() => {
    const stage = stageRef.current;
    syncBounds();
    window.addEventListener('resize', syncBounds);
    const observer = stage === null ? null : new ResizeObserver(syncBounds);
    if (stage !== null) observer?.observe(stage);
    return () => {
      window.removeEventListener('resize', syncBounds);
      observer?.disconnect();
    };
  }, [syncBounds, page]);

  // The page can navigate without the toolbar asking — a link, a redirect, an
  // in-page route. Main pushes the new state so Back and Forward stay honest.
  useEffect(() => {
    return window.builderHelm.browser.onState((state) => {
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      if (state.url.length === 0) return;
      setPage(state.url);
      setDraft(state.url);
    });
  }, []);

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
    if (stage === null) return;
    const target = resolveOmniboxTarget(raw, settings.data?.searchEngine ?? 'google');
    if (target === null) {
      setError('Type a URL or a search phrase.');
      return;
    }
    setError(null);
    try {
      const state = await window.builderHelm.browser.command({
        action: 'open',
        url: target,
        bounds: stageBounds(stage),
      });
      const opened = state.url.length > 0 ? state.url : target;
      setDraft(opened);
      setPage(opened);
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      setRecents(remember(opened));
      localStorage.setItem(LAST_KEY, opened);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that URL');
    }
  }

  async function run(
    action: 'back' | 'forward' | 'reload' | 'external' | 'devtools',
  ): Promise<void> {
    try {
      const state = await window.builderHelm.browser.command({ action });
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

  async function applyViewport(preset: PreviewViewportId): Promise<void> {
    const stage = stageRef.current;
    if (stage === null) return;
    try {
      await window.builderHelm.browser.command({
        action: 'viewport',
        preset,
        bounds: stageBounds(stage),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Viewport failed');
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

  /** Arms one-shot selection. The page cancels on Escape and resolves on click. */
  async function startTool(mode: PreviewToolMode): Promise<void> {
    if (page === null || tool !== null) return;
    setError(null);
    setPicked(null);
    setNote('');
    setTool(mode);
    try {
      setPicked(await window.builderHelm.browser.pick({ mode }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Selection failed');
    } finally {
      setTool(null);
    }
  }

  async function sendPicked(): Promise<void> {
    if (note.trim().length === 0) {
      setError('Add a note before sending this to an agent.');
      return;
    }
    try {
      const result = await window.builderHelm.browser.sendPick({ note });
      setError(result.sent ? 'Sent to builder seats.' : 'No swarm builder to send to.');
      setPicked(null);
      setNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Send failed');
    }
  }

  async function saveAnnotation(): Promise<void> {
    if (note.trim().length === 0) {
      setError('An annotation needs a note.');
      return;
    }
    try {
      await window.builderHelm.browser.annotate({ note, ...evidence });
      setPicked(null);
      setNote('');
      setError('Annotation saved to this revision.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Annotation failed');
    }
  }

  /**
   * Captures the page, then hides the live view while the editor is open. The
   * view keeps its document and scroll offset, so closing the editor restores
   * exactly what was captured instead of reloading the page.
   */
  async function startDrawing(): Promise<void> {
    if (page === null) return;
    try {
      const artifact = await window.builderHelm.browser.screenshot(evidence);
      if (artifact.pngBase64 === null) {
        setError('The capture came back empty.');
        return;
      }
      await window.builderHelm.browser.command({ action: 'visible', visible: false });
      setDrawing(artifact.pngBase64);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Capture failed');
    }
  }

  async function closeDrawing(): Promise<void> {
    setDrawing(null);
    setSaving(false);
    try {
      await window.builderHelm.browser.command({ action: 'visible', visible: true });
      syncBounds();
    } catch {
      // The view is gone; the idle home screen is already correct.
    }
  }

  async function saveDrawing(png: ArrayBuffer): Promise<void> {
    setSaving(true);
    try {
      await window.builderHelm.browser.saveDrawing({ png, ...evidence });
      setError('Marked screenshot copied. Saved to this revision.');
      await closeDrawing();
    } catch (cause) {
      setSaving(false);
      setError(cause instanceof Error ? cause.message : 'Could not save the markup');
    }
  }

  async function openMenu(
    kind: 'import' | 'overflow' | 'viewport',
    anchor: HTMLElement,
  ): Promise<void> {
    const rect = anchor.getBoundingClientRect();
    try {
      const { choice } = await window.builderHelm.browser.menu({
        kind,
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 4),
      });
      if (choice === null) return;
      await applyMenuChoice(choice, anchor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Menu failed');
    }
  }

  async function applyMenuChoice(choice: string, anchor: HTMLElement): Promise<void> {
    const [key, ...rest] = choice.split(':');
    const value = rest.join(':');
    if (key === 'open') {
      await openUrl(value);
      return;
    }
    if (key === 'viewport') {
      await applyViewport(value as PreviewViewportId);
      return;
    }
    if (key === 'profile') {
      await window.builderHelm.browser.updateSettings({ activeProfileId: value });
      await settings.refetch();
      // Cookies belong to the partition, so the page has to be reopened under
      // the new profile rather than kept alive across the switch.
      if (page !== null) await openUrl(page);
      return;
    }
    if (key === 'cookies') {
      const result = await window.builderHelm.browser.importCookies({ id: value });
      await settings.refetch();
      setError(
        result.cancelled
          ? 'Cookie import cancelled.'
          : `Imported ${String(result.imported)} cookies from ${String(result.domains.length)} domains.`,
      );
      return;
    }
    if (choice === 'profile-new') {
      const name = window.prompt('New profile name');
      if (name === null || name.trim().length === 0) return;
      await window.builderHelm.browser.createProfile({ name });
      await settings.refetch();
      await openMenu('overflow', anchor);
      return;
    }
    if (choice === 'settings') {
      await navigate({ to: '/settings/browser' });
    }
  }

  /**
   * Arrow, Home, and End move focus inside the icon group, skipping disabled
   * tools. Every button stays in the tab order rather than using a roving
   * tabindex: the group is six controls in a toolbar that already holds a text
   * field, and swallowing Tab would make the field harder to leave.
   */
  function moveToolbarFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const group = toolbarRef.current;
    if (group === null) return;
    const items = [...group.querySelectorAll<HTMLButtonElement>('button')].filter(
      (item) => !item.disabled,
    );
    if (items.length === 0) return;
    event.preventDefault();
    const active = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowRight'
            ? (Math.max(0, active) + 1) % items.length
            : (Math.max(0, active) - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  const ports = origins.data ?? [];
  const secure = page !== null && page.startsWith('https:');

  return (
    <aside className="browserSide" aria-label="Browser">
      <form
        className="browserBar"
        onSubmit={(event) => {
          event.preventDefault();
          void openUrl(draft);
        }}
      >
        <div className="browserNav">
          <button
            type="button"
            className="browserIcon"
            disabled={!canGoBack}
            aria-label="Back"
            title="Back"
            onClick={() => void run('back')}
          >
            <IconBack />
          </button>
          <button
            type="button"
            className="browserIcon"
            disabled={!canGoForward}
            aria-label="Forward"
            title="Forward"
            onClick={() => void run('forward')}
          >
            <IconForward />
          </button>
          <button
            type="button"
            className="browserIcon"
            disabled={page === null}
            aria-label="Reload"
            title="Reload"
            onClick={() => void run('reload')}
          >
            <IconReload />
          </button>
        </div>
        <div className="browserOmnibox">
          <span
            className={secure ? 'browserLock browserLockOn' : 'browserLock'}
            aria-hidden="true"
          >
            {secure ? <IconLock /> : <IconWeb />}
          </span>
          <input
            ref={omniboxRef}
            aria-label="Address and search"
            value={draft}
            placeholder="Enter a URL or search"
            spellCheck={false}
            autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setDraft(page ?? '');
              event.currentTarget.blur();
            }}
          />
        </div>
        <button
          type="button"
          className="browserImport"
          aria-haspopup="menu"
          aria-label="Import a mapped localhost port"
          title="Import a mapped localhost port"
          onClick={(event) => void openMenu('import', event.currentTarget)}
        >
          <IconImport />
          <span className="browserImportLabel">Import</span>
        </button>
        <div
          ref={toolbarRef}
          className="browserToolsBar"
          role="toolbar"
          aria-label="Page tools"
          aria-orientation="horizontal"
          onKeyDown={moveToolbarFocus}
        >
          <button
            type="button"
            className={tool === 'grab' ? 'browserIcon browserIconOn' : 'browserIcon'}
            disabled={page === null}
            aria-label="Grab page element"
            aria-pressed={tool === 'grab'}
            title="Grab page element — click an element, Esc cancels"
            onClick={() => void startTool('grab')}
          >
            <IconGrab />
          </button>
          <button
            type="button"
            className={tool === 'annotate' ? 'browserIcon browserIconOn' : 'browserIcon'}
            disabled={page === null}
            aria-label="Annotate page element"
            aria-pressed={tool === 'annotate'}
            title="Annotate page element — click an element, Esc cancels"
            onClick={() => void startTool('annotate')}
          >
            <IconAnnotate />
          </button>
          <button
            type="button"
            className={drawing === null ? 'browserIcon' : 'browserIcon browserIconOn'}
            disabled={page === null}
            aria-label="Draw on screenshot"
            aria-pressed={drawing !== null}
            title="Draw on screenshot"
            onClick={() => void startDrawing()}
          >
            <IconDraw />
          </button>
          <button
            type="button"
            className="browserIcon"
            disabled={page === null}
            aria-label="Open browser devtools"
            title="Open browser devtools"
            onClick={() => void run('devtools')}
          >
            <IconDevtools />
          </button>
          <button
            type="button"
            className="browserIcon"
            disabled={page === null}
            aria-label="Open in default browser"
            title="Open in default browser"
            onClick={() => void run('external')}
          >
            <IconExternal />
          </button>
          <button
            type="button"
            className="browserIcon"
            aria-haspopup="menu"
            aria-label="Browser menu"
            title="Profiles, viewport, and settings"
            onClick={(event) => void openMenu('overflow', event.currentTarget)}
          >
            <IconOverflow />
          </button>
        </div>
      </form>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      {picked !== null && (
        <div className="browserTray" role="group" aria-label="Selected element">
          {picked.pngBase64 !== null && (
            <img
              className="browserTrayShot"
              src={`data:image/png;base64,${picked.pngBase64}`}
              alt={`${picked.role} ${picked.name}`}
            />
          )}
          <div className="browserTrayBody">
            <strong>
              {picked.role}
              {picked.name.length > 0 ? ` · ${picked.name}` : ''}
            </strong>
            <small>
              {picked.locator} · {String(picked.rect.width)}×{String(picked.rect.height)}
            </small>
            <input
              aria-label="Note"
              placeholder="What should change here?"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="browserTrayActions">
              <button
                type="button"
                className="drawChip drawChipPrimary"
                onClick={() => void saveAnnotation()}
              >
                Save annotation
              </button>
              <button
                type="button"
                className="drawChip"
                onClick={() => void sendPicked()}
              >
                Send to agent
              </button>
              <button
                type="button"
                className="drawChip"
                onClick={() => {
                  setPicked(null);
                  setNote('');
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        ref={stageRef}
        className={page === null ? 'browserStage browserStageIdle' : 'browserStage'}
      >
        {drawing !== null ? (
          <ScreenshotEditor
            pngBase64={drawing}
            busy={saving}
            onCancel={() => void closeDrawing()}
            onSave={(png) => void saveDrawing(png)}
          />
        ) : page === null ? (
          <div className="browserHome">
            <div className="browserHomeMark" aria-hidden="true">
              <IconWeb />
            </div>
            <h2>Preview</h2>
            <p>Open a mapped local port from a live Space or Swarm pane.</p>
            {settings.data !== undefined && settings.data.homePage.length > 0 && (
              <div className="browserPorts">
                <button
                  type="button"
                  className="browserChip"
                  onClick={() => void openUrl(settings.data.homePage)}
                >
                  Home page
                </button>
              </div>
            )}
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
                    {settings.data?.localhostWorktreeLabels === true &&
                    origin.sessionId !== null
                      ? ` · ${origin.sessionId.slice(0, 8)}`
                      : ''}
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
    </aside>
  );
}

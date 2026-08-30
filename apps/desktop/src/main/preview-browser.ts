import {
  BrowserWindow,
  session,
  shell,
  WebContentsView,
  type WebContents,
} from 'electron';

import type { BrowserSettingsService } from '@builderhelm/core';
import {
  browserProfilePartition,
  buildPageSnapshot,
  parsePreviewUrl,
  PREVIEW_VIEWPORTS,
  previewTargetNeedsApproval,
  redactPreviewUrl,
  type BrowserCommandInput,
  type BrowserState,
  type PreviewBounds,
  type PreviewDriveAction,
  type PreviewDriveApproval,
  type PreviewDriveReceipt,
  type PreviewDriveResult,
  type PreviewEvent,
  type PreviewPick,
  type PreviewRect,
  type PreviewSnapshot,
  type PreviewToolMode,
  type PreviewViewportId,
} from '@builderhelm/protocol/browser';
import { BuilderHelmError, createId, utcNow } from '@builderhelm/shared';

import { secureWebPreferences } from './security.js';

const SNAPSHOT_SCRIPT = `(() => {
  const out = [];
  const nodes = document.querySelectorAll('a,button,input,select,textarea,summary,[role]');
  for (const el of nodes) {
    if (out.length >= 200) break;
    const ref = 'e' + String(out.length + 1);
    el.setAttribute('data-bh-ref', ref);
    const role = (el.getAttribute('role') || el.tagName.toLowerCase()).slice(0, 40);
    let name = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!name && el.tagName === 'INPUT') {
      name = el.getAttribute('placeholder') || el.getAttribute('name') || '';
    }
    if (!name) name = (el.innerText || '').trim();
    out.push({ role, name: String(name).slice(0, 80) });
  }
  return out;
})()`;

function inspectScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-bh-ref="${ref}"]');
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: (el.getAttribute('role') || el.tagName.toLowerCase()).slice(0, 40),
      name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 80),
      href: el.tagName === 'A' ? String(el.href || '') : '',
      pageOrigin: location.origin,
    };
  })()`;
}

function actScript(action: PreviewDriveAction, ref: string, text: string): string {
  return `(() => {
    const el = document.querySelector('[data-bh-ref="${ref}"]');
    if (!el) throw new Error('Unknown ref ${ref}');
    if (${JSON.stringify(action)} === 'scroll') {
      el.scrollIntoView({ block: 'center' });
      return true;
    }
    if (${JSON.stringify(action)} === 'click') {
      el.click();
      return true;
    }
    el.focus();
    const value = ${JSON.stringify(action)} === 'type'
      ? String(el.value || '') + ${JSON.stringify(text)}
      : ${JSON.stringify(text)};
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

/**
 * Hover highlight, click to capture, Escape to cancel. Resolves with identity
 * and geometry only: a locator, the accessible role and name, and the client
 * rect. Field values, markup, and attributes never leave the page, so a grab
 * over a filled login form carries nothing worth stealing.
 */
function pickScript(mode: PreviewToolMode): string {
  return `(() => {
  const { promise, resolve } = Promise.withResolvers();
  const tint = ${mode === 'annotate' ? "'251, 191, 36'" : "'125, 211, 252'"};
  const box = document.createElement('div');
  box.setAttribute('data-bh-overlay', 'pick');
  box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;'
    + 'border:2px solid rgb(' + tint + ');background:rgba(' + tint + ',0.16);border-radius:3px;';
  document.documentElement.appendChild(box);
  let hovered = null;

  const locate = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const twins = Array.prototype.filter.call(
        parent.children,
        (child) => child.tagName === node.tagName,
      );
      const nth = twins.indexOf(node) + 1;
      parts.unshift(twins.length > 1 ? tag + ':nth-of-type(' + String(nth) + ')' : tag);
      node = parent;
    }
    return parts.join('>').slice(0, 200) || 'html';
  };

  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const password = el.tagName === 'INPUT' && (el.getAttribute('type') || '') === 'password';
    let name = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!name && el.tagName === 'INPUT') {
      name = el.getAttribute('placeholder') || el.getAttribute('name') || '';
    }
    if (!name && !el.isContentEditable && !password) name = (el.innerText || '').trim();
    if (password) name = 'password field';
    return {
      locator: locate(el),
      role: (el.getAttribute('role') || el.tagName.toLowerCase()).slice(0, 40),
      name: String(name).replace(/\\s+/g, ' ').trim().slice(0, 80),
      rect: {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      },
    };
  };

  const onMove = (event) => {
    const el = event.target;
    if (!el || el.nodeType !== 1 || el.getAttribute('data-bh-overlay')) return;
    hovered = el;
    const rect = el.getBoundingClientRect();
    box.style.left = String(rect.left) + 'px';
    box.style.top = String(rect.top) + 'px';
    box.style.width = String(rect.width) + 'px';
    box.style.height = String(rect.height) + 'px';
  };

  const finish = (value) => {
    box.remove();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    resolve(value);
  };

  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const el = event.target && event.target.nodeType === 1 ? event.target : hovered;
    finish(el ? describe(el) : null);
  };

  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  };

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  return promise;
})()`;
}

/**
 * Draws a numbered pin over the annotated element. Evidence, not a source edit:
 * the marker lives in the live DOM and disappears on the next navigation, while
 * the saved artifact keeps the note, the geometry, and the screenshot.
 */
function pinScript(index: number, rect: PreviewRect): string {
  return `(() => {
    const pin = document.createElement('div');
    pin.setAttribute('data-bh-overlay', 'pin');
    pin.textContent = ${JSON.stringify(String(index))};
    pin.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;'
      + 'left:${String(rect.x)}px;top:${String(rect.y)}px;'
      + 'min-width:20px;height:20px;padding:0 5px;border-radius:10px;'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'background:rgb(251,191,36);color:#1a1a1a;font:600 12px/1 system-ui,sans-serif;'
      + 'box-shadow:0 1px 4px rgba(0,0,0,0.45);';
    document.documentElement.appendChild(pin);
    const outline = document.createElement('div');
    outline.setAttribute('data-bh-overlay', 'pin');
    outline.style.cssText = 'position:fixed;z-index:2147483644;pointer-events:none;'
      + 'left:${String(rect.x)}px;top:${String(rect.y)}px;'
      + 'width:${String(rect.width)}px;height:${String(rect.height)}px;'
      + 'border:2px dashed rgb(251,191,36);border-radius:3px;';
    document.documentElement.appendChild(outline);
    return true;
  })()`;
}

function letterbox(stage: PreviewBounds, viewport: PreviewViewportId): PreviewBounds {
  const preset = PREVIEW_VIEWPORTS[viewport];
  const scale = Math.min(stage.width / preset.width, stage.height / preset.height, 1);
  const width = Math.max(1, Math.round(preset.width * scale));
  const height = Math.max(1, Math.round(preset.height * scale));
  return {
    x: stage.x + Math.floor((stage.width - width) / 2),
    y: stage.y + Math.floor((stage.height - height) / 2),
    width,
    height,
  };
}

interface PendingDrive {
  readonly id: string;
  readonly action: PreviewDriveAction;
  readonly ref: string;
  readonly text: string;
  readonly summary: string;
}

export class PreviewBrowser {
  private view: WebContentsView | null = null;
  private attached: BrowserWindow | null = null;
  private viewport: PreviewViewportId = 'desktop';
  private readonly events: PreviewEvent[] = [];
  private readonly receipts: PreviewDriveReceipt[] = [];
  private pending: PendingDrive | null = null;
  private lastPick: PreviewPick | null = null;
  private partition: string | null = null;
  private annotations = 0;
  private readonly configured = new Set<string>();
  private stateListener: ((state: BrowserState) => void) | null = null;

  constructor(private readonly settings: BrowserSettingsService) {}

  /**
   * The page navigates on its own — links, redirects, in-page routing — and the
   * toolbar has to follow. Without this the Back button stays disabled after a
   * link click, because the renderer only ever saw the state of its own last
   * command.
   */
  onState(listener: (state: BrowserState) => void): void {
    this.stateListener = listener;
  }

  /**
   * Per-profile session wiring. Registered once per partition: re-registering
   * would stack duplicate network listeners onto the same session and double
   * every console and request row in the evidence list.
   */
  private configureSession(partition: string): void {
    if (this.configured.has(partition)) return;
    const preview = session.fromPartition(partition);
    preview.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    preview.webRequest.onCompleted((details) => {
      this.pushEvent({
        kind: 'network',
        text: `${details.method} ${details.statusCode}`,
        url: redactPreviewUrl(details.url),
        status: details.statusCode,
        createdAt: utcNow(),
      });
    });
    this.configured.add(partition);
  }

  async handle(sender: WebContents, input: BrowserCommandInput): Promise<BrowserState> {
    const win = BrowserWindow.fromWebContents(sender);
    if (win === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'No window for preview');
    }
    switch (input.action) {
      case 'open':
        await this.open(win, input.url, input.bounds);
        break;
      case 'bounds':
        this.layout(win, input.bounds);
        break;
      case 'viewport':
        this.viewport = input.preset;
        this.layout(win, input.bounds);
        break;
      case 'hide':
        this.hide();
        break;
      case 'visible':
        this.requireView().setVisible(input.visible);
        break;
      case 'back':
        this.requireView().webContents.navigationHistory.goBack();
        break;
      case 'forward':
        this.requireView().webContents.navigationHistory.goForward();
        break;
      case 'reload':
        this.requireView().webContents.reload();
        break;
      case 'zoom':
        this.applyZoom(input.percent);
        break;
      case 'devtools': {
        // Detached so the inspector never steals room from the previewed
        // viewport, and always the page's own contents — never the app shell.
        const contents = this.requireView().webContents;
        if (contents.isDevToolsOpened()) contents.closeDevTools();
        else contents.openDevTools({ mode: 'detach' });
        break;
      }
      case 'external': {
        // A caller-supplied link (a terminal hyperlink) is honoured only after
        // the same http/https validation as the address bar; otherwise the
        // currently previewed page is what opens.
        const raw = input.url ?? this.view?.webContents.getURL() ?? '';
        const url = parsePreviewUrl(raw);
        if (url === null) {
          throw new BuilderHelmError(
            'VALIDATION_FAILED',
            'Only http and https URLs can open externally',
          );
        }
        await shell.openExternal(url);
        break;
      }
    }
    return this.state();
  }

  async snapshot(): Promise<PreviewSnapshot> {
    const view = this.requireView();
    const raw: unknown = await view.webContents.executeJavaScriptInIsolatedWorld(1001, [
      { code: SNAPSHOT_SCRIPT },
    ]);
    return {
      url: view.webContents.getURL(),
      viewport: this.viewport,
      nodes: buildPageSnapshot(raw),
    };
  }

  /**
   * Captures the preview, or nothing.
   *
   * Chromium refuses to rasterize a page it is not compositing, so a capture
   * taken while the window is occluded or minimised rejects. Evidence then
   * carries its metadata without a picture, which is strictly better than
   * failing the whole action and losing the note with it.
   */
  private async capture(rect?: PreviewRect): Promise<Uint8Array | null> {
    const view = this.requireView();
    try {
      const image =
        rect === undefined
          ? await view.webContents.capturePage()
          : await view.webContents.capturePage(rect);
      if (image.isEmpty()) return null;
      return new Uint8Array(image.toPNG());
    } catch {
      return null;
    }
  }

  async screenshot(): Promise<{
    url: string;
    viewport: PreviewViewportId;
    png: Uint8Array | null;
  }> {
    const view = this.requireView();
    return {
      url: view.webContents.getURL(),
      viewport: this.viewport,
      png: await this.capture(),
    };
  }

  async drive(input: {
    readonly action: PreviewDriveAction;
    readonly ref: string;
    readonly text?: string | undefined;
  }): Promise<PreviewDriveResult> {
    const view = this.requireView();
    const inspected: unknown = await view.webContents.executeJavaScriptInIsolatedWorld(
      1001,
      [{ code: inspectScript(input.ref) }],
    );
    if (typeof inspected !== 'object' || inspected === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', `Unknown ref ${input.ref}`);
    }
    const tag =
      'tag' in inspected && typeof inspected.tag === 'string' ? inspected.tag : '';
    const type =
      'type' in inspected && typeof inspected.type === 'string' ? inspected.type : '';
    const name =
      'name' in inspected && typeof inspected.name === 'string' ? inspected.name : '';
    const href =
      'href' in inspected && typeof inspected.href === 'string' ? inspected.href : '';
    const pageOrigin =
      'pageOrigin' in inspected && typeof inspected.pageOrigin === 'string'
        ? inspected.pageOrigin
        : '';
    const privileged = previewTargetNeedsApproval({ tag, type, name, href, pageOrigin });
    const text = input.text ?? '';
    const summary = `${input.action} ${input.ref}${name.length > 0 ? ` (${name})` : ''}`;
    if (privileged) {
      const approval: PreviewDriveApproval = {
        id: createId(),
        action: input.action,
        ref: input.ref,
        summary,
      };
      this.pending = {
        id: approval.id,
        action: input.action,
        ref: input.ref,
        text,
        summary,
      };
      return { kind: 'approval_required', approval };
    }
    return {
      kind: 'done',
      receipt: await this.runDrive(input.action, input.ref, text, false),
    };
  }

  async resolveDrive(id: string, allow: boolean): Promise<PreviewDriveResult> {
    const pending = this.pending;
    if (pending === null || pending.id !== id) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'No matching preview approval');
    }
    this.pending = null;
    if (!allow) {
      const receipt = this.recordReceipt(
        pending.action,
        pending.ref,
        pending.summary,
        true,
        'denied',
      );
      return { kind: 'done', receipt };
    }
    return {
      kind: 'done',
      receipt: await this.runDrive(pending.action, pending.ref, pending.text, true),
    };
  }

  listEvents(): PreviewEvent[] {
    return this.events.slice(-100);
  }

  listReceipts(): PreviewDriveReceipt[] {
    return this.receipts.slice(-100);
  }

  async pick(mode: PreviewToolMode): Promise<PreviewPick> {
    const view = this.requireView();
    const raw: unknown = await view.webContents.executeJavaScriptInIsolatedWorld(1001, [
      { code: pickScript(mode) },
    ]);
    if (typeof raw !== 'object' || raw === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Selection cancelled');
    }
    const locator =
      'locator' in raw && typeof raw.locator === 'string' && raw.locator.length > 0
        ? raw.locator.slice(0, 200)
        : 'html';
    const role =
      'role' in raw && typeof raw.role === 'string' ? raw.role.slice(0, 40) : 'unknown';
    const name =
      'name' in raw && typeof raw.name === 'string' ? raw.name.slice(0, 80) : '';
    const rect = readRect(raw);
    const png = await this.capture(rect);
    const pick: PreviewPick = {
      locator,
      role,
      name,
      rect,
      url: redactPreviewUrl(view.webContents.getURL()),
      viewport: this.viewport,
      pngBase64: png === null ? null : Buffer.from(png).toString('base64'),
    };
    this.lastPick = pick;
    return pick;
  }

  /** Pins the last selection and returns its evidence index. */
  async pinAnnotation(): Promise<{ readonly index: number; readonly pick: PreviewPick }> {
    const pick = this.lastPick;
    if (pick === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Select an element first');
    }
    const view = this.requireView();
    this.annotations += 1;
    const index = this.annotations;
    await view.webContents.executeJavaScriptInIsolatedWorld(1001, [
      { code: pinScript(index, pick.rect) },
    ]);
    return { index, pick };
  }

  lastPicked(): PreviewPick | null {
    return this.lastPick;
  }

  currentUrl(): string {
    if (this.view === null || this.view.webContents.isDestroyed()) return '';
    return this.view.webContents.getURL();
  }

  currentViewport(): PreviewViewportId {
    return this.viewport;
  }

  dispose(): void {
    this.hide();
    const view = this.view;
    this.view = null;
    this.partition = null;
    if (view !== null && !view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  }

  private async runDrive(
    action: PreviewDriveAction,
    ref: string,
    text: string,
    privileged: boolean,
  ): Promise<PreviewDriveReceipt> {
    const view = this.requireView();
    await view.webContents.executeJavaScriptInIsolatedWorld(1001, [
      { code: actScript(action, ref, text) },
    ]);
    return this.recordReceipt(action, ref, `${action} ${ref}`, privileged, 'done');
  }

  private recordReceipt(
    action: PreviewDriveAction,
    ref: string,
    summary: string,
    privileged: boolean,
    outcome: PreviewDriveReceipt['outcome'],
  ): PreviewDriveReceipt {
    const receipt: PreviewDriveReceipt = {
      id: createId(),
      action,
      ref,
      url: this.view?.webContents.getURL() ?? '',
      summary,
      privileged,
      outcome,
      createdAt: utcNow(),
    };
    this.receipts.push(receipt);
    if (this.receipts.length > 100) this.receipts.shift();
    return receipt;
  }

  private pushEvent(event: PreviewEvent): void {
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
  }

  private async open(
    win: BrowserWindow,
    raw: string,
    bounds: PreviewBounds,
  ): Promise<void> {
    const url = parsePreviewUrl(raw);
    if (url === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Only http and https URLs are allowed',
      );
    }
    const view = this.ensure(win);
    this.layout(win, bounds);
    await view.webContents.loadURL(url);
    this.applyZoom();
  }

  /**
   * Cookies and cache belong to the active profile's partition, and a partition
   * is fixed when the web contents is created. Switching profiles therefore
   * tears the view down rather than reusing it, which is also why the switch
   * has to happen before navigation instead of during it.
   */
  private ensure(win: BrowserWindow): WebContentsView {
    const partition = browserProfilePartition(this.settings.read().activeProfileId);
    if (this.view !== null && this.partition !== partition) this.dispose();
    if (this.view === null) {
      this.configureSession(partition);
      const view = new WebContentsView({
        webPreferences: { ...secureWebPreferences, partition },
      });
      view.setBackgroundColor('#070707');
      view.webContents.setWindowOpenHandler(({ url }) => {
        const allowed = parsePreviewUrl(url);
        if (allowed !== null) void view.webContents.loadURL(allowed);
        return { action: 'deny' };
      });
      view.webContents.on('will-navigate', (event, destination) => {
        if (parsePreviewUrl(destination) === null) event.preventDefault();
      });
      view.webContents.on('will-redirect', (event, destination) => {
        if (parsePreviewUrl(destination) === null) event.preventDefault();
      });
      // Injected pins and highlights die with the old document; the counter has
      // to follow them or the next pin claims a number nobody can see.
      view.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMain) => {
        if (isMain) this.annotations = 0;
      });
      const publish = (): void => {
        this.stateListener?.(this.state());
      };
      view.webContents.on('did-navigate', publish);
      view.webContents.on('did-navigate-in-page', publish);
      view.webContents.on('did-finish-load', publish);
      view.webContents.on(
        'console-message',
        (_event, level, message, _line, sourceId) => {
          if (level < 3) return;
          this.pushEvent({
            kind: 'console',
            text: message.slice(0, 400),
            url: redactPreviewUrl(sourceId),
            status: null,
            createdAt: utcNow(),
          });
        },
      );
      this.view = view;
      this.partition = partition;
    }
    if (this.attached !== win) {
      if (this.attached !== null) this.attached.contentView.removeChildView(this.view);
      win.contentView.addChildView(this.view);
      this.attached = win;
    }
    this.view.setVisible(true);
    return this.view;
  }

  /**
   * Fits the preset into the panel and then scales the page so it still
   * believes it has the preset's width.
   *
   * Letterboxing bounds alone is not a device preview: a 390px phone squeezed
   * into a 260px panel reports 260px to CSS, so the page picks a layout no
   * phone would ever show. Zoom compensation makes the reported viewport the
   * preset while what is drawn stays inside the panel; the user's zoom
   * preference multiplies on top.
   */
  private layout(win: BrowserWindow, bounds: PreviewBounds): void {
    const view = this.ensure(win);
    view.setBounds(letterbox(bounds, this.viewport));
    this.applyZoom();
  }

  /**
   * Zoom is the fit factor times the user's preference. Chromium keys zoom by
   * origin, so it is re-applied after every navigation instead of once at open.
   */
  private applyZoom(percent?: number): void {
    const view = this.requireView();
    const preset = PREVIEW_VIEWPORTS[this.viewport];
    const fit = Math.min(1, view.getBounds().width / preset.width);
    const wanted = percent ?? this.settings.read().zoomPercent;
    view.webContents.setZoomFactor(fit * (wanted / 100));
  }

  private hide(): void {
    if (this.attached !== null && this.view !== null) {
      this.attached.contentView.removeChildView(this.view);
    }
    this.attached = null;
  }

  private requireView(): WebContentsView {
    if (this.view === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Preview is not open');
    }
    return this.view;
  }

  private state(): BrowserState {
    if (this.view === null || this.view.webContents.isDestroyed()) {
      return { url: '', canGoBack: false, canGoForward: false, viewport: this.viewport };
    }
    return {
      url: this.view.webContents.getURL(),
      canGoBack: this.view.webContents.navigationHistory.canGoBack(),
      canGoForward: this.view.webContents.navigationHistory.canGoForward(),
      viewport: this.viewport,
    };
  }
}

function readRect(raw: object): PreviewRect {
  const source = 'rect' in raw && typeof raw.rect === 'object' ? raw.rect : null;
  const read = (key: 'x' | 'y' | 'width' | 'height', fallback: number): number => {
    if (source === null || !(key in source)) return fallback;
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.round(value))
      : fallback;
  };
  return {
    x: read('x', 0),
    y: read('y', 0),
    width: Math.max(1, read('width', 1)),
    height: Math.max(1, read('height', 1)),
  };
}

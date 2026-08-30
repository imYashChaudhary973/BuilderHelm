import { BrowserView, BrowserWindow, session, shell, type WebContents } from 'electron';

import {
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
  type PreviewSnapshot,
  type PreviewViewportId,
} from '@builderhelm/protocol/browser';
import { BuilderHelmError, createId, utcNow } from '@builderhelm/shared';

import { secureWebPreferences } from './security.js';

const previewPartition = 'persist:exeum-preview';

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

const PICK_SCRIPT = `(() => new Promise((resolve) => {
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener('click', onClick, true);
    const el = event.target && event.target.closest
      ? (event.target.closest('a,button,input,select,textarea,summary,[role]') || event.target)
      : event.target;
    const box = el.getBoundingClientRect();
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 80);
    resolve({
      role: (el.getAttribute('role') || el.tagName.toLowerCase()).slice(0, 40),
      name,
      html: String(el.outerHTML || '').slice(0, 500),
      box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) },
    });
  };
  document.addEventListener('click', onClick, true);
}))`;

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
  private view: BrowserView | null = null;
  private attached: BrowserWindow | null = null;
  private viewport: PreviewViewportId = 'desktop';
  private readonly events: PreviewEvent[] = [];
  private readonly receipts: PreviewDriveReceipt[] = [];
  private pending: PendingDrive | null = null;
  private lastPick: PreviewPick | null = null;
  private listening = false;
  private sessionConfigured = false;

  private configureSession(): void {
    if (this.sessionConfigured) return;
    const preview = session.fromPartition(previewPartition);
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
    this.sessionConfigured = true;
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
      case 'back':
        this.requireView().webContents.goBack();
        break;
      case 'forward':
        this.requireView().webContents.goForward();
        break;
      case 'reload':
        this.requireView().webContents.reload();
        break;
      case 'external': {
        const raw = this.view?.webContents.getURL() ?? '';
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

  async screenshot(): Promise<{
    url: string;
    viewport: PreviewViewportId;
    png: Uint8Array;
  }> {
    const view = this.requireView();
    const image = await view.webContents.capturePage();
    return {
      url: view.webContents.getURL(),
      viewport: this.viewport,
      png: new Uint8Array(image.toPNG()),
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

  async pick(): Promise<PreviewPick> {
    const view = this.requireView();
    const raw: unknown = await view.webContents.executeJavaScript(PICK_SCRIPT);
    if (typeof raw !== 'object' || raw === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Pick cancelled');
    }
    const role =
      'role' in raw && typeof raw.role === 'string' ? raw.role.slice(0, 40) : 'unknown';
    const name =
      'name' in raw && typeof raw.name === 'string' ? raw.name.slice(0, 80) : '';
    const html =
      'html' in raw && typeof raw.html === 'string' ? raw.html.slice(0, 500) : '';
    let pngBase64: string | null = null;
    if ('box' in raw && typeof raw.box === 'object' && raw.box !== null) {
      const box = raw.box;
      const x = 'x' in box && typeof box.x === 'number' ? box.x : 0;
      const y = 'y' in box && typeof box.y === 'number' ? box.y : 0;
      const width = 'width' in box && typeof box.width === 'number' ? box.width : 1;
      const height = 'height' in box && typeof box.height === 'number' ? box.height : 1;
      const image = await view.webContents.capturePage();
      const crop = image.crop({
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(1, width),
        height: Math.max(1, height),
      });
      pngBase64 = crop.toPNG().toString('base64');
    }
    const pick = { role, name, html, pngBase64 };
    this.lastPick = pick;
    return pick;
  }

  lastPicked(): PreviewPick | null {
    return this.lastPick;
  }

  dispose(): void {
    this.hide();
    const view = this.view;
    this.view = null;
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
  }

  private ensure(win: BrowserWindow): BrowserView {
    if (this.view === null) {
      this.configureSession();
      const view = new BrowserView({
        webPreferences: {
          ...secureWebPreferences,
          partition: previewPartition,
        },
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
      this.view = view;
    }
    if (!this.listening && this.view !== null) {
      this.listening = true;
      this.view.webContents.on(
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
    }
    if (this.attached !== win) {
      this.attached?.removeBrowserView(this.view);
      win.addBrowserView(this.view);
      this.attached = win;
    }
    return this.view;
  }

  private layout(win: BrowserWindow, bounds: PreviewBounds): void {
    const view = this.ensure(win);
    view.setBounds(letterbox(bounds, this.viewport));
  }

  private hide(): void {
    if (this.attached !== null && this.view !== null) {
      this.attached.removeBrowserView(this.view);
    }
    this.attached = null;
  }

  private requireView(): BrowserView {
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

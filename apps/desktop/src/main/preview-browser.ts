import { BrowserView, BrowserWindow, session, type WebContents } from 'electron';

import {
  parsePreviewUrl,
  type BrowserCommandInput,
  type BrowserState,
  type PreviewBounds,
} from '@zero/protocol/browser';
import { ZeroError } from '@zero/shared';

import { secureWebPreferences } from './security.js';

const previewPartition = 'persist:exeum-preview';

export class PreviewBrowser {
  private view: BrowserView | null = null;
  private attached: BrowserWindow | null = null;

  constructor() {
    const preview = session.fromPartition(previewPartition);
    preview.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
  }

  async handle(sender: WebContents, input: BrowserCommandInput): Promise<BrowserState> {
    const win = BrowserWindow.fromWebContents(sender);
    if (win === null) {
      throw new ZeroError('VALIDATION_FAILED', 'No window for preview');
    }
    switch (input.action) {
      case 'open':
        await this.open(win, input.url, input.bounds);
        break;
      case 'bounds':
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
    }
    return this.state();
  }

  dispose(): void {
    this.hide();
    const view = this.view;
    this.view = null;
    if (view !== null && !view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  }

  private async open(win: BrowserWindow, raw: string, bounds: PreviewBounds): Promise<void> {
    const url = parsePreviewUrl(raw);
    if (url === null) {
      throw new ZeroError('VALIDATION_FAILED', 'Only http and https URLs are allowed');
    }
    const view = this.ensure(win);
    this.layout(win, bounds);
    await view.webContents.loadURL(url);
  }

  private ensure(win: BrowserWindow): BrowserView {
    if (this.view === null) {
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
    if (this.attached !== win) {
      this.attached?.removeBrowserView(this.view);
      win.addBrowserView(this.view);
      this.attached = win;
    }
    return this.view;
  }

  private layout(win: BrowserWindow, bounds: PreviewBounds): void {
    const view = this.ensure(win);
    view.setBounds(bounds);
  }

  private hide(): void {
    if (this.attached !== null && this.view !== null) {
      this.attached.removeBrowserView(this.view);
    }
    this.attached = null;
  }

  private requireView(): BrowserView {
    if (this.view === null) {
      throw new ZeroError('VALIDATION_FAILED', 'Preview is not open');
    }
    return this.view;
  }

  private state(): BrowserState {
    if (this.view === null || this.view.webContents.isDestroyed()) {
      return { url: '', canGoBack: false, canGoForward: false };
    }
    return {
      url: this.view.webContents.getURL(),
      canGoBack: this.view.webContents.navigationHistory.canGoBack(),
      canGoForward: this.view.webContents.navigationHistory.canGoForward(),
    };
  }
}

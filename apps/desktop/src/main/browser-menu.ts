import { join } from 'node:path';

import { BrowserWindow, ipcMain } from 'electron';

import {
  browserMenuPayloadSchema,
  browserMenuPickSchema,
  type BrowserMenuInput,
  type BrowserMenuPayload,
  type BrowserMenuResult,
  type BrowserSettings,
  type PreviewOrigin,
  type PreviewViewportId,
} from '@builderhelm/protocol/browser';
import { ipcChannels } from '@builderhelm/protocol/ipc';

import { isAllowedNavigation, secureWebPreferences } from './security.js';

export interface BrowserMenuState {
  readonly origins: readonly PreviewOrigin[];
  readonly settings: BrowserSettings;
  readonly viewport: PreviewViewportId;
}

const MENU_WIDTH = 268;
const MENU_HEIGHT = 248;

function payloadOf(
  kind: BrowserMenuInput['kind'],
  state: BrowserMenuState,
): BrowserMenuPayload {
  return browserMenuPayloadSchema.parse({
    kind,
    origins: state.origins,
    settings: state.settings,
    viewport: state.viewport,
  });
}

function loadPopup(popup: BrowserWindow): Promise<void> {
  const ready = new Promise<void>((resolve) => {
    popup.webContents.once('did-finish-load', () => resolve());
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void popup.loadURL(`${process.env.ELECTRON_RENDERER_URL}#browser-popup`);
  } else {
    void popup.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: 'browser-popup',
    });
  }
  return ready;
}

/**
 * Toolbar menus are a child window for a structural reason: the embedded page
 * is a child view composited above the renderer, so an HTML popover anchored in
 * the toolbar is painted behind the page and becomes unclickable.
 *
 * Items are built from main-process state — real mapped ports, the real profile
 * list — so the renderer cannot inject a target by asking for a menu.
 */
export async function popupBrowserMenu(
  win: BrowserWindow,
  input: BrowserMenuInput,
  state: BrowserMenuState,
): Promise<BrowserMenuResult> {
  const { promise, resolve } = Promise.withResolvers<BrowserMenuResult>();
  let settled = false;
  const finish = (choice: string | null): void => {
    if (settled) return;
    settled = true;
    if (!popup.isDestroyed()) popup.close();
    resolve({ choice });
  };

  const content = win.getContentBounds();
  let x = Math.round(content.x + input.x);
  let y = Math.round(content.y + input.y);
  if (x + MENU_WIDTH > content.x + content.width - 8) {
    x = Math.round(content.x + content.width - MENU_WIDTH - 8);
  }
  if (y + MENU_HEIGHT > content.y + content.height - 8) {
    y = Math.round(content.y + input.y - MENU_HEIGHT - 8);
  }

  const popup = new BrowserWindow({
    parent: win,
    modal: false,
    frame: false,
    show: false,
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    x,
    y,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    roundedCorners: true,
    webPreferences: {
      ...secureWebPreferences,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });
  popup.setWindowButtonVisibility(false);
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popup.webContents.on('will-navigate', (event, destinationUrl) => {
    if (!isAllowedNavigation(popup.webContents.getURL(), destinationUrl)) {
      event.preventDefault();
    }
  });

  const onPick = (event: Electron.IpcMainInvokeEvent, raw: unknown): { ok: true } => {
    if (event.sender === popup.webContents) {
      const parsed = browserMenuPickSchema.safeParse(raw);
      finish(parsed.success ? parsed.data.choice : null);
    }
    return { ok: true };
  };
  ipcMain.removeHandler(ipcChannels.browserMenuPick);
  ipcMain.handle(ipcChannels.browserMenuPick, onPick);
  popup.on('blur', () => finish(null));
  popup.on('closed', () => {
    ipcMain.removeHandler(ipcChannels.browserMenuPick);
    finish(null);
  });

  await loadPopup(popup);
  if (popup.isDestroyed() || settled) return promise;
  popup.webContents.send(ipcChannels.browserMenuPayload, payloadOf(input.kind, state));
  popup.show();
  popup.focus();
  return promise;
}

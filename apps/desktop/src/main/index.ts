import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrapCore, type CoreRuntime } from '@zero/core';
import { createCorrelationId } from '@zero/shared';
import { app, BrowserWindow, session } from 'electron';

import { registerIpcHandlers } from './ipc.js';
import { BoardPtyManager, probePty } from './board-pty-manager.js';
import { KeyringSecretStore } from './keyring-secret-store.js';
import { buildContentSecurityPolicy, secureWebPreferences } from './security.js';

let core: CoreRuntime | undefined;
let unregisterIpc: (() => void) | undefined;
let boardPty: BoardPtyManager | undefined;
let smokeDatabasePath: string | undefined;

function isAllowedNavigation(currentUrl: string, destinationUrl: string): boolean {
  try {
    return new URL(currentUrl).origin === new URL(destinationUrl).origin;
  } catch {
    return false;
  }
}

async function completeSmokeWhenRendererIsReady(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 10_000;
  let rendererStatus: unknown = 'missing';

  while (Date.now() < deadline) {
    rendererStatus = await window.webContents.executeJavaScript(
      `document.querySelector('[data-core-status]')?.getAttribute('data-core-status') ?? 'missing'`,
      true,
    );
    if (rendererStatus === 'ready') {
      core?.logger.info({
        event: 'desktop.smoke_ready',
        correlationId: createCorrelationId(),
      });
      app.quit();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  core?.logger.error({
    event: 'desktop.smoke_failed',
    correlationId: createCorrelationId(),
    data: { reason: 'renderer health did not become ready', rendererStatus },
  });
  process.exitCode = 1;
  app.quit();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#10120f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      ...secureWebPreferences,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.ZERO_SMOKE_TEST === '1') {
    window.webContents.on('preload-error', (_event, _preloadPath, error) => {
      core?.logger.error({
        event: 'desktop.preload_failed',
        correlationId: createCorrelationId(),
        data: { error },
      });
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      core?.logger.error({
        event: 'desktop.renderer_load_failed',
        correlationId: createCorrelationId(),
        data: { errorCode, errorDescription },
      });
    });
  }

  window.webContents.on('will-navigate', (event, destinationUrl) => {
    if (!isAllowedNavigation(window.webContents.getURL(), destinationUrl)) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (process.env.ZERO_SMOKE_TEST !== '1') {
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
  }

  if (process.env.ZERO_SMOKE_TEST === '1') {
    window.webContents.once('did-finish-load', () => {
      void completeSmokeWhenRendererIsReady(window).catch((error: unknown) => {
        core?.logger.error({
          event: 'desktop.smoke_failed',
          correlationId: createCorrelationId(),
          data: { error },
        });
        process.exitCode = 1;
        app.quit();
      });
    });
  }

  return window;
}

// Dev affordance: ZERO_DEBUG_PORT=<port> exposes a CDP endpoint so external
// tooling can attach to the renderer. No effect unless the variable is set.
if (process.env.ZERO_DEBUG_PORT !== undefined) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ZERO_DEBUG_PORT);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          buildContentSecurityPolicy({
            dev: Boolean(process.env.ELECTRON_RENDERER_URL),
          }),
        ],
      },
    });
  });

  const databasePath =
    process.env.ZERO_SMOKE_TEST === '1'
      ? join(app.getPath('temp'), `zero-os-smoke-${process.pid}.sqlite`)
      : join(app.getPath('userData'), 'zero.sqlite');
  smokeDatabasePath = process.env.ZERO_SMOKE_TEST === '1' ? databasePath : undefined;
  core = bootstrapCore({ databasePath, secretStore: new KeyringSecretStore() });
  boardPty = new BoardPtyManager();
  if (process.env.ZERO_PTY_PROBE !== undefined && process.env.ZERO_PTY_PROBE.length > 0) {
    core.logger.info({
      event: 'pty.probe',
      correlationId: createCorrelationId(),
      data: { result: probePty(process.env.ZERO_PTY_PROBE) },
    });
  }
  unregisterIpc = registerIpcHandlers(core, boardPty);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  unregisterIpc?.();
  unregisterIpc = undefined;
  boardPty?.dispose();
  boardPty = undefined;
  core?.close();
  core = undefined;
  if (smokeDatabasePath !== undefined) {
    rmSync(smokeDatabasePath, { force: true });
    smokeDatabasePath = undefined;
  }
});

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrapCore, type CoreRuntime } from '@zero/core';
import { ipcChannels } from '@zero/protocol';
import { createCorrelationId } from '@zero/shared';
import { app, BrowserWindow, session } from 'electron';

import { EngineClient } from './engine-client.js';
import { registerIpcHandlers } from './ipc.js';
import { BoardPtyManager, probePty } from './board-pty-manager.js';
import { PtySwarmRunner } from './swarm-runner.js';
import { KeyringSecretStore } from './keyring-secret-store.js';
import { buildContentSecurityPolicy, secureWebPreferences } from './security.js';

let core: CoreRuntime | undefined;
let unregisterIpc: (() => void) | undefined;
let boardPty: BoardPtyManager | undefined;
let swarmRunner: PtySwarmRunner | undefined;
let smokeDatabasePath: string | undefined;
let engine: EngineClient | undefined;

/**
 * Start the Rust engine sidecar if this build ships one.
 *
 * Phase A stands the bridge up and verifies it; every channel still runs on
 * its TypeScript handler, so a missing binary is not a failure - it means the
 * engine has not been built in this checkout. Phase C moves namespaces onto
 * the engine one at a time, and from then on its absence is fatal.
 */
async function startEngine(runtime: CoreRuntime): Promise<void> {
  const bin = process.env.HELM_ENGINE_BIN;
  if (bin === undefined || bin.length === 0) return;
  const client = new EngineClient({
    bin,
    expectedChannels: Object.values(ipcChannels),
    onLog: (line) => {
      runtime.logger.info({
        event: 'engine.log',
        correlationId: createCorrelationId(),
        data: { line },
      });
    },
  });
  try {
    const hello = await client.start();
    engine = client;
    runtime.logger.info({
      event: 'engine.ready',
      correlationId: createCorrelationId(),
      // `events` is who owns push channels. Zero means TypeScript still does,
      // which is what phase B changes for the PTY.
      data: {
        engine: hello.engine,
        host: hello.host,
        channels: hello.channels.length,
        events: hello.events.length,
      },
    });
  } catch (error) {
    // Fail closed on the engine, not on the app: the TypeScript handlers are
    // still serving every channel in phase A.
    runtime.logger.error({
      event: 'engine.unavailable',
      correlationId: createCorrelationId(),
      data: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
}

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
      app.exit(0);
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

  const syncFullscreen = (): void => {
    const on = window.isFullScreen();
    void window.webContents.executeJavaScript(
      on
        ? `document.documentElement.classList.add('is-fullscreen')`
        : `document.documentElement.classList.remove('is-fullscreen')`,
    );
  };
  window.on('enter-full-screen', syncFullscreen);
  window.on('leave-full-screen', syncFullscreen);
  window.webContents.on('did-finish-load', syncFullscreen);

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

app.whenReady().then(async () => {
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
      : (process.env.ZERO_DATABASE_PATH ?? join(app.getPath('userData'), 'zero.sqlite'));
  smokeDatabasePath = process.env.ZERO_SMOKE_TEST === '1' ? databasePath : undefined;
  boardPty = new BoardPtyManager();
  swarmRunner = new PtySwarmRunner(boardPty);
  core = bootstrapCore({
    databasePath,
    secretStore: new KeyringSecretStore(),
    swarmRunner,
  });
  if (process.env.ZERO_PTY_PROBE !== undefined && process.env.ZERO_PTY_PROBE.length > 0) {
    core.logger.info({
      event: 'pty.probe',
      correlationId: createCorrelationId(),
      data: { result: probePty(process.env.ZERO_PTY_PROBE) },
    });
  }
  unregisterIpc = registerIpcHandlers(core, boardPty, swarmRunner);
  // The smoke test asserts on the engine's log line, so it waits for the
  // handshake to settle. A normal launch does not: phase A keeps every
  // channel on its TypeScript handler, so the window must not sit behind a
  // process spawn it does not yet depend on.
  const engineStarted = startEngine(core);
  if (process.env.ZERO_SMOKE_TEST === '1') {
    await engineStarted;
  }
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
  void engine?.stop();
  engine = undefined;
  core?.close();
  core = undefined;
  if (smokeDatabasePath !== undefined) {
    rmSync(smokeDatabasePath, { force: true });
    smokeDatabasePath = undefined;
  }
});

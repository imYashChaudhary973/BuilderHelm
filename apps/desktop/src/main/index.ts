import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrapCore, type CoreRuntime } from '@builderhelm/core';
import { createCorrelationId, normalizeError } from '@builderhelm/shared';
import { app, BrowserWindow, dialog, session } from 'electron';

import { registerIpcHandlers } from './ipc.js';
import { BoardPtyManager, probePty } from './board-pty-manager.js';
import { PtySwarmRunner } from './swarm-runner.js';
import { KeyringSecretStore } from './keyring-secret-store.js';
import { installApplicationMenu } from './legal-menu.js';
import { buildContentSecurityPolicy, secureWebPreferences } from './security.js';

let core: CoreRuntime | undefined;
let unregisterIpc: (() => void) | undefined;
let boardPty: BoardPtyManager | undefined;
let swarmRunner: PtySwarmRunner | undefined;
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
  if (process.env.BUILDERHELM_SMOKE_TEST === '1') {
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

  if (process.env.BUILDERHELM_SMOKE_TEST !== '1') {
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
  }

  if (process.env.BUILDERHELM_SMOKE_TEST === '1') {
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

// Dev affordance: BUILDERHELM_DEBUG_PORT=<port> exposes a CDP endpoint so external
// tooling can attach to the renderer. No effect unless the variable is set.
if (process.env.BUILDERHELM_DEBUG_PORT !== undefined) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.BUILDERHELM_DEBUG_PORT,
  );
}

/**
 * Startup must fail closed and visibly.
 *
 * Bootstrap opens the database, runs migrations, and resolves credential
 * storage. Any of those can fail for a reason the user has to act on: a
 * database written by an incompatible build, an unwritable path, or a missing
 * OS keyring. Without this the rejection is silent and leaves a running
 * process with no window and no stated reason.
 */
function reportStartupFailure(error: unknown): void {
  const failure = normalizeError(error, 'INTERNAL_ERROR');
  const guidance =
    failure.code === 'MIGRATION_FAILED'
      ? 'This local database was created by an incompatible version of BuilderHelm. Move it aside, or point BUILDERHELM_DATABASE_PATH at a new file.'
      : failure.message;
  process.stderr.write(`desktop.startup_failed ${failure.code}: ${failure.message}\n`);
  // The stderr line above is the unattended path. A modal blocks until someone
  // dismisses it, which would hang the smoke harness or a CI job rather than
  // failing fast. Deliberately not keyed on TTY: a packaged app has no TTY and
  // is exactly when the dialog is needed.
  const unattended =
    process.env.BUILDERHELM_SMOKE_TEST === '1' || process.env.CI !== undefined;
  if (!unattended) {
    dialog.showErrorBox('BuilderHelm could not start', guidance);
  }
  app.exit(1);
}
/**
 * Reclaims pane worktrees left behind by a run that never shut down cleanly.
 *
 * Repositories come from the registered projects and from saved worktree
 * presets, which is every folder the product itself knows about. A worktree
 * holding uncommitted work is reported and kept, because a crash is exactly
 * when that work is most likely to be the only copy.
 */
async function recoverOrphanedWorktrees(runtime: CoreRuntime): Promise<void> {
  const correlationId = createCorrelationId();
  const roots = new Set<string>(runtime.projects.listRepositoryRoots());
  for (const preset of runtime.board.listPresets()) {
    if (preset.isolation === 'worktree') roots.add(preset.folderPath);
  }
  for (const root of roots) {
    try {
      await runtime.board.reconcilePaneWorktrees(root, [], correlationId);
    } catch (error) {
      runtime.logger.warn({
        event: 'board.worktree_recovery_failed',
        correlationId,
        data: { root, error: normalizeError(error).message },
      });
    }
  }
}

app
  .whenReady()
  .then(() => {
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
      process.env.BUILDERHELM_SMOKE_TEST === '1'
        ? join(app.getPath('temp'), `builderhelm-smoke-${process.pid}.sqlite`)
        : (process.env.BUILDERHELM_DATABASE_PATH ??
          join(app.getPath('userData'), 'builderhelm.sqlite'));
    smokeDatabasePath =
      process.env.BUILDERHELM_SMOKE_TEST === '1' ? databasePath : undefined;
    boardPty = new BoardPtyManager();
    swarmRunner = new PtySwarmRunner(boardPty);
    core = bootstrapCore({
      databasePath,
      secretStore: new KeyringSecretStore(),
      swarmRunner,
    });
    if (
      process.env.BUILDERHELM_PTY_PROBE !== undefined &&
      process.env.BUILDERHELM_PTY_PROBE.length > 0
    ) {
      core.logger.info({
        event: 'pty.probe',
        correlationId: createCorrelationId(),
        data: { result: probePty(process.env.BUILDERHELM_PTY_PROBE) },
      });
    }
    unregisterIpc = registerIpcHandlers(core, boardPty, swarmRunner);
    installApplicationMenu();
    createWindow();
    // No session is live yet, so any pane worktree still on disk was left by a
    // crashed or killed run. Deliberately not awaited: recovery shells out to
    // git per repository and must not delay the window.
    void recoverOrphanedWorktrees(core);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch(reportStartupFailure);

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

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { bootstrapCore, type CoreRuntime } from '@builderhelm/core';
import { ipcChannels } from '@builderhelm/protocol/ipc';
import { createCorrelationId, normalizeError } from '@builderhelm/shared';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  nativeImage,
  session,
} from 'electron';

import { registerIpcHandlers } from './ipc.js';
import { BoardPtyManager, probePty, setExtraTerminalEnv } from './board-pty-manager.js';
import { PtySwarmRunner } from './swarm-runner.js';
import { KeyringSecretStore } from './keyring-secret-store.js';
import { VoiceModelManager } from './voice-models.js';
import { VoiceRuntime } from './voice-runtime.js';
import { VoiceHotkeys } from './voice-hotkeys.js';
import { installApplicationMenu } from './legal-menu.js';
import {
  installClaudeStatusLine,
  startQuotaIngest,
  uninstallClaudeStatusLine,
} from './quota-ingest.js';
import {
  buildContentSecurityPolicy,
  buildElementsHostPolicy,
  ELEMENTS_HOST_PATH,
  isAllowedNavigation,
  secureWebPreferences,
} from './security.js';
import type { NoSleepState } from '@builderhelm/protocol/no-sleep';
import type { AuthState } from '@builderhelm/protocol/auth';
import { PowerController } from './no-sleep.js';
import { AuthHandoff } from './auth-handoff.js';
import { AgentManager } from './acp/manager.js';
import { PermissionRules } from './acp/permission-rules.js';
import { AgentRegistry } from './acp/registry.js';
import { createRuntimeCapabilityService } from './runtime-capabilities.js';
import { AgentProfiles } from './acp/profiles.js';
import { AgentThreads } from './acp/threads.js';
import { UsageWorkerClient } from './usage-worker-client.js';

let core: CoreRuntime | undefined;
let usageWorker: UsageWorkerClient | undefined;
let unregisterIpc: (() => void) | undefined;
let boardPty: BoardPtyManager | undefined;
let swarmRunner: PtySwarmRunner | undefined;
let powerController: PowerController | undefined;
let agentManager: AgentManager | null = null;
let authHandoff: AuthHandoff | undefined;
let unsubscribeWork: (() => void) | undefined;
let voiceHotkeys: VoiceHotkeys | undefined;
let quotaIngest: { scriptPath(): string | null; close(): void } | undefined;
let smokeDatabasePath: string | undefined;
let scheduleTimer: ReturnType<typeof setInterval> | undefined;
// A packaged app always loads its own renderer, even if a shell inherited
// the dev-server environment variable.
const developmentRendererUrl = app.isPackaged
  ? undefined
  : process.env.ELECTRON_RENDERER_URL;

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

function applyAppIcon(): void {
  const path = join(__dirname, '../../resources/icon.png');
  if (!existsSync(path)) return;
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return;
  if (process.platform === 'darwin') app.dock?.setIcon(image);
}

function createWindow(): BrowserWindow {
  const icon = join(__dirname, '../../resources/icon.png');
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Matches the status bar the shell paints at the bottom edge, so a strip
    // the web contents has not painted yet (resize, first frame) reads as the
    // bar continuing rather than a seam of a different colour.
    backgroundColor: '#0c0c0c',
    titleBarStyle: 'hiddenInset',
    // A 52px bar with the lights mathematically centered in it, so windowed
    // view reads like the reference app rather than lights hugging the top.
    trafficLightPosition: { x: 16, y: 18 },
    ...(existsSync(icon) ? { icon } : {}),
    webPreferences: {
      ...secureWebPreferences,
      preload: join(__dirname, '../preload/index.cjs'),
    },
  });

  // Chromium zoom on the shell desyncs the embedded preview's bounds. Keep
  // the chrome at 1x; View → Zoom In targets the preview page instead.
  void window.webContents.setVisualZoomLevelLimits(1, 1);
  window.webContents.setZoomFactor(1);

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    core?.logger.error({
      event: 'desktop.preload_failed',
      correlationId: createCorrelationId(),
      data: { error: error instanceof Error ? error.message : String(error) },
    });
  });
  if (process.env.BUILDERHELM_SMOKE_TEST === '1') {
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

  if (developmentRendererUrl) {
    void window.loadURL(developmentRendererUrl);
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
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(1);
    syncFullscreen();
  });

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
    applyAppIcon();
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        callback(permission === 'media');
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (_webContents, permission) => permission === 'media',
    );

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // The launch animation's frame runs a vendored document with inline
      // shaders, so it gets its own tighter-but-inline-allowing policy. Every
      // other response carries the shell policy.
      const policy = details.url.split('?')[0]?.endsWith(ELEMENTS_HOST_PATH)
        ? buildElementsHostPolicy()
        : buildContentSecurityPolicy({
            dev: Boolean(developmentRendererUrl),
          });
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [policy],
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
    const voiceModels = new VoiceModelManager(
      join(app.getPath('userData'), 'voice-models'),
    );
    const voiceRuntime = new VoiceRuntime(voiceModels);
    voiceHotkeys = new VoiceHotkeys({
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => {
        globalShortcut.unregister(accelerator);
      },
      broadcastPress: () => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(ipcChannels.voiceHotkey, { type: 'press' });
          }
        }
      },
    });
    core = bootstrapCore({
      databasePath,
      secretStore: new KeyringSecretStore(),
      swarmRunner,
      voiceInventory: voiceModels,
      accountsRoot: join(app.getPath('userData'), 'accounts'),
    });
    // Built after core (needs core.noSleep). The work edges from the swarm
    // and chat streaming drive Agent mode through it.
    const runtime = core;
    const power = new PowerController(runtime.noSleep, runtime.logger);
    powerController = power;
    const syncPower = (): NoSleepState => {
      const state = power.sync();
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(ipcChannels.noSleepEvent, state);
        }
      }
      return state;
    };
    unsubscribeWork = runtime.swarm.onWorkChanged(() => {
      runtime.noSleep.setAgentActive(runtime.swarm.isWorking());
      syncPower();
    });
    syncPower();
    const pushAuth = (state: AuthState): void => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send(ipcChannels.authEvent, state);
      }
    };
    authHandoff = new AuthHandoff(runtime.auth, pushAuth);
    void authHandoff.restore().then(pushAuth);

    // Agent chat. The registry reads and writes settings; the manager owns the
    // live sessions and needs a way to reach the renderer, since a permission
    // request has to be answered by a person.
    const agentRegistry = new AgentRegistry(runtime.settings);
    const runtimeCapabilities = createRuntimeCapabilityService(agentRegistry);
    const agentProfiles = new AgentProfiles(runtime.settings);
    agentManager = new AgentManager({
      emit: (event) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) continue;
          window.webContents.send(ipcChannels.agentEvent, event);
        }
      },
      rules: new PermissionRules(runtime.settings),
      threads: new AgentThreads(runtime.settings),
      resolveAgent: (agentId) => agentRegistry.resolve(agentId),
      resolveProfile: (profileId) => agentProfiles.find(profileId),
      resolveLaunch: (agentId, accountRef) =>
        core?.accounts.launchFor(agentId, accountRef) ?? { env: {}, accountRef: null },
    });
    setExtraTerminalEnv(() => core?.accounts.cliEnv() ?? {});
    const hookClaude = (): void => {
      const script = quotaIngest?.scriptPath();
      if (script === null || script === undefined) return;
      for (const target of core?.accounts.claudeHookTargets() ?? []) {
        installClaudeStatusLine(target.configRoot, script, target.accountRef);
      }
      // Consent off: give folders BuilderHelm did not create their previous
      // statusLine back. A statusLine BuilderHelm never wrote is left alone.
      if (core?.accounts.hookSystemDefault() === false) {
        for (const root of core.accounts.claudeOwnedRoots()) {
          uninstallClaudeStatusLine(root);
        }
      }
    };
    if (process.env.BUILDERHELM_SMOKE_TEST !== '1') {
      quotaIngest = startQuotaIngest({
        userData: app.getPath('userData'),
        ingestClaude: (accountRef, payload) =>
          core?.accounts.ingestClaude(accountRef, payload) ?? null,
        onReady: hookClaude,
      });
    }
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
    usageWorker = new UsageWorkerClient(
      join(__dirname, 'usage-worker.js'),
      databasePath,
      () => core?.accounts.logins() ?? [],
    );
    unregisterIpc = registerIpcHandlers(
      core,
      boardPty,
      swarmRunner,
      {
        models: voiceModels,
        runtime: voiceRuntime,
        onSettings: (settings) => voiceHotkeys?.sync(settings),
      },
      hookClaude,
      syncPower,
      (active) => {
        runtime.noSleep.setAgentActive(active || runtime.swarm.isWorking());
        syncPower();
      },
      authHandoff,
      { manager: agentManager, registry: agentRegistry, profiles: agentProfiles },
      { capabilities: runtimeCapabilities },
      (input) => usageWorker!.report(input),
    );
    void core.schedules.reconcile(createCorrelationId());
    scheduleTimer = setInterval(() => {
      void core?.schedules.tick(createCorrelationId());
    }, 30_000);
    setTimeout(hookClaude, 400);
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
  if (scheduleTimer !== undefined) {
    clearInterval(scheduleTimer);
    scheduleTimer = undefined;
  }
  voiceHotkeys?.dispose();
  voiceHotkeys = undefined;
  quotaIngest?.close();
  quotaIngest = undefined;
  authHandoff?.close();
  authHandoff = undefined;
  // Agents are child processes. Not awaited, because before-quit must not
  // block, but SIGTERM goes out now so they do not outlive the app.
  void agentManager?.closeAll();
  agentManager = null;
  unregisterIpc?.();
  unregisterIpc = undefined;
  unsubscribeWork?.();
  unsubscribeWork = undefined;
  // The OS keeps a power assertion alive after the process leaves unless it
  // is stopped, so this runs before the window tears down.
  powerController?.dispose();
  powerController = undefined;
  boardPty?.dispose();
  boardPty = undefined;
  usageWorker?.close();
  usageWorker = undefined;
  core?.close();
  core = undefined;
  if (smokeDatabasePath !== undefined) {
    rmSync(smokeDatabasePath, { force: true });
    smokeDatabasePath = undefined;
  }
});

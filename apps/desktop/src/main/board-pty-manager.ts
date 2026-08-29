import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  BOARD_WORKTREE_BRANCH_PREFIX,
  boardAgentCatalogEntry,
  boardPaneEventEnvelopeSchema,
  ipcChannels,
  type BoardAgentId,
  type BoardCreateInput,
  type BoardIsolation,
  type BoardPaneArgv,
  type BoardPaneAckInput,
  type BoardPaneCloseInput,
  type BoardPaneDrainInput,
  type BoardPaneEvent,
  type BoardPaneStatus,
  type BoardPaneSummary,
  type BoardPaneWriteInput,
  type BoardPaneResizeInput,
  type BoardSessionSummary,
} from '@builderhelm/protocol';
import { BuilderHelmError } from '@builderhelm/shared';
import { Notification, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';

import { scanStartupChunk } from './startup-ack.js';

const execFileAsync = promisify(execFile);

interface PaneMeta {
  slot: number;
  agentId: BoardAgentId;
  title: string;
  status: BoardPaneStatus;
  branch: string | null;
  cwd: string;
  output: string;
  /**
   * Total characters this pane has ever produced. Monotonic, so it keeps
   * meaning after `output` is trimmed, and lets a reconnecting renderer line
   * live chunks up against the drain snapshot.
   */
  emitted: number;
  startupTail: string;
  /** Stream offset already handed to the renderer. */
  sent: number;
  /** Stream offset the renderer reports it has finished writing. */
  ackedOffset: number;
  /** Whether this renderer acknowledges at all; benchmarks and probes do not. */
  ackSeen: boolean;
  paused: boolean;
  pendingData: string;
  flushTimer: NodeJS.Timeout | null;
  acked: Set<string>;
  pty: IPty | null;
}

interface SessionRecord {
  sender: WebContents;
  folderPath: string;
  isolation: BoardIsolation;
  worktreeTag: string;
  panes: Map<string, PaneMeta>;
}

const maxBufferedChars = 80_000;

const outputBatchDelayMs = 8;
// A single `yes` measured about 85 MiB/s at the renderer, which no terminal can
// parse in real time. Above the high mark the PTY is paused so the writing
// process blocks on its tty; nothing is dropped and no escape sequence is torn.
const inFlightHighWaterChars = 2 * 1024 * 1024;
const inFlightLowWaterChars = 512 * 1024;
// The data event caps `data` at 1,000,000 characters and base64 inflates by 4/3,
// so a single oversized PTY chunk would otherwise fail validation mid-stream.
const maxEventChars = 700_000;
const maxPendingDataChars = 64 * 1024;

function resolveCommand(agentId: BoardAgentId, override: string | undefined): string {
  if (agentId === 'shell') return '';
  const command = override ?? boardAgentCatalogEntry(agentId).command;
  if (command.length === 0) {
    throw new BuilderHelmError('VALIDATION_FAILED', `Unknown board agent ${agentId}`);
  }
  if (agentId === 'gemini') return `${command} --skip-trust`;
  return command;
}

function terminalEnv(): Record<string, string> {
  return {
    ...process.env,
    HOME: process.env.HOME ?? homedir(),
    USER: process.env.USER ?? '',
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
    SHELL: '/bin/zsh',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    PATH:
      process.env.PATH ??
      '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    PWD: process.env.PWD ?? homedir(),
  };
}

function resolveWorkdir(cwd: string): string {
  try {
    const resolved = realpathSync(cwd);
    if (statSync(resolved).isDirectory()) return resolved;
  } catch {
    // fall through to home
  }
  return homedir();
}

function spawnHelperPath(): string {
  const require = createRequire(import.meta.url);
  const unix = require.resolve('node-pty/lib/unixTerminal.js');
  return resolve(dirname(unix), '../build/Release/spawn-helper');
}

function ensureHelper(): string {
  const helper = spawnHelperPath();
  if (existsSync(helper)) {
    try {
      chmodSync(helper, 0o755);
    } catch {
      // ignore
    }
  }
  return helper;
}

function spawnArgvPty(
  cwd: string,
  argv: BoardPaneArgv,
  cols: number,
  rows: number,
): IPty {
  ensureHelper();
  const workdir = resolveWorkdir(cwd);
  return spawn(argv.binary, [...argv.args], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workdir,
    env: { ...terminalEnv(), PWD: workdir },
  });
}

function spawnPty(cwd: string, command: string, cols: number, rows: number): IPty {
  const helper = ensureHelper();
  const shell = existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
  const workdir = resolveWorkdir(cwd);
  const extra = command.trim().length === 0 ? [] : ['-c', command];
  const attempts = [['-i', ...extra], extra];
  let last: unknown;
  for (const args of attempts) {
    try {
      return spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: workdir,
        env: { ...terminalEnv(), PWD: workdir },
      });
    } catch (error) {
      last = error;
    }
  }
  const detail = last instanceof Error ? last.message : 'unknown spawn error';
  throw new BuilderHelmError(
    'TOOL_EXECUTION_FAILED',
    `Could not start a terminal in ${workdir} (${detail}; helper=${helper} exists=${existsSync(helper)})`,
    { cause: last },
  );
}

export function probePty(cwd: string): string {
  const helper = spawnHelperPath();
  try {
    const pty = spawnPty(cwd, '', 80, 24);
    const pid = pty.pid;
    pty.kill();
    return `ok pid=${pid} helper=${helper}`;
  } catch (error) {
    return `fail helper=${helper} exists=${existsSync(helper)} err=${error instanceof Error ? error.message : String(error)}`;
  }
}

export class BoardPtyManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly closing = new Set<string>();
  private readonly exitWaiters = new Map<
    string,
    ((value: { exitCode: number; output: string }) => void)[]
  >();

  /** Session with no panes yet: swarm seats attach panes per task. */
  createEmptySession(
    folderPath: string,
    isolation: BoardIsolation,
    sender: WebContents,
  ): string {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      sender,
      folderPath,
      isolation,
      worktreeTag: randomUUID().slice(0, 8),
      panes: new Map(),
    });
    return sessionId;
  }

  /** Resolves when the pane's process exits, with everything it printed. */
  waitForPaneExit(
    sessionId: string,
    paneId: string,
  ): Promise<{ exitCode: number; output: string }> {
    const pane = this.requirePane(sessionId, paneId);
    if (pane.pty === null) {
      return Promise.resolve({ exitCode: 0, output: pane.output });
    }
    // Executor form: the repo targets ES2022, which has no Promise.withResolvers.
    return new Promise<{ exitCode: number; output: string }>((resolve) => {
      const waiters = this.exitWaiters.get(paneId) ?? [];
      waiters.push(resolve);
      this.exitWaiters.set(paneId, waiters);
    });
  }

  async createSession(
    input: BoardCreateInput,
    locate: (slot: number) => Promise<{ cwd: string; branch: string | null }>,
    sender: WebContents,
  ): Promise<BoardSessionSummary> {
    const sessionId = randomUUID();
    const worktreeTag = randomUUID().slice(0, 8);
    const session: SessionRecord = {
      sender,
      folderPath: input.folderPath,
      isolation: input.isolation,
      worktreeTag,
      panes: new Map(),
    };
    this.sessions.set(sessionId, session);
    const panes: BoardPaneSummary[] = [];
    try {
      for (const spec of [...input.panes].sort((a, b) => a.slot - b.slot)) {
        panes.push(
          await this.attachPane(
            sessionId,
            session,
            spec.slot,
            spec.agentId,
            spec.command,
            spec.argv,
            locate,
          ),
        );
      }
    } catch (error) {
      for (const pane of session.panes.values()) {
        this.cancelDataFlush(pane);
        pane.pty?.kill();
      }
      // Creation is transactional: a session that never opened must not leave
      // worktrees and branches behind for the panes that did succeed.
      if (session.isolation === 'worktree') {
        for (const pane of session.panes.values()) {
          await this.discardWorktree(session.folderPath, pane.cwd, pane.branch);
        }
      }
      this.sessions.delete(sessionId);
      throw error;
    }
    return {
      sessionId,
      folderPath: input.folderPath,
      paneCount: panes.length,
      isolation: input.isolation,
      panes,
    };
  }

  sessionContext(sessionId: string): {
    readonly folderPath: string;
    readonly isolation: BoardIsolation;
    readonly worktreeTag: string;
  } {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown pane session or pane');
    }
    return {
      folderPath: session.folderPath,
      isolation: session.isolation,
      worktreeTag: session.worktreeTag,
    };
  }

  async addPane(
    sessionId: string,
    agentId: BoardAgentId,
    command: string | undefined,
    argv: BoardPaneArgv | undefined,
    locate: (slot: number) => Promise<{ cwd: string; branch: string | null }>,
  ): Promise<BoardPaneSummary> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown pane session or pane');
    }
    if (session.panes.size >= 12) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'This Space is already at 12 terminals',
      );
    }
    return this.attachPane(
      sessionId,
      session,
      session.panes.size,
      agentId,
      command,
      argv,
      locate,
    );
  }
  private async attachPane(
    sessionId: string,
    session: SessionRecord,
    slot: number,
    agentId: BoardAgentId,
    commandOverride: string | undefined,
    argv: BoardPaneArgv | undefined,
    locate: (slot: number) => Promise<{ cwd: string; branch: string | null }>,
  ): Promise<BoardPaneSummary> {
    const command = resolveCommand(agentId, commandOverride);
    const paneId = randomUUID();
    const location = await locate(slot);
    const label = boardAgentCatalogEntry(agentId).label;
    const title =
      location.branch === null
        ? `${label} · ${basename(location.cwd)} #${slot + 1}`
        : `${label} · ${location.branch}`;
    let pty: IPty;
    try {
      pty =
        argv !== undefined
          ? spawnArgvPty(location.cwd, argv, 120, 30)
          : spawnPty(location.cwd, command, 120, 30);
    } catch (error) {
      // The worktree exists but this pane never joined the session, so the
      // caller's rollback cannot see it. Undo it here or it leaks silently.
      if (session.isolation === 'worktree') {
        await this.discardWorktree(session.folderPath, location.cwd, location.branch);
      }
      throw error;
    }
    const meta: PaneMeta = {
      slot,
      agentId,
      title,
      status: 'running',
      branch: location.branch,
      cwd: location.cwd,
      output: '',
      emitted: 0,
      startupTail: '',
      sent: 0,
      ackedOffset: 0,
      ackSeen: false,
      paused: false,
      pendingData: '',
      flushTimer: null,
      acked: new Set(),
      pty,
    };
    session.panes.set(paneId, meta);
    pty.onData((chunk) => {
      const text =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      meta.emitted += text.length;
      const next = meta.output + text;
      meta.output =
        next.length <= maxBufferedChars ? next : next.slice(-maxBufferedChars);
      const startup = scanStartupChunk(meta.startupTail, text, meta.acked);
      meta.startupTail = startup.tail;
      if (startup.ack !== null) {
        meta.acked.add(startup.ack.id);
        pty.write(startup.ack.reply);
      }
      if (meta.status === 'running' && startup.failure !== null) {
        meta.status = 'failed';
        this.forward(sessionId, paneId, {
          type: 'status',
          status: 'failed',
          exitCode: null,
        });
      }
      this.queueData(sessionId, paneId, meta, text);
    });
    pty.onExit(({ exitCode }) => {
      this.flushData(sessionId, paneId, meta);
      meta.pty = null;
      for (const resolve of this.exitWaiters.get(paneId) ?? []) {
        resolve({ exitCode, output: meta.output });
      }
      this.exitWaiters.delete(paneId);
      this.forward(sessionId, paneId, {
        type: 'status',
        status: exitCode >= 0 ? 'exited' : 'failed',
        exitCode,
      });
    });
    return {
      paneId,
      slot: meta.slot,
      agentId: meta.agentId,
      title: meta.title,
      status: meta.status,
      branch: meta.branch,
      cwd: meta.cwd,
    };
  }

  async write(input: BoardPaneWriteInput): Promise<void> {
    const pane = this.requirePane(input.sessionId, input.paneId);
    pane.pty?.write(input.data);
  }

  async resize(input: BoardPaneResizeInput): Promise<void> {
    const pane = this.requirePane(input.sessionId, input.paneId);
    pane.pty?.resize(input.cols, input.rows);
  }

  async closePane(input: BoardPaneCloseInput): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    const pane = session?.panes.get(input.paneId);
    if (session === undefined || pane === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown pane session or pane');
    }
    this.flushData(input.sessionId, input.paneId, pane);
    this.closing.add(input.paneId);
    pane.pty?.kill();
    pane.pty = null;
    if (session.isolation === 'worktree') {
      await this.discardWorktree(session.folderPath, pane.cwd, pane.branch);
    }
    session.panes.delete(input.paneId);
    [...session.panes.values()]
      .sort((left, right) => left.slot - right.slot)
      .forEach((item, index) => {
        item.slot = index;
      });
  }

  /**
   * Reclaims one pane worktree and, when safe, its branch.
   *
   * `git branch -d` refuses a branch holding unmerged commits, so agent work
   * that was committed but never landed survives losing its directory. The
   * prefix check is what proves the branch is ours: pane worktrees share a
   * parent directory with a developer's own checkouts.
   */
  private async discardWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string | null,
  ): Promise<void> {
    if (worktreePath === repoPath) return;
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoPath,
      timeout: 15_000,
    }).catch(() => undefined);
    // A stale administrative entry would otherwise block the branch delete.
    await execFileAsync('git', ['worktree', 'prune'], {
      cwd: repoPath,
      timeout: 15_000,
    }).catch(() => undefined);
    if (branch !== null && branch.startsWith(BOARD_WORKTREE_BRANCH_PREFIX)) {
      await execFileAsync('git', ['branch', '-d', branch], {
        cwd: repoPath,
        timeout: 15_000,
      }).catch(() => undefined);
    }
  }

  drainPane(input: BoardPaneDrainInput): { data: string; offset: number } {
    const pane = this.requirePane(input.sessionId, input.paneId);
    // Anything still batched is already counted in `emitted` but not in the
    // snapshot, so send it now and let the snapshot end at a clean boundary.
    this.flushData(input.sessionId, input.paneId, pane);
    return { data: pane.output, offset: pane.emitted };
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      for (const [paneId, pane] of session.panes) {
        this.cancelDataFlush(pane);
        this.closing.add(paneId);
        pane.pty?.kill();
        pane.pty = null;
      }
    }
    this.sessions.clear();
  }

  private queueData(
    sessionId: string,
    paneId: string,
    pane: PaneMeta,
    text: string,
  ): void {
    pane.pendingData += text;
    if (pane.pendingData.length >= maxPendingDataChars) {
      this.flushData(sessionId, paneId, pane);
      return;
    }
    pane.flushTimer ??= setTimeout(() => {
      pane.flushTimer = null;
      this.flushData(sessionId, paneId, pane);
    }, outputBatchDelayMs);
  }

  private flushData(sessionId: string, paneId: string, pane: PaneMeta): void {
    this.cancelDataFlush(pane);
    if (pane.pendingData.length === 0) return;
    const data = pane.pendingData;
    pane.pendingData = '';
    // Pending bytes are the tail of the stream, so they span
    // [emitted - length, emitted).
    const start = pane.emitted - data.length;
    for (let index = 0; index < data.length; index += maxEventChars) {
      const slice = data.slice(index, index + maxEventChars);
      pane.sent = start + index + slice.length;
      this.forward(sessionId, paneId, {
        type: 'data',
        data: Buffer.from(slice, 'utf8').toString('base64'),
        offset: pane.sent,
      });
    }
    this.applyBackpressure(pane);
  }

  /**
   * Reports how much output the renderer has finished writing.
   *
   * Resuming here is what makes the pause safe: the pane only restarts once the
   * consumer has actually caught up.
   */
  ackPane(input: BoardPaneAckInput): void {
    const pane = this.requirePane(input.sessionId, input.paneId);
    pane.ackSeen = true;
    // Acks can arrive out of order; only ever move the watermark forward.
    pane.ackedOffset = Math.max(pane.ackedOffset, Math.min(input.offset, pane.sent));
    this.applyBackpressure(pane);
  }

  /**
   * Pauses or resumes the PTY against the renderer's drain progress.
   *
   * Only engages once the renderer has acknowledged at least once. A consumer
   * that never acks, such as the throughput benchmark, keeps the old unbounded
   * behaviour instead of stalling forever.
   */
  private applyBackpressure(pane: PaneMeta): void {
    if (!pane.ackSeen || pane.pty === null) return;
    const inFlight = pane.sent - pane.ackedOffset;
    if (!pane.paused && inFlight >= inFlightHighWaterChars) {
      pane.pty.pause();
      pane.paused = true;
      return;
    }
    if (pane.paused && inFlight <= inFlightLowWaterChars) {
      pane.pty.resume();
      pane.paused = false;
    }
  }

  private cancelDataFlush(pane: PaneMeta): void {
    if (pane.flushTimer === null) return;
    clearTimeout(pane.flushTimer);
    pane.flushTimer = null;
  }

  private requirePane(sessionId: string, paneId: string): PaneMeta {
    const pane = this.sessions.get(sessionId)?.panes.get(paneId);
    if (pane === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown pane session or pane');
    }
    return pane;
  }

  private forward(sessionId: string, paneId: string, event: BoardPaneEvent): void {
    const session = this.sessions.get(sessionId);
    const meta = session?.panes.get(paneId);
    if (session === undefined || meta === undefined) return;
    if (event.type === 'status') {
      meta.status = event.status;
      if (!this.closing.delete(paneId)) notifyPaneExit(meta, event.exitCode);
    }
    if (!session.sender.isDestroyed()) {
      session.sender.send(
        ipcChannels.boardEvent,
        boardPaneEventEnvelopeSchema.parse({ sessionId, paneId, event }),
      );
    }
  }
}

function notifyPaneExit(pane: PaneMeta, exitCode: number | null): void {
  if (!Notification.isSupported()) return;
  const detail =
    exitCode === null || exitCode === 0 ? 'Finished' : `Exited ${String(exitCode)}`;
  new Notification({ title: pane.title, body: detail }).show();
}

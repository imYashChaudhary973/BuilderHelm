import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  BOARD_AGENT_CATALOG,
  boardPaneEventEnvelopeSchema,
  ipcChannels,
  type BoardAgentId,
  type BoardCreateInput,
  type BoardIsolation,
  type BoardPaneArgv,
  type BoardPaneCloseInput,
  type BoardPaneDrainInput,
  type BoardPaneEvent,
  type BoardPaneStatus,
  type BoardPaneSummary,
  type BoardPaneWriteInput,
  type BoardPaneResizeInput,
  type BoardSessionSummary,
} from '@zero/protocol';
import { ZeroError } from '@zero/shared';
import { Notification, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';

import { nextStartupAck, startupFailure } from './startup-ack.js';

const execFileAsync = promisify(execFile);

interface PaneMeta {
  slot: number;
  agentId: BoardAgentId;
  title: string;
  status: BoardPaneStatus;
  branch: string | null;
  cwd: string;
  output: string;
  lastDataAt: number;
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

const agentCommandById: Record<string, string> = Object.fromEntries(
  BOARD_AGENT_CATALOG.map((entry) => [entry.id, entry.command]),
);
const agentLabelById: Record<string, string> = Object.fromEntries(
  BOARD_AGENT_CATALOG.map((entry) => [entry.id, entry.label]),
);
const maxBufferedChars = 80_000;

function resolveCommand(agentId: BoardAgentId, override: string | undefined): string {
  if (agentId === 'shell') return '';
  const command = override ?? agentCommandById[agentId] ?? '';
  if (command.length === 0) {
    throw new ZeroError('VALIDATION_FAILED', `Unknown board agent ${agentId}`);
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
  throw new ZeroError(
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
  private readonly doneWaiters = new Map<
    string,
    ((value: { exitCode: number | null; output: string; done: boolean }) => void)[]
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

  /** Resolves when output matches or the process exits. */
  waitForPaneDone(
    sessionId: string,
    paneId: string,
    done: RegExp,
  ): Promise<{ exitCode: number | null; output: string; done: boolean }> {
    const pane = this.requirePane(sessionId, paneId);
    if (done.test(pane.output)) {
      return Promise.resolve({ exitCode: null, output: pane.output, done: true });
    }
    if (pane.pty === null) {
      return Promise.resolve({
        exitCode: 0,
        output: pane.output,
        done: done.test(pane.output),
      });
    }
    return new Promise((resolve) => {
      const waiters = this.doneWaiters.get(paneId) ?? [];
      waiters.push(resolve);
      this.doneWaiters.set(paneId, waiters);
    });
  }

  private resolveDone(
    paneId: string,
    output: string,
    exitCode: number | null,
    matched: boolean,
  ): void {
    if (!matched && exitCode === null) return;
    for (const resolve of this.doneWaiters.get(paneId) ?? []) {
      resolve({ exitCode, output, done: matched });
    }
    this.doneWaiters.delete(paneId);
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
      const specs = [...input.panes].sort((a, b) => a.slot - b.slot);
      const located: Array<{
        spec: (typeof specs)[number];
        location: { cwd: string; branch: string | null };
      }> = [];
      for (const spec of specs) {
        located.push({ spec, location: await locate(spec.slot) });
      }
      const settled = await Promise.allSettled(
        located.map(({ spec, location }) =>
          this.attachPane(
            sessionId,
            session,
            spec.slot,
            spec.agentId,
            spec.command,
            spec.argv,
            location,
          ),
        ),
      );
      for (const result of settled) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
        panes.push(result.value);
      }
    } catch (error) {
      for (const pane of session.panes.values()) pane.pty?.kill();
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
      throw new ZeroError('VALIDATION_FAILED', 'Unknown pane session or pane');
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
      throw new ZeroError('VALIDATION_FAILED', 'Unknown pane session or pane');
    }
    if (session.panes.size >= 12) {
      throw new ZeroError('VALIDATION_FAILED', 'This Space is already at 12 terminals');
    }
    return this.attachPane(
      sessionId,
      session,
      session.panes.size,
      agentId,
      command,
      argv,
      await locate(session.panes.size),
    );
  }
  private async attachPane(
    sessionId: string,
    session: SessionRecord,
    slot: number,
    agentId: BoardAgentId,
    commandOverride: string | undefined,
    argv: BoardPaneArgv | undefined,
    location: { cwd: string; branch: string | null },
  ): Promise<BoardPaneSummary> {
    const command = resolveCommand(agentId, commandOverride);
    const paneId = randomUUID();
    const label = agentLabelById[agentId] ?? agentId;
    const title =
      location.branch === null
        ? `${label} · ${basename(location.cwd)} #${slot + 1}`
        : `${label} · ${location.branch}`;
    const pty =
      argv !== undefined
        ? spawnArgvPty(location.cwd, argv, 120, 30)
        : spawnPty(location.cwd, command, 120, 30);
    const meta: PaneMeta = {
      slot,
      agentId,
      title,
      status: 'running',
      branch: location.branch,
      cwd: location.cwd,
      output: '',
      lastDataAt: Date.now(),
      acked: new Set(),
      pty,
    };
    session.panes.set(paneId, meta);
    pty.onData((chunk) => {
      const text =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      const next = meta.output + text;
      meta.output =
        next.length <= maxBufferedChars ? next : next.slice(-maxBufferedChars);
      meta.lastDataAt = Date.now();
      const ack = nextStartupAck(meta.output, meta.acked);
      if (ack !== null) {
        meta.acked.add(ack.id);
        pty.write(ack.reply);
      }
      if (meta.status === 'running' && startupFailure(meta.output) !== null) {
        meta.status = 'failed';
        this.forward(sessionId, paneId, {
          type: 'status',
          status: 'failed',
          exitCode: null,
        });
      }
      this.forward(sessionId, paneId, {
        type: 'data',
        data: Buffer.from(text, 'utf8').toString('base64'),
      });
      this.resolveDone(paneId, meta.output, null, /SWARM_TASK_DONE/.test(meta.output));
    });
    pty.onExit(({ exitCode }) => {
      meta.pty = null;
      for (const resolve of this.exitWaiters.get(paneId) ?? []) {
        resolve({ exitCode, output: meta.output });
      }
      this.exitWaiters.delete(paneId);
      this.resolveDone(
        paneId,
        meta.output,
        exitCode,
        /SWARM_TASK_DONE/.test(meta.output),
      );
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

  lastDataAt(sessionId: string, paneId: string): number {
    return this.requirePane(sessionId, paneId).lastDataAt;
  }

  async resize(input: BoardPaneResizeInput): Promise<void> {
    const pane = this.requirePane(input.sessionId, input.paneId);
    pane.pty?.resize(input.cols, input.rows);
  }

  async closePane(input: BoardPaneCloseInput): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    const pane = session?.panes.get(input.paneId);
    if (session === undefined || pane === undefined) {
      return;
    }
    this.closing.add(input.paneId);
    pane.pty?.kill();
    for (const resolve of this.exitWaiters.get(input.paneId) ?? []) {
      resolve({ exitCode: 1, output: pane.output });
    }
    this.exitWaiters.delete(input.paneId);
    this.resolveDone(input.paneId, pane.output, 1, false);
    const cwd = pane.cwd;
    const folderPath = session.folderPath;
    const isolation = session.isolation;
    pane.pty = null;
    session.panes.delete(input.paneId);
    [...session.panes.values()]
      .sort((left, right) => left.slot - right.slot)
      .forEach((item, index) => {
        item.slot = index;
      });
    if (isolation === 'worktree' && cwd !== folderPath) {
      void execFileAsync('git', ['worktree', 'remove', '--force', cwd], {
        cwd: folderPath,
        timeout: 15_000,
      }).catch(() => undefined);
    }
  }

  drainPane(input: BoardPaneDrainInput): { data: string } {
    return { data: this.requirePane(input.sessionId, input.paneId).output };
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      for (const [paneId, pane] of session.panes) {
        this.closing.add(paneId);
        pane.pty?.kill();
        pane.pty = null;
      }
    }
    this.sessions.clear();
  }

  private requirePane(sessionId: string, paneId: string): PaneMeta {
    const pane = this.sessions.get(sessionId)?.panes.get(paneId);
    if (pane === undefined) {
      throw new ZeroError('VALIDATION_FAILED', 'Unknown pane session or pane');
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

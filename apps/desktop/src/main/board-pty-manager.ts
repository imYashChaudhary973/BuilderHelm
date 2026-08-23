import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

import {
  BOARD_AGENT_CATALOG,
  boardPaneEventEnvelopeSchema,
  ipcChannels,
  type BoardAgentId,
  type BoardCreateInput,
  type BoardPaneCloseInput,
  type BoardPaneDrainInput,
  type BoardPaneEvent,
  type BoardPaneResizeInput,
  type BoardPaneStatus,
  type BoardPaneWriteInput,
  type BoardSessionSummary,
} from '@zero/protocol';
import { ZeroError } from '@zero/shared';
import { Notification, type WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';

interface PaneMeta {
  slot: number;
  agentId: BoardAgentId;
  title: string;
  status: BoardPaneStatus;
  branch: string | null;
  cwd: string;
  output: string;
  pty: IPty | null;
}

interface SessionRecord {
  sender: WebContents;
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

  async createSession(
    input: BoardCreateInput,
    locate: (slot: number) => Promise<{ cwd: string; branch: string | null }>,
    sender: WebContents,
  ): Promise<BoardSessionSummary> {
    const sessionId = randomUUID();
    const session: SessionRecord = { sender, panes: new Map() };
    this.sessions.set(sessionId, session);
    const panes: Array<{ paneId: string } & Omit<PaneMeta, 'output' | 'pty'>> = [];
    try {
      for (const spec of [...input.panes].sort((a, b) => a.slot - b.slot)) {
        const command = resolveCommand(spec.agentId, spec.command);
        const paneId = randomUUID();
        const location = await locate(spec.slot);
        const label = agentLabelById[spec.agentId] ?? spec.agentId;
        const title =
          location.branch === null
            ? `${label} · ${basename(location.cwd)} #${spec.slot + 1}`
            : `${label} · ${location.branch}`;
        const pty = spawnPty(location.cwd, command, 120, 30);
        const meta: PaneMeta = {
          slot: spec.slot,
          agentId: spec.agentId,
          title,
          status: 'running',
          branch: location.branch,
          cwd: location.cwd,
          output: '',
          pty,
        };
        session.panes.set(paneId, meta);
        pty.onData((chunk) => {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
          const next = meta.output + text;
          meta.output =
            next.length <= maxBufferedChars ? next : next.slice(-maxBufferedChars);
          this.forward(sessionId, paneId, {
            type: 'data',
            data: Buffer.from(text, 'utf8').toString('base64'),
          });
        });
        pty.onExit(({ exitCode }) => {
          meta.pty = null;
          this.forward(sessionId, paneId, {
            type: 'status',
            status: exitCode >= 0 ? 'exited' : 'failed',
            exitCode,
          });
        });
        panes.push({
          paneId,
          slot: meta.slot,
          agentId: meta.agentId,
          title: meta.title,
          status: meta.status,
          branch: meta.branch,
          cwd: meta.cwd,
        });
      }
    } catch (error) {
      for (const pane of session.panes.values()) pane.pty?.kill();
      this.sessions.delete(sessionId);
      throw error;
    }
    return {
      sessionId,
      folderPath: input.folderPath,
      paneCount: input.paneCount,
      isolation: input.isolation,
      panes,
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
    const pane = this.requirePane(input.sessionId, input.paneId);
    this.closing.add(input.paneId);
    pane.pty?.kill();
    pane.pty = null;
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

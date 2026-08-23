import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';

import {
  BOARD_AGENT_CATALOG,
  boardPaneEventEnvelopeSchema,
  ipcChannels,
  type BoardAgentId,
  type BoardCreateInput,
  type BoardPaneCloseInput,
  type BoardPaneEvent,
  type BoardPaneResizeInput,
  type BoardPaneStatus,
  type BoardPaneWriteInput,
  type BoardSessionSummary,
} from '@zero/protocol';
import { ZeroError } from '@zero/shared';
import { utilityProcess, type UtilityProcess, type WebContents } from 'electron';

type HostEvent =
  | { kind: 'ready' }
  | { kind: 'data'; paneId: string; data: string }
  | { kind: 'exit'; paneId: string; exitCode: number };

interface PaneMeta {
  slot: number;
  agentId: BoardAgentId;
  title: string;
  status: BoardPaneStatus;
}

interface SessionRecord {
  sender: WebContents;
  panes: Map<string, PaneMeta>;
}

const agentCommandById = new Map<string, string>(
  BOARD_AGENT_CATALOG.map((entry) => [entry.id, entry.command]),
);
const agentLabelById = new Map<string, string>(
  BOARD_AGENT_CATALOG.map((entry) => [entry.id, entry.label]),
);

export class BoardPtyManager {
  private host: UtilityProcess | null = null;
  private hostReady: Promise<UtilityProcess> | null = null;
  private readonly sessions = new Map<string, SessionRecord>();

  async createSession(
    input: BoardCreateInput,
    worktreeFor: (slot: number) => Promise<string | undefined>,
    sender: WebContents,
  ): Promise<BoardSessionSummary> {
    const host = await this.ensureHost();
    const sessionId = randomUUID();
    const session: SessionRecord = { sender, panes: new Map() };
    this.sessions.set(sessionId, session);
    const panes: Array<{ paneId: string } & PaneMeta> = [];
    for (const spec of [...input.panes].sort((a, b) => a.slot - b.slot)) {
      if (spec.agentId === 'custom' && !spec.command) {
        throw new ZeroError('VALIDATION_FAILED', 'Custom pane requires a command');
      }
      const command = spec.command ?? agentCommandById.get(spec.agentId);
      if (!command) {
        throw new ZeroError('VALIDATION_FAILED', `Unknown board agent ${spec.agentId}`);
      }
      const paneId = randomUUID();
      const cwd = (await worktreeFor(spec.slot)) ?? input.folderPath;
      const label = agentLabelById.get(spec.agentId) ?? spec.agentId;
      const title = `${label} · ${basename(input.folderPath)} #${spec.slot + 1}`;
      host.postMessage({ kind: 'spawn', paneId, cwd, cols: 120, rows: 30 });
      // Host accepts spawns synchronously; mark running immediately.
      const meta: PaneMeta = {
        slot: spec.slot,
        agentId: spec.agentId,
        title,
        status: 'running',
      };
      session.panes.set(paneId, meta);
      panes.push({ paneId, ...meta });
      // ponytail fixed shell-init delay, replace with prompt-marker handshake if flaky
      setTimeout(() => {
        void this.write({
          correlationId: input.correlationId,
          sessionId,
          paneId,
          data: `${command}\r`,
        }).catch(() => {});
      }, 800);
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
    const host = await this.ensureHost();
    this.requirePane(input.sessionId, input.paneId);
    host.postMessage({ kind: 'write', paneId: input.paneId, data: input.data });
  }

  async resize(input: BoardPaneResizeInput): Promise<void> {
    const host = await this.ensureHost();
    this.requirePane(input.sessionId, input.paneId);
    host.postMessage({
      kind: 'resize',
      paneId: input.paneId,
      cols: input.cols,
      rows: input.rows,
    });
  }

  async closePane(input: BoardPaneCloseInput): Promise<void> {
    const host = await this.ensureHost();
    this.requirePane(input.sessionId, input.paneId);
    host.postMessage({ kind: 'kill', paneId: input.paneId });
    this.sessions.get(input.sessionId)?.panes.delete(input.paneId);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      for (const paneId of session.panes.keys()) {
        this.host?.postMessage({ kind: 'kill', paneId });
      }
    }
    this.host?.kill();
    this.host = null;
    this.hostReady = null;
    this.sessions.clear();
  }

  private requirePane(sessionId: string, paneId: string): void {
    if (!this.sessions.get(sessionId)?.panes.has(paneId)) {
      throw new ZeroError('VALIDATION_FAILED', 'Unknown pane session or pane');
    }
  }

  private ensureHost(): Promise<UtilityProcess> {
    if (this.hostReady) return this.hostReady;
    const child = utilityProcess.fork(join(__dirname, 'pty-host.js'));
    child.on('message', (message: unknown) => {
      const event = message as Partial<HostEvent> | null;
      if (!event || typeof event.kind !== 'string') return;
      switch (event.kind) {
        case 'data':
          this.forward(event.paneId ?? '', { type: 'data', data: event.data ?? '' });
          break;
        case 'exit':
          this.forward(event.paneId ?? '', {
            type: 'status',
            status:
              event.exitCode !== undefined && event.exitCode >= 0 ? 'exited' : 'failed',
            exitCode: event.exitCode ?? null,
          });
          break;
        default:
          break;
      }
    });
    this.host = child;
    this.hostReady = new Promise<UtilityProcess>((resolve, reject) => {
      child.once('message', (message: unknown) => {
        if ((message as { kind?: unknown } | null)?.kind === 'ready') resolve(child);
      });
      child.once('exit', () => {
        reject(
          new ZeroError('INTEGRATION_OFFLINE', 'Board pty host exited before ready'),
        );
      });
    });
    return this.hostReady;
  }

  private forward(paneId: string, event: BoardPaneEvent): void {
    for (const [sessionId, session] of this.sessions) {
      const meta = session.panes.get(paneId);
      if (!meta) continue;
      if (event.type === 'status') meta.status = event.status;
      if (!session.sender.isDestroyed()) {
        session.sender.send(
          ipcChannels.boardEvent,
          boardPaneEventEnvelopeSchema.parse({ sessionId, paneId, event }),
        );
      }
      return;
    }
  }
}

import { spawn, type IPty } from 'node-pty';

type HostMessage =
  | {
      kind: 'spawn';
      paneId: string;
      cwd: string;
      cols: number;
      rows: number;
      command: string;
    }
  | { kind: 'write'; paneId: string; data: string }
  | { kind: 'resize'; paneId: string; cols: number; rows: number }
  | { kind: 'kill'; paneId: string };

const panes = new Map<string, IPty>();

function post(message: unknown): void {
  process.parentPort.postMessage(message);
}

function asInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function spawnPane(
  paneId: string,
  cwd: string,
  cols: number,
  rows: number,
  command: string,
): void {
  const shell = process.env.SHELL ?? '/bin/zsh';
  const args = command.trim().length === 0 ? ['-l'] : ['-l', '-c', command];
  const pty = spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  panes.set(paneId, pty);
  pty.onData((chunk) => {
    post({ kind: 'data', paneId, data: Buffer.from(chunk).toString('base64') });
  });
  pty.onExit(({ exitCode }) => {
    panes.delete(paneId);
    post({ kind: 'exit', paneId, exitCode });
  });
}

process.parentPort.on('message', (event: Electron.MessageEvent) => {
  const raw = event.data as Partial<HostMessage> | null;
  if (!raw || typeof raw.kind !== 'string') return;
  switch (raw.kind) {
    case 'spawn': {
      const { paneId, cwd, command } = raw;
      const cols = asInt(raw.cols);
      const rows = asInt(raw.rows);
      if (typeof paneId !== 'string' || typeof cwd !== 'string') return;
      if (typeof command !== 'string') return;
      if (cols === undefined || rows === undefined || panes.has(paneId)) return;
      try {
        spawnPane(paneId, cwd, cols, rows, command);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'pty spawn failed';
        post({
          kind: 'data',
          paneId,
          data: Buffer.from(`${message}\r\n`).toString('base64'),
        });
        post({ kind: 'exit', paneId, exitCode: 1 });
      }
      break;
    }
    case 'write': {
      const { paneId, data } = raw;
      if (typeof paneId !== 'string' || typeof data !== 'string') return;
      panes.get(paneId)?.write(data);
      break;
    }
    case 'resize': {
      const { paneId } = raw;
      const cols = asInt(raw.cols);
      const rows = asInt(raw.rows);
      if (typeof paneId !== 'string' || cols === undefined || rows === undefined) return;
      panes.get(paneId)?.resize(cols, rows);
      break;
    }
    case 'kill': {
      if (typeof raw.paneId !== 'string') return;
      panes.get(raw.paneId)?.kill();
      break;
    }
    default:
      break;
  }
});

post({ kind: 'ready' });

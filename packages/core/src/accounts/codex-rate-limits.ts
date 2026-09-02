import { spawn } from 'node:child_process';

const RPC_TIMEOUT_MS = 8_000;

function writeMessage(
  child: { stdin: { write(chunk: string): boolean } },
  value: unknown,
): void {
  const body = JSON.stringify(value);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null)
      return value as Record<string, unknown>;
  } catch {
    // ignore
  }
  return null;
}

/**
 * One-shot Codex app-server JSON-RPC. Does not read auth.json; the CLI uses its
 * own session. Times out rather than hanging a settings page.
 */
export async function readCodexRateLimits(
  executable: string,
  env: Record<string, string> = {},
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let buffer = '';
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('Codex rate-limit read timed out')),
      RPC_TIMEOUT_MS,
    );

    function finish(error: Error | null, value?: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error !== null) reject(error);
      else resolve(value);
    }

    function handle(message: Record<string, unknown> | null): void {
      if (message === null) return;
      if (message.id === 1 && message.result !== undefined) {
        writeMessage(child, {
          jsonrpc: '2.0',
          id: 2,
          method: 'account/rateLimits/read',
          params: {},
        });
      }
      if (message.id === 2) {
        if (message.error !== undefined) {
          finish(new Error('Codex rateLimits/read failed'));
          return;
        }
        finish(null, message.result ?? message);
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      while (buffer.length > 0) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const lengthMatch = /Content-Length:\s*(\d+)/i.exec(buffer.slice(0, headerEnd));
          if (lengthMatch !== null) {
            const length = Number(lengthMatch[1]);
            const start = headerEnd + 4;
            if (buffer.length < start + length) return;
            const body = buffer.slice(start, start + length);
            buffer = buffer.slice(start + length);
            handle(parseJson(body));
            continue;
          }
        }
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) handle(parseJson(line));
      }
    });
    child.on('error', (error) => finish(error));
    child.on('exit', () => {
      if (!settled) finish(new Error('Codex app-server exited'));
    });

    writeMessage(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'builderhelm', version: '0.0.0' },
      },
    });
  });
}

// Client for the Rust engine sidecar (ADOPTION phase A).
//
// The engine is a child process speaking newline-delimited JSON over stdio.
// There is no socket and no port: the trust boundary is process spawn, so
// nothing on the machine can reach the engine by connecting to it.
//
// Phase A only stands the bridge up and proves it. Channels keep their
// existing TypeScript handlers; phase C moves them across one namespace at a
// time, once that namespace's corpus slice passes through Rust.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** Wire format this client understands. A mismatch is fatal, never coerced. */
export const ENGINE_PROTOCOL = 1;

export interface EngineHello {
  readonly protocol: number;
  readonly engine: string;
  readonly host: string;
  readonly channelCount: number;
  readonly channels: readonly string[];
  /** Push channels the engine can emit unprompted. Empty until phase B. */
  readonly events: readonly string[];
  readonly testControls: boolean;
}

export interface EngineClientOptions {
  /** Path to the `helm-app` binary. */
  readonly bin: string;
  /** Channel names this build expects the engine to serve. */
  readonly expectedChannels: readonly string[];
  /** Milliseconds to wait for the handshake before giving up. */
  readonly handshakeTimeoutMs?: number;
  /** Restart attempts after an unexpected exit. Bounded on purpose. */
  readonly maxRestarts?: number;
  readonly onLog?: (line: string) => void;
}

class EngineError extends Error {}

/** Strip anything that could carry a token or a user path out of a log line. */
export function redact(line: string): string {
  return line
    .replace(/(gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9._-]+/g, '$1***')
    .replace(/("(?:token|secret|password|apiKey|api_key)"\s*:\s*)"[^"]*"/gi, '$1"***"')
    .replace(/\/Users\/[^/\s"]+/g, '/Users/***')
    .replace(/\/home\/[^/\s"]+/g, '/home/***');
}

export interface ContractCheck {
  /** Disagreements that must stop the engine from being trusted. */
  readonly fatal: readonly string[];
  /** Drift that is safe to run with, but worth a log line. */
  readonly warnings: readonly string[];
}

/**
 * Compare the engine's channel map with ours.
 *
 * The asymmetry is deliberate. A channel we call but the engine does not
 * serve is fatal: the call would hang forever. A channel the engine serves
 * that we never call is harmless, and under a Rust-first plan it is the
 * normal state - the engine lands a channel before its TypeScript caller
 * exists. Treating that as fatal would make the engine unshippable during
 * the migration, so it is a warning.
 */
export function checkContract(
  hello: EngineHello,
  expected: readonly string[],
): ContractCheck {
  const fatal: string[] = [];
  const warnings: string[] = [];
  if (hello.protocol !== ENGINE_PROTOCOL) {
    fatal.push(`protocol ${String(hello.protocol)}, want ${String(ENGINE_PROTOCOL)}`);
  }
  if (hello.channelCount !== hello.channels.length) {
    fatal.push(
      `engine says ${String(hello.channelCount)} channels but listed ${String(hello.channels.length)}`,
    );
  }
  const advertised = new Set(hello.channels);
  const missing = expected.filter((channel) => !advertised.has(channel));
  if (missing.length > 0) fatal.push(`engine missing: ${missing.join(', ')}`);
  const ahead = hello.channels.filter((channel) => !expected.includes(channel));
  if (ahead.length > 0)
    warnings.push(`engine serves channels we do not call: ${ahead.join(', ')}`);
  return { fatal, warnings };
}

interface Pending {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: Error) => void;
}

export class EngineClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private hello: EngineHello | undefined;
  private readonly pending = new Map<number, Pending>();
  private buffer = '';
  private nextId = 0;
  private restarts = 0;
  private stopping = false;

  constructor(private readonly options: EngineClientOptions) {}

  /** The verified handshake, or undefined before `start`. */
  get handshake(): EngineHello | undefined {
    return this.hello;
  }

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null;
  }

  /**
   * Spawn the engine and verify its handshake. Rejects - leaving nothing
   * running - if the engine is the wrong build.
   */
  async start(): Promise<EngineHello> {
    if (this.running) throw new EngineError('engine already running');
    this.stopping = false;
    const child = spawn(this.options.bin, ['engine'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.consume(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      // Engine stderr is a log, not a channel. Redact before it is stored.
      this.options.onLog?.(redact(chunk.trimEnd()));
    });
    child.on('exit', (code, signal) => {
      this.onExit(code, signal);
    });
    child.on('error', (error: Error) => {
      this.failAll(new EngineError(`engine spawn failed: ${error.message}`));
    });

    try {
      const hello = await this.waitForHello();
      const { fatal, warnings } = checkContract(hello, this.options.expectedChannels);
      for (const warning of warnings) this.options.onLog?.(warning);
      if (fatal.length > 0) {
        throw new EngineError(`engine contract mismatch: ${fatal.join('; ')}`);
      }
      this.hello = hello;
      return hello;
    } catch (error) {
      // A bad handshake must not leave a half-trusted child behind.
      await this.stop();
      throw error;
    }
  }

  private waitForHello(): Promise<EngineHello> {
    const timeoutMs = this.options.handshakeTimeoutMs ?? 10_000;
    return new Promise<EngineHello>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new EngineError(`engine handshake timed out after ${String(timeoutMs)}ms`),
        );
      }, timeoutMs);
      // The hello frame is answered on the reserved id 0.
      this.pending.set(0, {
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload as EngineHello);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /** Call one channel. Rejects if the engine is not running. */
  async invoke(channel: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    const child = this.child;
    if (child === undefined || !this.running) {
      throw new EngineError('engine is not running');
    }
    if (signal?.aborted === true) throw new EngineError('request aborted');
    this.nextId += 1;
    const id = this.nextId;
    const settled = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    // A cancelled request stops waiting on our side. The engine has no
    // per-request cancel frame yet, so its reply is dropped when it lands.
    const onAbort = (): void => {
      const entry = this.pending.get(id);
      if (entry !== undefined) {
        this.pending.delete(id);
        entry.reject(new EngineError('request aborted'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.write(`${JSON.stringify({ id, method: channel, input })}\n`);
    try {
      return await settled;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Split the stream on newlines and settle whatever each frame answers. */
  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
      if (line.trim().length === 0) continue;
      this.settle(line);
    }
  }

  private settle(line: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.options.onLog?.(`engine sent a non-json line: ${redact(line)}`);
      return;
    }
    if (frame['type'] === 'hello') {
      this.pending.get(0)?.resolve(frame);
      this.pending.delete(0);
      return;
    }
    const id = typeof frame['id'] === 'number' ? frame['id'] : undefined;
    if (id === undefined) {
      this.options.onLog?.(`engine frame without an id: ${redact(line)}`);
      return;
    }
    const entry = this.pending.get(id);
    // An unknown id means the request was already cancelled. Dropping it is
    // correct; the caller stopped waiting.
    if (entry === undefined) return;
    this.pending.delete(id);
    if (frame['type'] === 'error') {
      entry.reject(
        new EngineError(`engine rejected the request: ${String(frame['code'])}`),
      );
      return;
    }
    entry.resolve(frame['payload']);
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const how = signal ?? String(code);
    this.failAll(new EngineError(`engine exited (${how})`));
    this.hello = undefined;
    if (this.stopping) return;
    const limit = this.options.maxRestarts ?? 3;
    if (this.restarts >= limit) {
      this.options.onLog?.(
        `engine exited (${how}); ${String(limit)} restarts used, giving up`,
      );
      return;
    }
    this.restarts += 1;
    this.options.onLog?.(
      `engine exited (${how}); restart ${String(this.restarts)}/${String(limit)}`,
    );
    void this.start().catch((error: unknown) => {
      this.options.onLog?.(`engine restart failed: ${redact(String(error))}`);
    });
  }

  /** Reject every in-flight request so no caller waits on a dead process. */
  private failAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.reject(error);
    }
  }

  /** Close stdin and wait for the engine to leave, then force it if it stays. */
  async stop(timeoutMs = 2_000): Promise<void> {
    const child = this.child;
    this.stopping = true;
    this.child = undefined;
    this.hello = undefined;
    if (child === undefined) return;
    this.failAll(new EngineError('engine stopping'));
    if (child.exitCode !== null) return;
    // Closing stdin is the graceful signal: the read loop ends and the engine
    // returns 0 on its own.
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * JSON-RPC 2.0 over a child process's stdio, framed by newlines.
 *
 * This is the transport half of the ACP host ([ADR 0008](../../../../../docs/adr/0008-agent-client-protocol-host.md))
 * and knows nothing about agents: no method names, no ACP shapes. Mapping lives
 * in `session.ts`. Keeping them apart is what lets the mapping be tested against
 * recorded traffic without spawning anything.
 *
 * Three framing details are load-bearing, all learned from real agents:
 *
 * - A message may straddle chunk boundaries, and several may arrive in one
 *   chunk. Buffer until a newline; never parse a chunk.
 * - stdout carries protocol only, but agents still print to stderr, sometimes
 *   megabytes of it. It is retained bounded, for diagnosis, and never parsed.
 * - The agent calls *us* as much as we call it: filesystem and terminal access
 *   are client-hosted, and permission is an agent-to-client request. This is a
 *   peer connection, not a client stub.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { BuilderHelmError } from '@builderhelm/shared';

/** Bounded so a chatty or wedged agent cannot grow the heap without limit. */
const STDERR_RETAINED_BYTES = 32_768;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

type JsonRpcId = number | string;

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

/** Answers a request the agent made of us. Throwing maps to a JSON-RPC error. */
export type RequestHandler = (params: unknown) => Promise<unknown>;
export type NotificationHandler = (params: unknown) => void;

export interface AcpConnectionOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * Extra variables layered over `process.env`. ADR 0008 forbids setting or
   * clearing provider credentials here: the child inherits the user's
   * environment so their own authentication is the one that applies.
   */
  readonly env?: Readonly<Record<string, string>>;
  readonly onExit: (code: number | null, stderr: string) => void;
  /** Called for protocol violations and unroutable traffic, never for stderr. */
  readonly onTransportError: (error: BuilderHelmError) => void;
}

export class AcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private stdoutBuffer = '';
  private stderrTail = '';
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: AcpConnectionOptions) {
    this.child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      // Inheriting the environment is the decision, not an oversight: see
      // AcpConnectionOptions.env and ADR 0008.
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.absorb(chunk));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_RETAINED_BYTES);
    });

    // A command that does not exist fails here rather than on exit, and the
    // message is the only useful thing the user will see.
    this.child.on('error', (error: Error) => {
      this.failAll(
        new BuilderHelmError(
          'INTEGRATION_OFFLINE',
          `Could not start ${options.command}.`,
          {
            cause: error,
            metadata: { command: options.command },
          },
        ),
      );
    });

    this.child.on('exit', (code) => {
      const stderr = this.stderrTail;
      this.failAll(
        new BuilderHelmError('INTEGRATION_OFFLINE', `${options.command} exited.`, {
          metadata: { command: options.command, code },
        }),
      );
      this.closed = true;
      options.onExit(code, stderr);
    });
  }

  /** Handlers must be registered before the agent can call them, so before initialize. */
  handleRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  handleNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        `${this.options.command} is not running.`,
      );
    }
    const id = this.nextId;
    this.nextId += 1;
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BuilderHelmError('INTEGRATION_OFFLINE', `${method} timed out.`, {
            metadata: { method, timeoutMs },
            retryable: true,
          }),
        );
      }, timeoutMs);
      // Node keeps the process alive for a pending timer; a slow agent should
      // not be the reason the app refuses to quit.
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.write(message);
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    const message: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.write(message);
  }

  /** Graceful, then forced. An agent mid-tool-call will not always go quietly. */
  async close(graceMs = 2_000): Promise<void> {
    if (this.closed) return;
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, graceMs);
      timer.unref();
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private write(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    const line = `${JSON.stringify(message)}\n`;
    this.child.stdin.write(line, (error) => {
      if (error === null || error === undefined) return;
      this.options.onTransportError(
        new BuilderHelmError('INTEGRATION_OFFLINE', 'Lost the connection to the agent.', {
          cause: error,
        }),
      );
    });
  }

  private absorb(chunk: string): void {
    this.stdoutBuffer += chunk;
    // A missing newline means an agent is streaming something enormous or is not
    // speaking the protocol at all. Either way, keeping the buffer is worse.
    if (this.stdoutBuffer.length > MAX_MESSAGE_BYTES) {
      this.stdoutBuffer = '';
      this.options.onTransportError(
        new BuilderHelmError(
          'VALIDATION_FAILED',
          'The agent sent an oversized message.',
          {
            metadata: { command: this.options.command, limit: MAX_MESSAGE_BYTES },
          },
        ),
      );
      return;
    }
    for (;;) {
      const boundary = this.stdoutBuffer.indexOf('\n');
      if (boundary < 0) break;
      const line = this.stdoutBuffer.slice(0, boundary).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(boundary + 1);
      if (line.length === 0) continue;
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Some agents print a banner to stdout before speaking protocol. Report
      // it rather than crashing, and keep reading.
      this.options.onTransportError(
        new BuilderHelmError(
          'VALIDATION_FAILED',
          'The agent sent a line that was not JSON.',
          {
            metadata: { command: this.options.command, preview: line.slice(0, 200) },
          },
        ),
      );
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const frame = message as Partial<JsonRpcResponse & JsonRpcRequest>;

    if (frame.method !== undefined) {
      if (frame.id === undefined) {
        this.notificationHandlers.get(frame.method)?.(frame.params);
        return;
      }
      void this.serve(frame.id, frame.method, frame.params);
      return;
    }

    if (frame.id === undefined) return;
    const waiter = this.pending.get(frame.id);
    if (waiter === undefined) return;
    this.pending.delete(frame.id);
    clearTimeout(waiter.timer);
    if (frame.error !== undefined) {
      waiter.reject(
        new BuilderHelmError('TOOL_EXECUTION_FAILED', frame.error.message, {
          metadata: { code: frame.error.code, data: frame.error.data },
        }),
      );
      return;
    }
    waiter.resolve(frame.result);
  }

  private async serve(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (handler === undefined) {
      // -32601 is JSON-RPC "method not found". Answering is required: an agent
      // that asked for a capability we declined still blocks on the reply.
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unsupported: ${method}` },
      });
      return;
    }
    try {
      const result = await handler(params);
      this.write({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      this.write({ jsonrpc: '2.0', id, error: { code: -32603, message } });
    }
  }

  private failAll(error: BuilderHelmError): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
}

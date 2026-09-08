import type { RemoteCommand, RemoteEvent } from '@builderhelm/protocol/remote';
import { REMOTE_PROTOCOL_VERSION } from '@builderhelm/protocol/remote';

/** Transport the React Native runtime (or a Node test) must supply. */
export interface CompanionTransport {
  write(line: string): void;
}

export interface PairedSession {
  sessionId: string;
  token: string;
  sessionKey: string;
  fingerprint: string;
  signature: string;
}

/**
 * Companion protocol client. It never sees provider credentials, a shell, or
 * a filesystem. The host stays authoritative.
 */
export class RemoteClient {
  constructor(
    private readonly transport: CompanionTransport,
    private readonly seal: (key: Buffer, payload: unknown) => string,
  ) {}

  pair(code: string, clientLabel: string): void {
    this.transport.write(
      `${JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        type: 'pair',
        code,
        clientLabel,
      })}\n`,
    );
  }

  reconnect(token: string, lastSeq: number): void {
    this.transport.write(
      `${JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        type: 'reconnect',
        token,
        lastSeq,
      })}\n`,
    );
  }

  command(sessionKey: Buffer, command: RemoteCommand): void {
    this.transport.write(
      `${JSON.stringify({
        v: REMOTE_PROTOCOL_VERSION,
        type: 'frame',
        s: this.seal(sessionKey, command),
      })}\n`,
    );
  }
}

export function parseHostLine(line: string): {
  type: string;
  paired?: PairedSession;
  events?: RemoteEvent[];
  error?: string;
  sealed?: string;
} {
  const frame = JSON.parse(line) as {
    type?: string;
    sessionId?: string;
    token?: string;
    sessionKey?: string;
    fingerprint?: string;
    signature?: string;
    message?: string;
    s?: string;
  };
  if (frame.type === 'paired') {
    return {
      type: 'paired',
      paired: {
        sessionId: frame.sessionId ?? '',
        token: frame.token ?? '',
        sessionKey: frame.sessionKey ?? '',
        fingerprint: frame.fingerprint ?? '',
        signature: frame.signature ?? '',
      },
    };
  }
  if (frame.type === 'error') return { type: 'error', error: frame.message };
  if (frame.type === 'frame') return { type: 'frame', sealed: frame.s };
  return { type: frame.type ?? 'unknown' };
}

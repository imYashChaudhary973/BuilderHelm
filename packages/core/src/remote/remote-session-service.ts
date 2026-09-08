import { createServer, type Server, type Socket } from 'node:net';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';
import { networkInterfaces } from 'node:os';

import type { BuilderHelmDatabase } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  REMOTE_DEFAULT_PORT,
  REMOTE_PROTOCOL_VERSION,
  remoteArtifactSchema,
  remoteAuditSchema,
  remoteCommandSchema,
  remoteEventSchema,
  remotePairingOfferSchema,
  remoteSessionSchema,
  remoteSnapshotSchema,
  remoteStatusSchema,
  type RemoteArtifact,
  type RemoteAudit,
  type RemoteBind,
  type RemoteCommand,
  type RemoteEvent,
  type RemotePairingOffer,
  type RemoteSession,
  type RemoteSnapshot,
  type RemoteStatus,
} from '@builderhelm/protocol/remote';
import {
  BuilderHelmError,
  createCorrelationId,
  createId,
  utcNow,
} from '@builderhelm/shared';

import type { SecretStore } from '../secrets/secret-store.js';

const IDENTITY_REF = 'remote.host.ed25519';
const PAIR_TTL_MS = 2 * 60 * 1_000;
const SCOPES = ['observe', 'instruct', 'approve', 'cancel'] as const;

export interface RemoteHost {
  status(): RemoteStatus;
  artifacts(): readonly RemoteArtifact[];
  instruct(input: { readonly runId: string; readonly text: string }): void;
  approve(input: {
    readonly requestId: string;
    readonly decision: 'allow' | 'deny';
  }): void | Promise<void>;
  cancel(input: { readonly runId: string }): void;
}

interface StoredSession extends Record<string, unknown> {
  id: string;
  token_hash: string;
  client_label: string;
  scopes_json: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

interface StoredCommand extends Record<string, unknown> {
  id: string;
  session_id: string;
  kind: string;
  request_id: string | null;
  result_json: string;
  created_at: string;
}

interface StoredEvent extends Record<string, unknown> {
  seq: number;
  session_id: string;
  type: string;
  payload_json: string;
  created_at: string;
}

interface StoredAudit extends Record<string, unknown> {
  id: string;
  session_id: string;
  command_id: string | null;
  action: string;
  outcome: string;
  created_at: string;
}

interface HostIdentity {
  publicKey: Buffer;
  privateKey: Buffer;
}

interface Pairing {
  code: string;
  expiresAt: number;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprintOf(publicKey: Buffer): string {
  return sha256Hex(publicKey).slice(0, 32);
}

function tokenHash(token: string): string {
  return sha256Hex(token);
}

function sessionKeyRef(sessionId: string): string {
  return `remote.session.${sessionId}.key`;
}

function isLoopback(address: string): boolean {
  const ip = address.replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isPrivate(address: string): boolean {
  const ip = address.replace(/^::ffff:/, '');
  if (isLoopback(ip)) return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip);
}

function listenAddresses(bind: RemoteBind, port: number): string[] {
  const addresses = [`127.0.0.1:${port}`];
  if (bind === 'loopback') return addresses;
  for (const group of Object.values(networkInterfaces())) {
    for (const entry of group ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      if (isPrivate(entry.address)) addresses.push(`${entry.address}:${port}`);
    }
  }
  return addresses;
}

function codesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sealFrame(key: Buffer, payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString('base64');
}

export function openFrame(key: Buffer, sealed: string): unknown {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 29) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'Remote frame is truncated');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as unknown;
}

export function verifyHostSignature(
  publicKey: KeyObject,
  payload: Buffer,
  signature: Buffer,
): boolean {
  return verifyBytes(null, payload, publicKey, signature);
}

export class RemoteSessionService {
  private pairing: Pairing | null = null;
  private server: Server | null = null;
  private bind: RemoteBind = 'loopback';
  private port: number | null = null;
  private identity: HostIdentity | null = null;

  constructor(
    private readonly database: BuilderHelmDatabase,
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
    private readonly host: RemoteHost,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(): Promise<RemoteSnapshot> {
    const identity = await this.requireIdentity();
    const fingerprint = fingerprintOf(identity.publicKey);
    const pairing =
      this.pairing !== null && this.pairing.expiresAt > this.now().getTime()
        ? this.toPairingOffer(identity, this.pairing)
        : null;
    return remoteSnapshotSchema.parse({
      fingerprint,
      listening: this.server !== null,
      bind: this.bind,
      port: this.port,
      addresses: this.port === null ? [] : listenAddresses(this.bind, this.port),
      pairing,
      sessions: this.database
        .queryAll<StoredSession>(
          'SELECT * FROM ade_remote_sessions ORDER BY created_at DESC',
        )
        .map((row) => this.toSession(row)),
      audit: this.database
        .queryAll<StoredAudit>(
          'SELECT * FROM ade_remote_audit ORDER BY created_at DESC LIMIT 50',
        )
        .map((row) => this.toAudit(row)),
      hostMustRemainRunning: true,
    });
  }

  async listen(bind: RemoteBind, port = REMOTE_DEFAULT_PORT): Promise<RemoteSnapshot> {
    if (this.server !== null) await this.stop();
    this.bind = bind;
    await this.requireIdentity();
    const host = bind === 'private' ? '0.0.0.0' : '127.0.0.1';
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => resolve());
    });
    const address = this.server.address();
    this.port = typeof address === 'object' && address !== null ? address.port : port;
    return this.snapshot();
  }

  shutdown(): void {
    const server = this.server;
    this.server = null;
    this.port = null;
    server?.close();
  }

  async stop(): Promise<RemoteSnapshot> {
    this.shutdown();
    return this.snapshot();
  }

  async createPairing(): Promise<RemotePairingOffer> {
    const identity = await this.requireIdentity();
    if (this.server === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Start the local listener before pairing',
      );
    }
    this.pairing = {
      code: randomBytes(4).toString('hex'),
      expiresAt: this.now().getTime() + PAIR_TTL_MS,
    };
    return this.toPairingOffer(identity, this.pairing);
  }

  async pair(
    code: string,
    clientLabel: string,
  ): Promise<{
    session: RemoteSession;
    token: string;
    sessionKey: string;
    fingerprint: string;
    signature: string;
  }> {
    const identity = await this.requireIdentity();
    const pairing = this.pairing;
    this.pairing = null;
    if (pairing === null || pairing.expiresAt <= this.now().getTime()) {
      throw new BuilderHelmError('AUTH_FAILED', 'Pairing code expired');
    }
    if (!codesEqual(pairing.code, code)) {
      throw new BuilderHelmError('AUTH_FAILED', 'Pairing code is invalid');
    }
    const token = randomBytes(32).toString('hex');
    const key = randomBytes(32);
    const now = this.now().toISOString();
    const session = remoteSessionSchema.parse({
      id: createId(),
      clientLabel: clientLabel.trim().slice(0, 80) || 'companion',
      scopes: [...SCOPES],
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });
    this.database.run(
      `INSERT INTO ade_remote_sessions (
         id, token_hash, client_label, scopes_json, created_at, last_seen_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        session.id,
        tokenHash(token),
        session.clientLabel,
        JSON.stringify(session.scopes),
        session.createdAt,
        session.lastSeenAt,
      ],
    );
    await this.secrets.set(sessionKeyRef(session.id), key.toString('base64'));
    this.audit(session.id, null, 'pair', 'ok');
    const fingerprint = fingerprintOf(identity.publicKey);
    const signature = signBytes(
      null,
      Buffer.from(`${session.id}:${token}:${fingerprint}`),
      { key: identity.privateKey, format: 'der', type: 'pkcs8' },
    ).toString('base64');
    this.logger.info({
      event: 'remote.paired',
      correlationId: createCorrelationId(),
      data: { sessionId: session.id, clientLabel: session.clientLabel },
    });
    return { session, token, sessionKey: key.toString('base64'), fingerprint, signature };
  }

  async revoke(sessionId: string): Promise<RemoteSession> {
    const row = this.requireSession(sessionId);
    if (row.revoked_at !== null) return this.toSession(row);
    const now = this.now().toISOString();
    this.database.run(
      'UPDATE ade_remote_sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ?',
      [now, now, sessionId],
    );
    await this.secrets.delete(sessionKeyRef(sessionId));
    this.audit(sessionId, null, 'revoke', 'ok');
    return this.toSession(this.requireSession(sessionId));
  }

  async reconnect(
    token: string,
    lastSeq: number,
  ): Promise<{ session: RemoteSession; events: RemoteEvent[]; key: Buffer }> {
    const session = this.authenticate(token);
    const key = await this.sessionKey(session.id);
    const events = this.database
      .queryAll<StoredEvent>(
        'SELECT * FROM ade_remote_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC',
        [session.id, lastSeq],
      )
      .map((row) => this.toEvent(row));
    return { session: this.toSession(session), events, key };
  }

  async execute(token: string, raw: unknown): Promise<unknown> {
    const command = remoteCommandSchema.parse(raw);
    const session = this.authenticate(token);
    if (command.type === 'approve') {
      const replayed = this.database.queryOne<StoredCommand>(
        `SELECT * FROM ade_remote_commands
         WHERE id = ? OR (kind = 'approve' AND request_id = ?)`,
        [command.id, command.requestId],
      );
      if (replayed !== undefined) {
        this.audit(session.id, command.id, 'approve', 'replayed');
        throw new BuilderHelmError('PERMISSION_DENIED', 'Replayed approval');
      }
    } else {
      const existing = this.database.queryOne<StoredCommand>(
        'SELECT * FROM ade_remote_commands WHERE id = ?',
        [command.id],
      );
      if (existing !== undefined) return JSON.parse(existing.result_json) as unknown;
    }
    try {
      const result = await this.dispatch(command);
      this.database.run(
        `INSERT INTO ade_remote_commands (
           id, session_id, kind, request_id, result_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          command.id,
          session.id,
          command.type,
          command.type === 'approve' ? command.requestId : null,
          JSON.stringify(result ?? null),
          utcNow(),
        ],
      );
      this.appendEvent(session.id, 'command', { id: command.id, type: command.type });
      this.audit(session.id, command.id, command.type, 'ok');
      return result;
    } catch (error) {
      const denied =
        error instanceof BuilderHelmError && error.code === 'PERMISSION_DENIED';
      this.audit(session.id, command.id, command.type, denied ? 'denied' : 'error');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.shutdown();
  }

  private async dispatch(command: RemoteCommand): Promise<unknown> {
    switch (command.type) {
      case 'status':
        return remoteStatusSchema.parse(this.host.status());
      case 'artifacts':
        return this.host.artifacts().map((row) => remoteArtifactSchema.parse(row));
      case 'instruct':
        this.host.instruct({ runId: command.runId, text: command.text });
        return { ok: true };
      case 'approve':
        await this.host.approve({
          requestId: command.requestId,
          decision: command.decision,
        });
        return { ok: true };
      case 'cancel':
        this.host.cancel({ runId: command.runId });
        return { ok: true };
    }
  }

  private authenticate(token: string): StoredSession {
    const row = this.database.queryOne<StoredSession>(
      'SELECT * FROM ade_remote_sessions WHERE token_hash = ?',
      [tokenHash(token)],
    );
    if (row === undefined) {
      throw new BuilderHelmError('AUTH_FAILED', 'Unknown remote session');
    }
    if (row.revoked_at !== null) {
      throw new BuilderHelmError('AUTH_FAILED', 'Remote session revoked');
    }
    this.database.run('UPDATE ade_remote_sessions SET last_seen_at = ? WHERE id = ?', [
      this.now().toISOString(),
      row.id,
    ]);
    return this.requireSession(row.id);
  }

  private requireSession(id: string): StoredSession {
    const row = this.database.queryOne<StoredSession>(
      'SELECT * FROM ade_remote_sessions WHERE id = ?',
      [id],
    );
    if (row === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown remote session');
    }
    return row;
  }

  private async sessionKey(sessionId: string): Promise<Buffer> {
    const stored = await this.secrets.get(sessionKeyRef(sessionId));
    if (stored === null) {
      throw new BuilderHelmError('AUTH_FAILED', 'Remote session key is gone');
    }
    return Buffer.from(stored, 'base64');
  }

  private async requireIdentity(): Promise<HostIdentity> {
    if (this.identity !== null) return this.identity;
    const stored = await this.secrets.get(IDENTITY_REF);
    if (stored !== null) {
      const parsed = JSON.parse(stored) as { publicKey: string; privateKey: string };
      this.identity = {
        publicKey: Buffer.from(parsed.publicKey, 'base64'),
        privateKey: Buffer.from(parsed.privateKey, 'base64'),
      };
      return this.identity;
    }
    const pair = generateKeyPairSync('ed25519');
    const identity = {
      publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
    };
    await this.secrets.set(
      IDENTITY_REF,
      JSON.stringify({
        publicKey: identity.publicKey.toString('base64'),
        privateKey: identity.privateKey.toString('base64'),
      }),
    );
    this.identity = identity;
    return identity;
  }

  private toPairingOffer(identity: HostIdentity, pairing: Pairing): RemotePairingOffer {
    return remotePairingOfferSchema.parse({
      code: pairing.code,
      expiresAt: new Date(pairing.expiresAt).toISOString(),
      fingerprint: fingerprintOf(identity.publicKey),
      hostPublicKey: identity.publicKey.toString('base64'),
      addresses:
        this.port === null ? ['127.0.0.1:0'] : listenAddresses(this.bind, this.port),
      protocolVersion: REMOTE_PROTOCOL_VERSION,
    });
  }

  private toSession(row: StoredSession): RemoteSession {
    return remoteSessionSchema.parse({
      id: row.id,
      clientLabel: row.client_label,
      scopes: JSON.parse(row.scopes_json) as string[],
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
    });
  }

  private toEvent(row: StoredEvent): RemoteEvent {
    return remoteEventSchema.parse({
      seq: row.seq,
      type: row.type,
      payload: JSON.parse(row.payload_json) as unknown,
      createdAt: row.created_at,
    });
  }

  private toAudit(row: StoredAudit): RemoteAudit {
    return remoteAuditSchema.parse({
      id: row.id,
      sessionId: row.session_id,
      commandId: row.command_id,
      action: row.action,
      outcome: row.outcome,
      createdAt: row.created_at,
    });
  }

  private appendEvent(
    sessionId: string,
    type: RemoteEvent['type'],
    payload: unknown,
  ): void {
    this.database.run(
      `INSERT INTO ade_remote_events (session_id, type, payload_json, created_at)
       VALUES (?, ?, ?, ?)`,
      [sessionId, type, JSON.stringify(payload), utcNow()],
    );
  }

  private audit(
    sessionId: string,
    commandId: string | null,
    action: string,
    outcome: RemoteAudit['outcome'],
  ): void {
    this.database.run(
      `INSERT INTO ade_remote_audit (
         id, session_id, command_id, action, outcome, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [createId(), sessionId, commandId, action, outcome, utcNow()],
    );
  }

  private accept(socket: Socket): void {
    const peer = socket.remoteAddress ?? '';
    if (this.bind === 'loopback' ? !isLoopback(peer) : !isPrivate(peer)) {
      socket.destroy();
      return;
    }
    let buffer = '';
    let token: string | null = null;
    let key: Buffer | null = null;
    let chain = Promise.resolve();
    socket.on('data', (chunk) => {
      const piece = chunk.toString('utf8');
      chain = chain.then(async () => {
        buffer += piece;
        const state = await this.drain(socket, buffer, token, key);
        buffer = state.buffer;
        token = state.token;
        key = state.key;
      });
    });
  }

  private async drain(
    socket: Socket,
    buffer: string,
    token: string | null,
    key: Buffer | null,
  ): Promise<{ buffer: string; token: string | null; key: Buffer | null }> {
    let rest = buffer;
    let nextToken = token;
    let nextKey = key;
    let newline = rest.indexOf('\n');
    while (newline !== -1) {
      const line = rest.slice(0, newline).trim();
      rest = rest.slice(newline + 1);
      if (line.length > 0) {
        const state = await this.handleLine(socket, line, nextToken, nextKey);
        nextToken = state.token;
        nextKey = state.key;
      }
      newline = rest.indexOf('\n');
    }
    return { buffer: rest, token: nextToken, key: nextKey };
  }

  private async handleLine(
    socket: Socket,
    line: string,
    token: string | null,
    key: Buffer | null,
  ): Promise<{ token: string | null; key: Buffer | null }> {
    try {
      const frame = JSON.parse(line) as {
        v?: number;
        type?: string;
        code?: string;
        clientLabel?: string;
        token?: string;
        lastSeq?: number;
        s?: string;
      };
      if (frame.v !== REMOTE_PROTOCOL_VERSION) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Unsupported remote protocol');
      }
      if (frame.type === 'pair') {
        const paired = await this.pair(
          frame.code ?? '',
          frame.clientLabel ?? 'companion',
        );
        const sessionKey = Buffer.from(paired.sessionKey, 'base64');
        socket.write(
          `${JSON.stringify({
            v: REMOTE_PROTOCOL_VERSION,
            type: 'paired',
            sessionId: paired.session.id,
            token: paired.token,
            sessionKey: paired.sessionKey,
            fingerprint: paired.fingerprint,
            signature: paired.signature,
          })}\n`,
        );
        return { token: paired.token, key: sessionKey };
      }
      if (frame.type === 'reconnect') {
        const recovered = await this.reconnect(frame.token ?? '', frame.lastSeq ?? 0);
        socket.write(
          `${JSON.stringify({
            v: REMOTE_PROTOCOL_VERSION,
            type: 'frame',
            s: sealFrame(recovered.key, { events: recovered.events }),
          })}\n`,
        );
        return { token: frame.token ?? null, key: recovered.key };
      }
      if (
        token === null ||
        key === null ||
        frame.type !== 'frame' ||
        frame.s === undefined
      ) {
        throw new BuilderHelmError('AUTH_FAILED', 'Remote session required');
      }
      const command = openFrame(key, frame.s);
      const result = await this.execute(token, command);
      socket.write(
        `${JSON.stringify({
          v: REMOTE_PROTOCOL_VERSION,
          type: 'frame',
          s: sealFrame(key, { ok: true, result }),
        })}\n`,
      );
      return { token, key };
    } catch (error) {
      const message =
        error instanceof BuilderHelmError ? error.message : 'Remote command failed';
      const code = error instanceof BuilderHelmError ? error.code : 'INTERNAL_ERROR';
      socket.write(
        `${JSON.stringify({
          v: REMOTE_PROTOCOL_VERSION,
          type: 'error',
          code,
          message,
        })}\n`,
      );
      return { token, key };
    }
  }
}

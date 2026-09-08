import { createConnection } from 'node:net';
import { createPublicKey } from 'node:crypto';

import { migrations, openDatabase, runMigrations } from '@builderhelm/db';
import { createLogger } from '@builderhelm/observability';
import { createId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { MemorySecretStore } from '../src/secrets/secret-store.js';
import {
  openFrame,
  RemoteSessionService,
  sealFrame,
  verifyHostSignature,
  type RemoteHost,
} from '../src/remote/remote-session-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(async () => {
  await closer?.close();
  closer = null;
  while (databases.length > 0) databases.pop()?.close();
});

let closer: RemoteSessionService | null = null;

class FakeHost implements RemoteHost {
  instructs = 0;
  approvals: string[] = [];
  cancels = 0;
  statusValue = {
    hostAuthoritative: true as const,
    lifetime: 'desktop-open' as const,
    run: { id: '11111111-1111-4111-8111-111111111111', status: 'running' },
    pendingApprovals: [
      { requestId: '22222222-2222-4222-8222-222222222222', summary: 'edit README' },
    ],
  };
  artifactsValue = [
    {
      id: 'art-1',
      kind: 'snapshot',
      url: 'http://127.0.0.1:5173/',
      headSha: 'abc',
      createdAt: '2026-09-09T12:00:00.000Z',
    },
  ];

  status() {
    return this.statusValue;
  }
  artifacts() {
    return this.artifactsValue;
  }
  instruct() {
    this.instructs += 1;
  }
  approve(input: { requestId: string; decision: 'allow' | 'deny' }) {
    this.approvals.push(`${input.decision}:${input.requestId}`);
  }
  cancel() {
    this.cancels += 1;
  }
}

function setup(host = new FakeHost()) {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const remote = new RemoteSessionService(
    database,
    new MemorySecretStore(),
    createLogger(),
    host,
  );
  closer = remote;
  return { remote, host };
}

describe('RemoteSessionService', () => {
  it('pairs a client, then observes status and artifacts', async () => {
    const { remote } = setup();
    await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    const paired = await remote.pair(offer.code, 'phone');
    expect(paired.fingerprint).toBe(offer.fingerprint);
    const status = await remote.execute(paired.token, {
      id: createId(),
      type: 'status',
    });
    expect(status).toMatchObject({ hostAuthoritative: true, lifetime: 'desktop-open' });
    const artifacts = await remote.execute(paired.token, {
      id: createId(),
      type: 'artifacts',
    });
    expect(artifacts).toEqual([
      expect.objectContaining({ id: 'art-1', kind: 'snapshot' }),
    ]);
  });

  it('rejects a revoked session', async () => {
    const { remote } = setup();
    await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    const paired = await remote.pair(offer.code, 'phone');
    await remote.revoke(paired.session.id);
    await expect(
      remote.execute(paired.token, { id: createId(), type: 'status' }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('fails a replayed approval and does not re-approve', async () => {
    const { remote, host } = setup();
    await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    const paired = await remote.pair(offer.code, 'phone');
    const command = {
      id: createId(),
      type: 'approve' as const,
      requestId: '22222222-2222-4222-8222-222222222222',
      decision: 'allow' as const,
    };
    await remote.execute(paired.token, command);
    await expect(remote.execute(paired.token, command)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: 'Replayed approval',
    });
    await expect(
      remote.execute(paired.token, { ...command, id: createId() }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(host.approvals).toEqual(['allow:22222222-2222-4222-8222-222222222222']);
  });

  it('replays a duplicate instruct id without running it twice', async () => {
    const { remote, host } = setup();
    await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    const paired = await remote.pair(offer.code, 'phone');
    const command = {
      id: createId(),
      type: 'instruct' as const,
      runId: '11111111-1111-4111-8111-111111111111',
      text: 'fix the test',
    };
    await remote.execute(paired.token, command);
    await remote.execute(paired.token, command);
    expect(host.instructs).toBe(1);
  });

  it('reconnects by event sequence without duplicating commands', async () => {
    const { remote } = setup();
    await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    const paired = await remote.pair(offer.code, 'phone');
    await remote.execute(paired.token, { id: createId(), type: 'status' });
    await remote.execute(paired.token, {
      id: createId(),
      type: 'cancel',
      runId: '11111111-1111-4111-8111-111111111111',
    });
    const again = await remote.reconnect(paired.token, 0);
    expect(again.events.map((event) => event.seq)).toEqual([1, 2]);
    const tail = await remote.reconnect(paired.token, 2);
    expect(tail.events).toEqual([]);
  });

  it('rejects expired pairing and unknown command kinds', async () => {
    const { remote } = setup();
    await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    await expect(remote.pair('deadbeef', 'phone')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    const fresh = await remote.createPairing();
    expect(fresh.code).not.toBe(offer.code);
    const paired = await remote.pair(fresh.code, 'phone');
    await expect(
      remote.execute(paired.token, { id: createId(), type: 'shell' }),
    ).rejects.toThrow();
  });

  it('round-trips a sealed command over loopback TCP', async () => {
    const { remote } = setup();
    const snap = await remote.listen('loopback', 0);
    const offer = await remote.createPairing();
    const port = snap.port;
    if (port === null) throw new Error('missing port');

    const socket = createConnection({ host: '127.0.0.1', port });
    const lines: string[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject);
      socket.on('connect', () => {
        socket.write(
          `${JSON.stringify({
            v: 1,
            type: 'pair',
            code: offer.code,
            clientLabel: 'phone',
          })}\n`,
        );
      });
      socket.on('data', (chunk) => {
        lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
        if (lines.length >= 2) resolve();
        if (lines.length === 1) {
          const paired = JSON.parse(lines[0]!) as {
            token: string;
            sessionKey: string;
            fingerprint: string;
            signature: string;
          };
          const key = Buffer.from(paired.sessionKey, 'base64');
          const publicKey = createPublicKey({
            key: Buffer.from(offer.hostPublicKey, 'base64'),
            format: 'der',
            type: 'spki',
          });
          expect(
            verifyHostSignature(
              publicKey,
              Buffer.from(
                `${JSON.parse(lines[0]!).sessionId}:${paired.token}:${paired.fingerprint}`,
              ),
              Buffer.from(paired.signature, 'base64'),
            ),
          ).toBe(true);
          socket.write(
            `${JSON.stringify({
              v: 1,
              type: 'frame',
              s: sealFrame(key, { id: createId(), type: 'status' }),
            })}\n`,
          );
        }
      });
    });
    const paired = JSON.parse(lines[0]!) as { sessionKey: string };
    const reply = JSON.parse(lines[1]!) as { s: string };
    const opened = openFrame(Buffer.from(paired.sessionKey, 'base64'), reply.s) as {
      ok: boolean;
      result: { hostAuthoritative: boolean };
    };
    expect(opened.ok).toBe(true);
    expect(opened.result.hostAuthoritative).toBe(true);
    socket.end();
  });
});

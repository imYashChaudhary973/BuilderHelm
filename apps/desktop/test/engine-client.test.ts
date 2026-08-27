import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ipcChannels } from '@zero/protocol';

import {
  checkContract,
  EngineClient,
  ENGINE_PROTOCOL,
  redact,
  type EngineHello,
} from '../src/main/engine-client.js';

const bin = join(process.cwd(), 'target', 'debug', 'helm-app');
const expected = Object.values(ipcChannels);

function hello(overrides: Partial<EngineHello> = {}): EngineHello {
  return {
    protocol: ENGINE_PROTOCOL,
    engine: '0.0.0',
    host: 'conformance',
    channelCount: expected.length,
    channels: expected,
    events: [],
    testControls: false,
    ...overrides,
  };
}

describe('engine contract check', () => {
  it('accepts a handshake that matches this build', () => {
    expect(checkContract(hello(), expected)).toEqual({ fatal: [], warnings: [] });
  });

  it('rejects a protocol it cannot speak', () => {
    const { fatal } = checkContract(hello({ protocol: 99 }), expected);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toContain('protocol 99');
  });

  it('rejects a count that disagrees with the list', () => {
    expect(checkContract(hello({ channelCount: 70 }), expected).fatal[0]).toContain(
      'listed',
    );
  });

  it('treats a channel we call but the engine lacks as fatal', () => {
    const short = expected.slice(0, -1);
    const { fatal } = checkContract(
      hello({ channels: short, channelCount: short.length }),
      expected,
    );
    expect(fatal[0]).toContain('engine missing:');
  });

  it('treats an engine that is ahead of us as a warning, not a failure', () => {
    // The normal state under a Rust-first plan: the engine lands a channel
    // before any TypeScript caller exists. This must not block boot.
    const padded = [...expected, 'zero:invented:channel'];
    const { fatal, warnings } = checkContract(
      hello({ channels: padded, channelCount: padded.length }),
      expected,
    );
    expect(fatal).toEqual([]);
    expect(warnings[0]).toContain('zero:invented:channel');
  });
});

describe('log redaction', () => {
  it('masks tokens, secrets, and home paths', () => {
    expect(redact('token gho_abcdef123456 leaked')).toBe('token gho_*** leaked');
    expect(redact('sk-live-abcdef')).toBe('sk-***');
    expect(redact('{"apiKey":"abcdef"}')).toBe('{"apiKey":"***"}');
    expect(redact('at /Users/yash/Desktop/x.rs')).toBe('at /Users/***/Desktop/x.rs');
    expect(redact('at /home/yash/x.rs')).toBe('at /home/***/x.rs');
  });

  it('leaves ordinary lines alone', () => {
    expect(redact('engine: ready')).toBe('engine: ready');
  });
});

// These drive the real binary. Skipped when it has not been built, so the
// suite still runs on a checkout without a Rust toolchain.
describe.skipIf(!existsSync(bin))('engine sidecar over stdio', () => {
  it('handshakes, serves a channel, and stops cleanly', async () => {
    const logs: string[] = [];
    const client = new EngineClient({
      bin,
      expectedChannels: expected,
      onLog: (line) => logs.push(line),
    });
    const handshake = await client.start();
    expect(handshake.protocol).toBe(ENGINE_PROTOCOL);
    // The engine currently runs ahead of the TypeScript map (`zero:helm` and
    // `zero:swarm:add-seat` have no TS caller yet), so assert containment
    // rather than equality.
    expect(handshake.channels).toEqual(expect.arrayContaining([...expected]));
    expect(logs.join(' ')).toContain('engine serves channels we do not call');
    // Phase A ships no engine-side event source; a consumer must not assume one.
    expect(handshake.events).toEqual([]);
    expect(handshake.testControls).toBe(false);
    expect(client.running).toBe(true);

    const health = (await client.invoke(ipcChannels.systemHealth, {
      correlationId: '11111111-2222-4333-8444-555555555555',
    })) as Record<string, unknown>;
    expect(health['status']).toBe('ok');
    expect(health['database']).toBe('ready');
    expect(health['correlationId']).toBe('11111111-2222-4333-8444-555555555555');

    await client.stop();
    expect(client.running).toBe(false);
    expect(client.handshake).toBeUndefined();
  });

  it('keeps serving after a rejected request', async () => {
    const client = new EngineClient({ bin, expectedChannels: expected });
    await client.start();
    // A bad correlationId is a channel-level failure, not a transport one.
    const bad = (await client.invoke(ipcChannels.systemHealth, {
      correlationId: 'not-a-uuid',
    })) as Record<string, unknown>;
    expect(bad['ok']).toBe(false);

    const good = (await client.invoke(ipcChannels.systemHealth, {
      correlationId: '11111111-2222-4333-8444-555555555555',
    })) as Record<string, unknown>;
    expect(good['status']).toBe('ok');
    await client.stop();
  });

  it('correlates concurrent replies to their own callers', async () => {
    const client = new EngineClient({ bin, expectedChannels: expected });
    await client.start();
    const ids = Array.from(
      { length: 8 },
      (_unused, index) => `1111111${String(index)}-2222-4333-8444-555555555555`,
    );
    const results = (await Promise.all(
      ids.map((correlationId) =>
        client.invoke(ipcChannels.systemHealth, { correlationId }),
      ),
    )) as Record<string, unknown>[];
    // Each answer must carry back its own correlation id, in order.
    expect(results.map((row) => row['correlationId'])).toEqual(ids);
    await client.stop();
  });

  it('abandons an aborted request without disturbing the next one', async () => {
    const client = new EngineClient({ bin, expectedChannels: expected });
    await client.start();
    const controller = new AbortController();
    const pending = client.invoke(
      ipcChannels.systemHealth,
      { correlationId: '11111111-2222-4333-8444-555555555555' },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');

    const after = (await client.invoke(ipcChannels.systemHealth, {
      correlationId: '99999999-2222-4333-8444-555555555555',
    })) as Record<string, unknown>;
    expect(after['status']).toBe('ok');
    await client.stop();
  });

  it('refuses a build whose channel map disagrees', async () => {
    const client = new EngineClient({
      bin,
      expectedChannels: [...expected, 'zero:invented:channel'],
    });
    await expect(client.start()).rejects.toThrow('contract mismatch');
    // A refused handshake must not leave a child behind.
    expect(client.running).toBe(false);
  });

  it('rejects in-flight calls when the engine is gone', async () => {
    const client = new EngineClient({ bin, expectedChannels: expected });
    await client.start();
    await client.stop();
    await expect(
      client.invoke(ipcChannels.systemHealth, {
        correlationId: '11111111-2222-4333-8444-555555555555',
      }),
    ).rejects.toThrow('not running');
  });

  it('fails closed when the binary is missing', async () => {
    const client = new EngineClient({
      bin: join(process.cwd(), 'target', 'debug', 'helm-app-does-not-exist'),
      expectedChannels: expected,
      handshakeTimeoutMs: 5_000,
    });
    await expect(client.start()).rejects.toThrow(/spawn failed|handshake/);
    expect(client.running).toBe(false);
  });
});

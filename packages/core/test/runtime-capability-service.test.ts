import { describe, expect, it } from 'vitest';

import {
  deriveTier,
  RuntimeCapabilityService,
} from '../src/runtimes/runtime-capability-service.js';
import type { RuntimeTransportDeclaration } from '@builderhelm/protocol';

const present: RuntimeTransportDeclaration = {
  id: 'codex',
  label: 'Codex',
  transport: 'pty',
  command: 'codex',
  args: [],
  verified: null,
  evidence: null,
  configured: false,
};

const acp: RuntimeTransportDeclaration = {
  ...present,
  transport: 'acp',
  command: 'codex-acp',
  verified: 'structured-chat',
  evidence: 'verified locally',
};

describe('runtime capability tiers', () => {
  it('keeps unavailable, untested, and verified strictly apart', () => {
    expect(deriveTier(false, [])).toBe('unavailable');
    expect(deriveTier(false, ['structured-chat'])).toBe('unavailable');
    expect(deriveTier(true, [])).toBe('untested');
    expect(deriveTier(true, ['terminal'])).toBe('terminal');
    expect(deriveTier(true, ['structured-chat'])).toBe('structured-chat');
  });

  it('keeps the strongest verified transport', () => {
    expect(deriveTier(true, ['terminal', 'structured-chat'])).toBe('structured-chat');
    expect(deriveTier(true, ['structured-chat', 'orchestration-ready'])).toBe(
      'orchestration-ready',
    );
    expect(deriveTier(true, ['orchestration-ready', 'terminal'])).toBe(
      'orchestration-ready',
    );
  });
});

describe('RuntimeCapabilityService', () => {
  const noVersion = async () => null;
  const okResolve = async (command: string) => `/usr/local/bin/${command}`;

  it('reports an absent command as unavailable without probing versions', async () => {
    const service = new RuntimeCapabilityService([present], {
      resolve: async () => null,
      runVersion: noVersion,
      now: () => '2026-09-08T00:00:00.000Z',
    });

    const snapshot = await service.snapshot();
    expect(snapshot.runtimes).toHaveLength(1);
    const [runtime] = snapshot.runtimes;
    expect(runtime).toMatchObject({
      id: 'codex',
      path: null,
      version: null,
      tier: 'unavailable',
      detail: null,
    });
  });

  it('marks a detected but unverified runtime untested, with an honest note', async () => {
    const service = new RuntimeCapabilityService([present], {
      resolve: okResolve,
      runVersion: async () => 'codex-cli 0.9.0\n',
      now: () => '2026-09-08T00:00:00.000Z',
    });

    const [runtime] = (await service.snapshot()).runtimes;
    expect(runtime).toMatchObject({
      path: '/usr/local/bin/codex',
      version: 'codex-cli 0.9.0',
      tier: 'untested',
    });
    expect(runtime.detail).toContain('no BuilderHelm-checked path');
  });

  it('groups transports per runtime and keeps the verified tier', async () => {
    const service = new RuntimeCapabilityService([acp, present], {
      resolve: okResolve,
      runVersion: async () => null,
      now: () => '2026-09-08T00:00:00.000Z',
    });

    const [runtime] = (await service.snapshot()).runtimes;
    expect(runtime!.transports).toEqual(['acp', 'pty']);
    expect(runtime!.tier).toBe('structured-chat');
    expect(runtime!.version).toBeNull();
  });

  it('falls back across version flags and stays present when all fail', async () => {
    const tried: readonly string[][] = [];
    const service = new RuntimeCapabilityService([present], {
      resolve: okResolve,
      runVersion: async (_path, args) => {
        (tried as string[][]).push([...args]);
        return args[0] === '-v' ? '1.2.3' : null;
      },
    });

    const [runtime] = (await service.snapshot()).runtimes;
    expect(tried.map((entry) => entry[0])).toEqual(['--version', '-v']);
    expect(runtime!.version).toBe('1.2.3');
  });

  it('explains a configured command that disappeared', async () => {
    const service = new RuntimeCapabilityService([{ ...acp, configured: true }], {
      resolve: async () => null,
      runVersion: noVersion,
    });

    const [runtime] = (await service.snapshot()).runtimes;
    expect(runtime!.tier).toBe('unavailable');
    expect(runtime!.detail).toContain('no longer resolves on PATH');
  });

  it('sorts the matrix by id', async () => {
    const service = new RuntimeCapabilityService(
      [
        { ...present, id: 'zeta', label: 'Z' },
        { ...present, id: 'alpha', label: 'A' },
      ],
      { resolve: async () => null, runVersion: noVersion },
    );

    expect((await service.snapshot()).runtimes.map((r) => r.id)).toEqual([
      'alpha',
      'zeta',
    ]);
  });
});

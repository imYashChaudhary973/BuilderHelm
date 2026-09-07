/**
 * The manager is the only place that can start agent processes, so its
 * boundaries — the live-session ceiling and profile-resolved argv — are
 * regression-tested here with the session spawn faked out.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { AgentCapabilities, AgentConfigOption } from '@builderhelm/protocol';
import { AgentManager, MAX_LIVE_AGENT_SESSIONS } from '../src/main/acp/manager.js';
import { AgentThreads } from '../src/main/acp/threads.js';
import { PermissionRules } from '../src/main/acp/permission-rules.js';

vi.mock('../src/main/acp/session.js', () => ({
  confinePath: (cwd: string, candidate: string) => `${cwd}/${candidate}`,
  AcpSession: {
    start: vi.fn(async () => fakeSession()),
  },
}));

let sessionCounter = 0;
function fakeSession() {
  const id = `sess-${(sessionCounter += 1)}`;
  const capabilities: AgentCapabilities = {
    loadSession: false,
    resumeSession: false,
    promptImage: false,
    promptAudio: false,
    promptEmbeddedContext: false,
  };
  const configOptions: readonly AgentConfigOption[] = [];
  return {
    id,
    capabilitySnapshot: capabilities,
    configSnapshot: configOptions,
    prompt: vi.fn(async () => {}),
    cancel: vi.fn(),
    setConfigOption: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function memoryStore(): {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
} {
  const rows = new Map<string, string>();
  return {
    read: (key) => rows.get(key),
    write: (key, valueJson) => {
      rows.set(key, valueJson);
    },
  };
}

const codex = { id: 'codex', label: 'Codex', command: 'codex-acp', args: [] };
const profileId = `profile-${randomUUID()}`;

function manager(): AgentManager {
  return new AgentManager({
    emit: () => {},
    rules: new PermissionRules(memoryStore()),
    threads: new AgentThreads(memoryStore()),
    resolveAgent: (agentId) => (agentId === 'codex' ? { ...codex } : null),
    resolveProfile: (id) =>
      id === profileId
        ? {
            id,
            name: 'Social Content Manager',
            mark: 'diamond',
            agent: { ...codex, args: ['--profile'] },
            defaultCwd: null,
            createdAt: '2026-09-07T00:00:00.000Z',
            lastOpenedAt: '2026-09-07T00:00:00.000Z',
          }
        : null,
  });
}

describe('agent manager', () => {
  it('refuses to start a session past the live ceiling', async () => {
    const helm = manager();
    for (let at = 0; at < MAX_LIVE_AGENT_SESSIONS; at += 1) {
      await helm.start({
        agentId: 'codex',
        cwd: '/tmp/roster',
        threadId: null,
        resumeSessionId: null,
        profileId: null,
      });
    }
    await expect(
      helm.start({
        agentId: 'codex',
        cwd: '/tmp/roster',
        threadId: null,
        resumeSessionId: null,
        profileId: null,
      }),
    ).rejects.toThrowError(/at most/);
  });

  it('resolves a profile-backed start in main and records the profile on the thread', async () => {
    const helm = manager();
    const started = await helm.start({
      agentId: 'codex',
      cwd: '/tmp/roster',
      threadId: null,
      resumeSessionId: null,
      profileId,
    });

    expect(started.agent.args).toEqual(['--profile']);
    const thread = helm.threads().find((item) => item.id === started.threadId);
    expect(thread?.profileId).toBe(profileId);
  });

  it('refuses a start whose profile is unknown', async () => {
    const helm = manager();
    await expect(
      helm.start({
        agentId: 'codex',
        cwd: '/tmp/roster',
        threadId: null,
        resumeSessionId: null,
        profileId: 'profile-00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrowError(/profile was not found/);
  });
});

/**
 * The manager is the only place that can start agent processes, so its
 * boundaries — the live-session ceiling, profile-resolved argv, and a project
 * folder that must actually exist — are regression-tested here with the
 * session spawn faked out.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type {
  AgentCapabilities,
  AgentConfigOption,
  AgentPermissionDecision,
  AgentToolCall,
} from '@builderhelm/protocol';
import { AcpSession } from '../src/main/acp/session.js';
import { AgentManager, MAX_LIVE_AGENT_SESSIONS } from '../src/main/acp/manager.js';
import { AgentThreads } from '../src/main/acp/threads.js';
import { PermissionRules } from '../src/main/acp/permission-rules.js';

const hoisted = vi.hoisted(() => ({
  resolvePermission: undefined as
    | ((request: {
        readonly requestId: string;
        readonly sessionId: string;
        readonly toolCall: AgentToolCall;
        readonly options: readonly never[];
      }) => Promise<AgentPermissionDecision>)
    | undefined,
}));

vi.mock('../src/main/acp/session.js', () => ({
  confinePath: (cwd: string, candidate: string) => `${cwd}/${candidate}`,
  AcpSession: {
    start: vi.fn(
      async (options: { resolvePermission: typeof hoisted.resolvePermission }) => {
        hoisted.resolvePermission = options.resolvePermission;
        return fakeSession();
      },
    ),
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
            launch: null,
            instructions: '',
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
        cwd: '/tmp',
        threadId: null,
        resumeSessionId: null,
        profileId: null,
      });
    }
    await expect(
      helm.start({
        agentId: 'codex',
        cwd: '/tmp',
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
      cwd: '/tmp',
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
        cwd: '/tmp',
        threadId: null,
        resumeSessionId: null,
        profileId: 'profile-00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrowError(/profile was not found/);
  });

  it('refuses a start whose project folder is not on disk', async () => {
    const helm = manager();
    await expect(
      helm.start({
        agentId: 'codex',
        cwd: '/tmp/bh-manager-test-does-not-exist',
        threadId: null,
        resumeSessionId: null,
        profileId: null,
      }),
    ).rejects.toThrowError(/does not exist/);
  });

  it('cancels a pending approval so a late click cannot execute', async () => {
    const helm = manager();
    const started = await helm.start({
      agentId: 'codex',
      cwd: '/tmp',
      threadId: null,
      resumeSessionId: null,
      profileId: null,
      launch: null,
    });
    const pending = hoisted.resolvePermission!({
      requestId: 'req-1',
      sessionId: started.sessionId,
      toolCall: {
        toolCallId: 't1',
        title: 'run',
        kind: 'execute',
        status: 'pending',
        content: [],
        paths: [],
      },
      options: [],
    });
    helm.cancel(started.sessionId);
    await expect(pending).resolves.toBe('cancelled');
    helm.respond(started.sessionId, 'req-1', 'allow-once');
  });

  it('ignores an approval answered for a different session', async () => {
    const helm = manager();
    const started = await helm.start({
      agentId: 'codex',
      cwd: '/tmp',
      threadId: null,
      resumeSessionId: null,
      profileId: null,
      launch: null,
    });
    const pending = hoisted.resolvePermission!({
      requestId: 'req-2',
      sessionId: started.sessionId,
      toolCall: {
        toolCallId: 't2',
        title: 'run',
        kind: 'execute',
        status: 'pending',
        content: [],
        paths: [],
      },
      options: [],
    });
    helm.respond('other-session', 'req-2', 'allow-once');
    helm.respond(started.sessionId, 'req-2', 'reject-once');
    await expect(pending).resolves.toBe('reject-once');
  });
});

describe('thread login binding', () => {
  function setupBound() {
    let active = 'codex:personal';
    let disabled = false;
    const store = memoryStore();
    const threads = new AgentThreads(store);
    const helm = new AgentManager({
      emit() {},
      rules: new PermissionRules(store),
      threads,
      resolveAgent: () => codex,
      resolveProfile: () => null,
      resolveLaunch: (_id, requested) => {
        const ref = requested ?? active;
        if (disabled && ref === 'codex:personal') throw new Error('Login disabled');
        return { accountRef: ref, env: { CODEX_HOME: `/tmp/${ref}` } };
      },
    });
    return {
      helm,
      threads,
      setActive: (ref: string) => {
        active = ref;
      },
      disable: () => {
        disabled = true;
      },
    };
  }
  const startInput = {
    agentId: 'codex',
    cwd: '/tmp',
    threadId: null,
    resumeSessionId: null,
    profileId: null,
  };
  it('persists the chosen login and resumes on it after the active login changes', async () => {
    const { helm, threads, setActive } = setupBound();
    const first = await helm.start(startInput);
    expect(threads.get(first.threadId)?.thread.accountRef).toBe('codex:personal');
    await helm.closeAll();
    setActive('codex:work');
    await helm.start({ ...startInput, threadId: first.threadId });
    expect(vi.mocked(AcpSession.start).mock.calls.at(-1)?.[0].env).toEqual({
      CODEX_HOME: '/tmp/codex:personal',
    });
    await helm.closeAll();
    const before = vi.mocked(AcpSession.start).mock.calls.length;
    await expect(
      helm.start({
        ...startInput,
        threadId: first.threadId,
        launch: { model: null, effort: null, accountRef: 'codex:work' },
      }),
    ).rejects.toThrow(/another login/);
    expect(vi.mocked(AcpSession.start).mock.calls.length).toBe(before);
  });
  it('refuses new turns on a disabled login even when its process is still live', async () => {
    const { helm, disable } = setupBound();
    const first = await helm.start(startInput);
    disable();
    await expect(
      helm.prompt(first.sessionId, [{ type: 'text', text: 'Run a tool' }]),
    ).rejects.toThrow(/disabled/);
    await expect(helm.start({ ...startInput, threadId: first.threadId })).rejects.toThrow(
      /disabled/,
    );
  });
  it('refuses a legacy resume whose account was never recorded', async () => {
    const { helm, threads } = setupBound();
    const legacy = threads.create(codex, '/tmp');
    await expect(helm.start({ ...startInput, threadId: legacy.id })).rejects.toThrow(
      /no recorded login/,
    );
  });
});

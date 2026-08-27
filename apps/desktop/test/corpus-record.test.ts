import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createId } from '@zero/shared';
import { describe, expect, it } from 'vitest';

import { sanitize } from './corpus-match.js';
import { createTsHost, type TsHost } from './corpus-host.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'conformance');
const CID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const RID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

const providerInput = {
  label: 'Example',
  protocol: 'openai' as const,
  baseUrl: 'https://api.example.test/v1',
  headers: [] as const,
  privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
  enabled: true,
  apiKey: 'phase-one-secret-sentinel',
};

type Step = { channel: string; input: unknown };

function writeFixture(
  ns: string,
  method: string,
  name: string,
  channel: string,
  input: unknown,
  expected: unknown,
  extra: Record<string, unknown> = {},
) {
  const dir = join(root, ns, method);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    `${JSON.stringify({ channel, input, expected, ...extra }, null, 2)}\n`,
  );
}

async function rec(
  host: TsHost,
  ns: string,
  method: string,
  name: string,
  channel: string,
  input: unknown,
  setup: Step[] = [],
  extra: Record<string, unknown> = {},
) {
  const setupResults: unknown[] = [];
  for (const step of setup) {
    setupResults.push(await host.invoke(step.channel, step.input));
  }
  const actual = await host.invoke(channel, input);
  writeFixture(ns, method, name, channel, input, sanitize(actual), {
    ...(setup.length > 0 ? { setup } : {}),
    ...extra,
  });
  return actual;
}

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zero-corpus-git-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Corpus'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'corpus@example.test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# corpus\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'start'], { cwd: dir });
  return dir;
}

function asList(result: unknown): Array<{ id: string; label?: string }> {
  if (Array.isArray(result)) return result as Array<{ id: string; label?: string }>;
  if (result !== null && typeof result === 'object' && 'value' in result) {
    const value = result.value;
    if (Array.isArray(value)) return value as Array<{ id: string; label?: string }>;
  }
  return [];
}

describe.skipIf(process.env.RECORD_CORPUS !== '1')('record conformance corpus', () => {
  it('captures live IPC results', async () => {
    const temps: string[] = [];
    const host = createTsHost();
    try {
      await rec(host, 'system', 'health', 'healthy', 'zero:system:health', {
        correlationId: CID,
      });
      await rec(host, 'system', 'health', 'degraded', 'zero:system:health', {
        correlationId: 'not-a-uuid',
      });

      await rec(host, 'providers', 'list', 'empty', 'zero:provider:list', {
        correlationId: CID,
      });
      await rec(host, 'providers', 'create', 'happy', 'zero:provider:create', {
        correlationId: CID,
        input: providerInput,
      });
      await rec(host, 'providers', 'list', 'one', 'zero:provider:list', {
        correlationId: CID,
      });
      await rec(host, 'providers', 'create', 'duplicate', 'zero:provider:create', {
        correlationId: CID,
        input: providerInput,
      });
      await rec(host, 'providers', 'create', 'empty-label', 'zero:provider:create', {
        correlationId: CID,
        input: { ...providerInput, label: '' },
      });
      await rec(host, 'providers', 'create', 'http-remote', 'zero:provider:create', {
        correlationId: CID,
        input: { ...providerInput, label: 'Http', baseUrl: 'http://example.test/v1' },
      });
      const created = (await host.invoke('zero:provider:list', { correlationId: CID })) as {
        ok: boolean;
        value: Array<{ id: string }>;
      };
      const providerId = asList(created)[0]?.id ?? RID;
      await rec(host, 'providers', 'update', 'rename', 'zero:provider:update', {
        correlationId: CID,
        input: { id: providerId, label: 'Renamed' },
      });
      await rec(host, 'providers', 'update', 'missing', 'zero:provider:update', {
        correlationId: CID,
        input: { id: RID, label: 'Nope' },
      });
      await rec(
        host,
        'providers',
        'testConnection',
        'ok',
        'zero:provider:test-connection',
        { correlationId: CID, input: { providerId } },
      );
      await host.secrets.delete(providerId);
      await rec(
        host,
        'providers',
        'testConnection',
        'missing-keychain',
        'zero:provider:test-connection',
        { correlationId: CID, input: { providerId } },
      );
      await rec(
        host,
        'providers',
        'testConnection',
        'unknown',
        'zero:provider:test-connection',
        { correlationId: CID, input: { providerId: RID } },
      );
      await rec(host, 'providers', 'delete', 'happy', 'zero:provider:delete', {
        correlationId: CID,
        input: { id: providerId },
      });
      await rec(host, 'providers', 'delete', 'missing', 'zero:provider:delete', {
        correlationId: CID,
        input: { id: RID },
      });
      await rec(host, 'providers', 'create', 'invalid-key-then-test', 'zero:provider:create', {
        correlationId: CID,
        input: { ...providerInput, label: 'BadKey', apiKey: 'invalid' },
      });
      const bad = (await host.invoke('zero:provider:list', { correlationId: CID })) as {
        value: Array<{ id: string; label: string }>;
      };
      const badId = asList(bad).find((row) => row.label === 'BadKey')?.id ?? RID;
      await rec(
        host,
        'providers',
        'testConnection',
        'invalid-key',
        'zero:provider:test-connection',
        { correlationId: CID, input: { providerId: badId } },
      );
      await rec(host, 'providers', 'list', 'invalid-request', 'zero:provider:list', {});

      await rec(host, 'models', 'list', 'empty-filter', 'zero:model:list', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'models', 'discover', 'unknown', 'zero:model:discover', {
        correlationId: CID,
        input: { providerId: RID },
      });
      await rec(host, 'models', 'discover', 'invalid-key', 'zero:model:discover', {
        correlationId: CID,
        input: { providerId: badId },
      });
      await rec(
        host,
        'models',
        'listCapabilityOverrides',
        'empty',
        'zero:model-capability-override:list',
        { correlationId: CID, input: {} },
      );
      await rec(
        host,
        'models',
        'updateCapabilityOverride',
        'missing-model',
        'zero:model-capability-override:update',
        { correlationId: CID, input: { modelRef: `${RID}:gpt-test`, tools: true } },
      );
      await rec(host, 'models', 'list', 'unknown-provider', 'zero:model:list', {
        correlationId: CID,
        input: { providerId: RID },
      });
      await rec(host, 'models', 'list', 'invalid', 'zero:model:list', { correlationId: CID });
      await rec(host, 'models', 'discover', 'invalid', 'zero:model:discover', {
        correlationId: CID,
        input: {},
      });
      await rec(
        host,
        'models',
        'listCapabilityOverrides',
        'unknown-provider',
        'zero:model-capability-override:list',
        { correlationId: CID, input: { providerId: RID } },
      );
      await rec(
        host,
        'models',
        'updateCapabilityOverride',
        'invalid',
        'zero:model-capability-override:update',
        { correlationId: CID, input: {} },
      );

      await rec(host, 'chat', 'list', 'empty', 'zero:chat:list', { correlationId: CID });
      await rec(host, 'chat', 'create', 'happy', 'zero:chat:create', {
        correlationId: CID,
        input: { title: 'Thread' },
      });
      await rec(host, 'chat', 'create', 'empty-title', 'zero:chat:create', {
        correlationId: CID,
        input: { title: '' },
      });
      await rec(host, 'chat', 'get', 'missing', 'zero:chat:get', {
        correlationId: CID,
        input: { threadId: RID },
      });
      const threads = (await host.invoke('zero:chat:list', { correlationId: CID })) as {
        value: Array<{ id: string }>;
      };
      const threadId = threads.value[0]?.id ?? RID;
      await rec(host, 'chat', 'get', 'happy', 'zero:chat:get', {
        correlationId: CID,
        input: { threadId },
      });
      await rec(host, 'chat', 'list', 'one', 'zero:chat:list', { correlationId: CID });
      await rec(host, 'chat', 'startStream', 'missing-thread', 'zero:chat:stream-start', {
        correlationId: CID,
        runId: RID,
        input: { threadId: RID, modelRef: `${RID}:gpt-test`, content: 'Hi' },
      });
      await rec(host, 'chat', 'startStream', 'invalid', 'zero:chat:stream-start', {
        correlationId: CID,
        runId: RID,
        input: {},
      });
      await rec(host, 'chat', 'cancelStream', 'unknown', 'zero:chat:stream-cancel', {
        correlationId: CID,
        input: { runId: RID },
      });
      await rec(host, 'chat', 'cancelStream', 'invalid', 'zero:chat:stream-cancel', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'chat', 'create', 'invalid', 'zero:chat:create', { correlationId: CID });
      await rec(host, 'chat', 'get', 'invalid', 'zero:chat:get', { correlationId: CID });
      await rec(host, 'chat', 'list', 'invalid', 'zero:chat:list', {});
      await rec(host, 'chat', 'startStream', 'extra-secret-field', 'zero:chat:stream-start', {
        correlationId: CID,
        runId: RID,
        input: {
          threadId,
          modelRef: `${RID}:gpt-test`,
          content: 'Hi',
          apiKey: 'sk-leak',
        },
      });
      await rec(host, 'chat', 'create', 'long-title', 'zero:chat:create', {
        correlationId: CID,
        input: { title: 'x'.repeat(500) },
      });
      await rec(host, 'chat', 'get', 'not-uuid', 'zero:chat:get', {
        correlationId: CID,
        input: { threadId: 'nope' },
      });
      await rec(host, 'chat', 'cancelStream', 'not-uuid', 'zero:chat:stream-cancel', {
        correlationId: CID,
        input: { runId: 'nope' },
      });
      await rec(host, 'chat', 'startStream', 'empty-content', 'zero:chat:stream-start', {
        correlationId: CID,
        runId: RID,
        input: { threadId, modelRef: `${RID}:gpt-test`, content: '' },
      });

      await rec(host, 'knowledge', 'listVaults', 'empty', 'zero:knowledge:vault-list', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'knowledge', 'listVaults', 'invalid', 'zero:knowledge:vault-list', {});
      const vault = mkdtempSync(join(tmpdir(), 'zero-vault-'));
      temps.push(vault);
      writeFileSync(join(vault, 'note.md'), 'Alpha is Y that does Z.\n');
      host.setDialogFolder(vault);
      await rec(host, 'knowledge', 'selectVault', 'picked', 'zero:knowledge:vault-select', {
        correlationId: CID,
      });
      host.setDialogFolder(vault, true);
      await rec(host, 'knowledge', 'selectVault', 'canceled', 'zero:knowledge:vault-select', {
        correlationId: CID,
      });
      const vaults = (await host.invoke('zero:knowledge:vault-list', {
        correlationId: CID,
        input: {},
      })) as { value: Array<{ id: string }> };
      const vaultId = vaults.value[0]?.id;
      if (vaultId !== undefined) {
        await rec(host, 'knowledge', 'syncVault', 'happy', 'zero:knowledge:vault-sync', {
          correlationId: CID,
          input: { vaultId },
        });
        await rec(host, 'knowledge', 'answer', 'query', 'zero:knowledge:query', {
          correlationId: CID,
          input: { vaultId, query: 'Alpha' },
        });
        await rec(host, 'knowledge', 'answer', 'empty-query', 'zero:knowledge:query', {
          correlationId: CID,
          input: { vaultId, query: '' },
        });
      }
      await rec(host, 'knowledge', 'syncVault', 'missing', 'zero:knowledge:vault-sync', {
        correlationId: CID,
        input: { vaultId: RID },
      });
      await rec(host, 'knowledge', 'answer', 'missing-vault', 'zero:knowledge:query', {
        correlationId: CID,
        input: { vaultId: RID, query: 'Alpha' },
      });
      await rec(host, 'knowledge', 'getSource', 'missing', 'zero:knowledge:source-get', {
        correlationId: CID,
        input: { sourceId: RID },
      });
      await rec(host, 'knowledge', 'getSource', 'invalid', 'zero:knowledge:source-get', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'knowledge', 'syncVault', 'invalid', 'zero:knowledge:vault-sync', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'knowledge', 'answer', 'invalid', 'zero:knowledge:query', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'knowledge', 'listVaults', 'extra', 'zero:knowledge:vault-list', {
        correlationId: CID,
        input: { extra: true },
      });

      await rec(host, 'actions', 'snapshot', 'empty', 'zero:action:snapshot', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'actions', 'snapshot', 'invalid', 'zero:action:snapshot', {});
      await rec(host, 'actions', 'command', 'create-project', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: RID, text: 'Create project Corpus', modelRef: null },
      });
      await rec(host, 'actions', 'command', 'empty-text', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: RID, text: '', modelRef: null },
      });
      await rec(host, 'actions', 'command', 'invalid', 'zero:action:command', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'actions', 'approve', 'missing', 'zero:action:approve', {
        correlationId: CID,
        input: { approvalId: RID },
      });
      await rec(host, 'actions', 'reject', 'missing', 'zero:action:reject', {
        correlationId: CID,
        input: { approvalId: RID },
      });
      await rec(host, 'actions', 'approve', 'invalid', 'zero:action:approve', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'actions', 'reject', 'invalid', 'zero:action:reject', {
        correlationId: CID,
        input: {},
      });
      host.setConfirm(0);
      await rec(host, 'actions', 'updatePolicy', 'auto', 'zero:action:policy-update', {
        correlationId: CID,
        input: { toolId: 'task.list', mode: 'auto_approve' },
      });
      host.setConfirm(1);
      await rec(host, 'actions', 'updatePolicy', 'cancelled', 'zero:action:policy-update', {
        correlationId: CID,
        input: { toolId: 'task.list', mode: 'deny' },
      });
      await rec(host, 'actions', 'updatePolicy', 'invalid-tool', 'zero:action:policy-update', {
        correlationId: CID,
        input: { toolId: 'not.a.tool', mode: 'deny' },
      });
      await rec(host, 'actions', 'command', 'list-tasks', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: createId(), text: 'List tasks', modelRef: null },
      });
      await rec(host, 'actions', 'snapshot', 'after-command', 'zero:action:snapshot', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'actions', 'command', 'unknown-intent', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: createId(), text: 'xyzzy-no-tool', modelRef: null },
      });
      await rec(host, 'actions', 'approve', 'not-uuid', 'zero:action:approve', {
        correlationId: CID,
        input: { approvalId: 'nope' },
      });
      await rec(host, 'actions', 'reject', 'not-uuid', 'zero:action:reject', {
        correlationId: CID,
        input: { approvalId: 'nope' },
      });
      await rec(host, 'actions', 'command', 'missing-request-id', 'zero:action:command', {
        correlationId: CID,
        input: { text: 'List tasks', modelRef: null },
      });
      await rec(host, 'actions', 'updatePolicy', 'invalid', 'zero:action:policy-update', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'actions', 'command', 'too-long', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: createId(), text: 'x'.repeat(3000), modelRef: null },
      });
      const snap = (await host.invoke('zero:action:snapshot', {
        correlationId: CID,
        input: {},
      })) as { value?: { approvals?: Array<{ id: string }> } };
      const approvalId = snap.value?.approvals?.[0]?.id;
      if (approvalId !== undefined) {
        host.setConfirm(0);
        await rec(host, 'actions', 'approve', 'happy', 'zero:action:approve', {
          correlationId: CID,
          input: { approvalId },
        });
      }
      await rec(host, 'actions', 'command', 'create-again', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: createId(), text: 'Create project Other', modelRef: null },
      });
      const snap2 = (await host.invoke('zero:action:snapshot', {
        correlationId: CID,
        input: {},
      })) as { value?: { approvals?: Array<{ id: string }> } };
      const rejectId = snap2.value?.approvals?.[0]?.id;
      if (rejectId !== undefined) {
        await rec(host, 'actions', 'reject', 'happy', 'zero:action:reject', {
          correlationId: CID,
          input: { approvalId: rejectId },
        });
      }

      await rec(host, 'helm', 'listAgents', 'empty', 'zero:helm', { action: 'listAgents' });
      await rec(host, 'helm', 'createAgent', 'happy', 'zero:helm', {
        action: 'createAgent',
        payload: {
          name: 'Mate',
          brief: 'Builds fixtures',
          engine: 'claude',
          places: [],
          skillIds: [],
        },
      });
      await rec(host, 'helm', 'createAgent', 'duplicate', 'zero:helm', {
        action: 'createAgent',
        payload: {
          name: 'Mate',
          brief: 'Builds fixtures',
          engine: 'claude',
          places: [],
          skillIds: [],
        },
      });
      await rec(host, 'helm', 'createAgent', 'empty-name', 'zero:helm', {
        action: 'createAgent',
        payload: { name: '', brief: 'x', engine: 'claude', places: [], skillIds: [] },
      });
      await rec(host, 'helm', 'listAgents', 'one', 'zero:helm', { action: 'listAgents' });
      const agents = (await host.invoke('zero:helm', { action: 'listAgents' })) as {
        value: Array<{ id: string }>;
      };
      const agentId = agents.value[0]?.id ?? RID;
      await rec(host, 'helm', 'listRoutines', 'empty', 'zero:helm', { action: 'listRoutines' });
      await rec(host, 'helm', 'createRoutine', 'happy', 'zero:helm', {
        action: 'createRoutine',
        payload: {
          agentId,
          name: 'Nightly',
          instruction: 'Check the board',
          everyMinutes: 60,
        },
      });
      await rec(host, 'helm', 'createRoutine', 'unknown-agent', 'zero:helm', {
        action: 'createRoutine',
        payload: {
          agentId: RID,
          name: 'Nightly',
          instruction: 'Check the board',
          everyMinutes: 60,
        },
      });
      await rec(host, 'helm', 'listRoutines', 'one', 'zero:helm', { action: 'listRoutines' });
      await rec(host, 'helm', 'listPlugins', 'disconnected', 'zero:helm', {
        action: 'listPlugins',
      });
      await rec(host, 'helm', 'connectPlugin', 'happy', 'zero:helm', {
        action: 'connectPlugin',
        payload: { id: 'github', token: 'gho_not-a-real-token-value' },
      });
      await rec(host, 'helm', 'connectPlugin', 'short-token', 'zero:helm', {
        action: 'connectPlugin',
        payload: { id: 'github', token: 'short' },
      });
      await rec(host, 'helm', 'listPlugins', 'connected', 'zero:helm', {
        action: 'listPlugins',
      });
      await rec(host, 'helm', 'listTasks', 'none', 'zero:helm', { action: 'listTasks' });
      await rec(host, 'helm', 'createAgent', 'invalid-engine', 'zero:helm', {
        action: 'createAgent',
        payload: { name: 'X', brief: 'Y', engine: 'nope', places: [], skillIds: [] },
      });

      await rec(host, 'browser', 'command', 'hide', 'zero:browser:command', {
        correlationId: CID,
        input: { action: 'hide' },
      });
      await rec(host, 'browser', 'command', 'open', 'zero:browser:command', {
        correlationId: CID,
        input: {
          action: 'open',
          url: 'http://127.0.0.1:4173',
          bounds: { x: 0, y: 0, width: 400, height: 300 },
        },
      });
      await rec(host, 'browser', 'command', 'invalid-url', 'zero:browser:command', {
        correlationId: CID,
        input: {
          action: 'open',
          url: 'file:///etc/passwd',
          bounds: { x: 0, y: 0, width: 400, height: 300 },
        },
      });

      await rec(host, 'board', 'homeDir', 'happy', 'zero:board:home-dir', undefined);
      await rec(host, 'board', 'listPresets', 'empty', 'zero:board:preset-list', {
        correlationId: CID,
      });
      await rec(host, 'board', 'detectAgents', 'probe', 'zero:board:detect-agents', {
        correlationId: CID,
      });
      await rec(host, 'board', 'listProjects', 'empty', 'zero:kanban:project-list', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'board', 'createProject', 'happy', 'zero:kanban:project-create', {
        correlationId: CID,
        input: { name: 'Board A' },
      });
      await rec(host, 'board', 'createProject', 'empty-name', 'zero:kanban:project-create', {
        correlationId: CID,
        input: { name: '' },
      });
      await rec(host, 'board', 'listProjects', 'one', 'zero:kanban:project-list', {
        correlationId: CID,
        input: {},
      });
      const projects = (await host.invoke('zero:kanban:project-list', {
        correlationId: CID,
        input: {},
      })) as { value: Array<{ id: string }> };
      const projectId = projects.value[0]?.id ?? RID;
      await rec(host, 'board', 'listCards', 'empty', 'zero:kanban:list', {
        correlationId: CID,
        input: { workspace: projectId },
      });
      await rec(host, 'board', 'createCard', 'happy', 'zero:kanban:create', {
        correlationId: CID,
        input: { workspace: projectId, title: 'Card' },
      });
      await rec(host, 'board', 'createCard', 'empty-title', 'zero:kanban:create', {
        correlationId: CID,
        input: { workspace: projectId, title: '' },
      });
      const cards = (await host.invoke('zero:kanban:list', {
        correlationId: CID,
        input: { workspace: projectId },
      })) as { value: Array<{ id: string; column?: string }> };
      const cardId = cards.value[0]?.id ?? RID;
      await rec(host, 'board', 'moveCard', 'happy', 'zero:kanban:move', {
        correlationId: CID,
        input: { id: cardId, column: 'doing' },
      });
      await rec(host, 'board', 'updateCard', 'rename', 'zero:kanban:update', {
        correlationId: CID,
        input: { id: cardId, title: 'Renamed card' },
      });
      await rec(host, 'board', 'deleteCard', 'happy', 'zero:kanban:delete', {
        correlationId: CID,
        input: { id: cardId },
      });
      await rec(host, 'board', 'moveCard', 'missing', 'zero:kanban:move', {
        correlationId: CID,
        input: { id: RID, column: 'doing' },
      });
      await rec(host, 'board', 'updateCard', 'missing', 'zero:kanban:update', {
        correlationId: CID,
        input: { id: RID, title: 'x' },
      });
      await rec(host, 'board', 'deleteCard', 'missing', 'zero:kanban:delete', {
        correlationId: CID,
        input: { id: RID },
      });
      await rec(host, 'board', 'listCards', 'missing-workspace', 'zero:kanban:list', {
        correlationId: CID,
        input: { workspace: RID },
      });
      await rec(host, 'board', 'savePreset', 'happy', 'zero:board:preset-save', {
        correlationId: CID,
        preset: {
          name: 'Dev',
          folderPath: '/tmp/corpus',
          paneCount: 1,
          isolation: 'shared',
          panes: [{ slot: 0, agentId: 'shell' }],
        },
      });
      const presets = (await host.invoke('zero:board:preset-list', {
        correlationId: CID,
      })) as { value: Array<{ id: string }> };
      const presetId = presets.value[0]?.id ?? RID;
      await rec(host, 'board', 'listPresets', 'one', 'zero:board:preset-list', {
        correlationId: CID,
      });
      await rec(host, 'board', 'deletePreset', 'happy', 'zero:board:preset-delete', {
        correlationId: CID,
        id: presetId,
      });
      await rec(host, 'board', 'deletePreset', 'missing', 'zero:board:preset-delete', {
        correlationId: CID,
        id: RID,
      });
      const folder = gitRepo();
      temps.push(folder);
      await rec(host, 'board', 'createSession', 'shared-shell', 'zero:board:create', {
        correlationId: CID,
        folderPath: folder,
        paneCount: 1,
        isolation: 'shared',
        panes: [{ slot: 0, agentId: 'shell' }],
      });
      await rec(host, 'board', 'createSession', 'invalid-count', 'zero:board:create', {
        correlationId: CID,
        folderPath: folder,
        paneCount: 2,
        isolation: 'shared',
        panes: [{ slot: 0, agentId: 'shell' }],
      });
      const session = (await host.invoke('zero:board:create', {
        correlationId: CID,
        folderPath: folder,
        paneCount: 1,
        isolation: 'shared',
        panes: [{ slot: 0, agentId: 'shell' }],
      })) as { value?: { sessionId: string; panes: Array<{ paneId: string }> } };
      const sessionId = session.value?.sessionId ?? RID;
      const paneId = session.value?.panes[0]?.paneId ?? RID;
      await rec(host, 'board', 'write', 'happy', 'zero:board:write', {
        sessionId,
        paneId,
        data: 'echo hi\n',
      });
      await rec(host, 'board', 'write', 'missing', 'zero:board:write', {
        sessionId: RID,
        paneId: RID,
        data: 'x',
      });
      await rec(host, 'board', 'resize', 'happy', 'zero:board:resize', {
        sessionId,
        paneId,
        cols: 80,
        rows: 24,
      });
      await rec(host, 'board', 'drainPane', 'happy', 'zero:board:pane-drain', {
        sessionId,
        paneId,
      });
      await rec(host, 'board', 'addPane', 'happy', 'zero:board:pane-add', {
        sessionId,
        agentId: 'shell',
      });
      await rec(host, 'board', 'closePane', 'happy', 'zero:board:pane-close', {
        sessionId,
        paneId,
      });
      await rec(host, 'board', 'closePane', 'missing', 'zero:board:pane-close', {
        sessionId: RID,
        paneId: RID,
      });
      host.setDialogFolder(folder);
      await rec(host, 'board', 'selectFolder', 'picked', 'zero:board:select-folder', {
        correlationId: CID,
      });
      host.setDialogFolder(folder, true);
      await rec(host, 'board', 'selectFolder', 'canceled', 'zero:board:select-folder', {
        correlationId: CID,
      });
      await rec(host, 'board', 'land', 'missing-branch', 'zero:board:land', {
        correlationId: CID,
        repoPath: folder,
        branch: 'p1-missing',
      });
      await rec(host, 'board', 'previewLand', 'missing-branch', 'zero:board:land-preview', {
        correlationId: CID,
        repoPath: folder,
        branch: 'p1-missing',
      });
      await rec(host, 'board', 'land', 'invalid', 'zero:board:land', { correlationId: CID });
      await rec(host, 'board', 'previewLand', 'invalid', 'zero:board:land-preview', {
        correlationId: CID,
      });
      await rec(host, 'board', 'onPaneEvent', 'no-session', 'zero:board:event', {
        sessionId: RID,
      });
      await rec(host, 'board', 'resize', 'invalid', 'zero:board:resize', {});
      await rec(host, 'board', 'drainPane', 'missing', 'zero:board:pane-drain', {
        sessionId: RID,
        paneId: RID,
      });
      await rec(host, 'board', 'addPane', 'missing-session', 'zero:board:pane-add', {
        sessionId: RID,
        agentId: 'shell',
      });
      await rec(host, 'board', 'createCard', 'missing-workspace', 'zero:kanban:create', {
        correlationId: CID,
        input: { workspace: RID, title: 'x' },
      });
      await rec(host, 'board', 'savePreset', 'invalid', 'zero:board:preset-save', {
        correlationId: CID,
        preset: { name: '' },
      });

      await rec(host, 'projects', 'dashboard', 'empty', 'zero:project:dashboard', {
        correlationId: CID,
        input: {},
      });
      host.setDialogFolder(folder);
      await rec(
        host,
        'projects',
        'selectRepository',
        'picked',
        'zero:project:repository-select',
        { correlationId: CID, input: {} },
      );
      host.setDialogFolder(folder, true);
      await rec(
        host,
        'projects',
        'selectRepository',
        'canceled',
        'zero:project:repository-select',
        { correlationId: CID, input: {} },
      );
      await rec(
        host,
        'projects',
        'refreshRepository',
        'happy',
        'zero:project:repository-refresh',
        { correlationId: CID, input: { root: folder } },
      );
      await rec(
        host,
        'projects',
        'refreshRepository',
        'missing',
        'zero:project:repository-refresh',
        { correlationId: CID, input: { root: '/tmp/does-not-exist-corpus' } },
      );
      const plain = mkdtempSync(join(tmpdir(), 'zero-plain-'));
      temps.push(plain);
      await rec(
        host,
        'projects',
        'refreshRepository',
        'not-git',
        'zero:project:repository-refresh',
        { correlationId: CID, input: { root: plain } },
      );
      execFileSync('git', ['checkout', '--orphan', 'detached-temp'], { cwd: folder });
      await rec(
        host,
        'projects',
        'refreshRepository',
        'orphan',
        'zero:project:repository-refresh',
        { correlationId: CID, input: { root: folder } },
      );
      execFileSync('git', ['checkout', '-B', 'main'], { cwd: folder });
      writeFileSync(join(folder, 'dirty.txt'), 'dirty\n');
      await rec(
        host,
        'projects',
        'refreshRepository',
        'dirty',
        'zero:project:repository-refresh',
        { correlationId: CID, input: { root: folder } },
      );
      await rec(host, 'projects', 'dashboard', 'invalid', 'zero:project:dashboard', {});

      await rec(host, 'editor', 'pick', 'canceled', 'zero:editor:pick', {
        correlationId: CID,
      });
      host.setDialogFolder(join(folder, 'README.md'));
      await rec(host, 'editor', 'pick', 'file', 'zero:editor:pick', { correlationId: CID });
      await rec(host, 'editor', 'read', 'happy', 'zero:editor:read', {
        correlationId: CID,
        input: { root: folder, path: join(folder, 'README.md') },
      });
      await rec(host, 'editor', 'read', 'traversal', 'zero:editor:read', {
        correlationId: CID,
        input: { root: folder, path: join(folder, '..', 'etc', 'passwd') },
      });
      writeFileSync(join(folder, 'bin.dat'), Buffer.from([0, 1, 2, 255]));
      await rec(host, 'editor', 'read', 'binary', 'zero:editor:read', {
        correlationId: CID,
        input: { root: folder, path: join(folder, 'bin.dat') },
      });
      await rec(host, 'editor', 'list', 'root', 'zero:editor:list', {
        correlationId: CID,
        input: { root: folder },
      });
      await rec(host, 'editor', 'git', 'status', 'zero:editor:git', {
        correlationId: CID,
        input: { root: folder },
      });
      await rec(host, 'editor', 'write', 'happy', 'zero:editor:write', {
        correlationId: CID,
        input: { root: folder, path: join(folder, 'README.md'), text: '# edited\n' },
      });
      await rec(host, 'editor', 'write', 'conflict-traversal', 'zero:editor:write', {
        correlationId: CID,
        input: {
          root: folder,
          path: '/etc/passwd',
          text: 'nope',
        },
      });
      await rec(host, 'editor', 'create', 'file', 'zero:editor:create', {
        correlationId: CID,
        input: { root: folder, path: join(folder, 'new.txt'), kind: 'file' },
      });
      await rec(host, 'editor', 'create', 'dir', 'zero:editor:create', {
        correlationId: CID,
        input: { root: folder, path: join(folder, 'sub'), kind: 'dir' },
      });
      await rec(host, 'editor', 'search', 'readme', 'zero:editor:search', {
        correlationId: CID,
        input: { root: folder, query: 'edited' },
      });
      await rec(host, 'editor', 'search', 'empty', 'zero:editor:search', {
        correlationId: CID,
        input: { root: folder, query: '' },
      });
      await rec(host, 'editor', 'gitStage', 'file', 'zero:editor:git-stage', {
        correlationId: CID,
        input: { root: folder, path: 'README.md', staged: true },
      });
      await rec(host, 'editor', 'gitCommit', 'happy', 'zero:editor:git-commit', {
        correlationId: CID,
        input: { root: folder, message: 'corpus commit' },
      });
      await rec(host, 'editor', 'gitCommit', 'empty-message', 'zero:editor:git-commit', {
        correlationId: CID,
        input: { root: folder, message: '' },
      });
      await rec(host, 'editor', 'read', 'missing', 'zero:editor:read', {
        correlationId: CID,
        input: { root: folder, path: join(folder, 'nope.txt') },
      });
      await rec(host, 'editor', 'list', 'traversal', 'zero:editor:list', {
        correlationId: CID,
        input: { root: folder, path: '/etc' },
      });
      await rec(host, 'editor', 'git', 'not-repo', 'zero:editor:git', {
        correlationId: CID,
        input: { root: plain },
      });
      await rec(host, 'editor', 'write', 'invalid', 'zero:editor:write', {
        correlationId: CID,
        input: {},
      });

      await rec(host, 'swarm', 'latest', 'none', 'zero:swarm:latest', {
        correlationId: CID,
      });
      await rec(host, 'swarm', 'create', 'happy', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'Corpus swarm',
          folderPath: folder,
          mission: 'ship the fixtures',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: ['tdd'],
          seats: [
            { role: 'coordinator', agentId: 'claude' },
            { role: 'builder', agentId: 'claude' },
          ],
        },
      });
      await rec(host, 'swarm', 'create', 'empty-mission', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'X',
          folderPath: folder,
          mission: '',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'claude' }],
        },
      });
      const latest = (await host.invoke('zero:swarm:latest', { correlationId: CID })) as {
        value?: { id: string; seats?: Array<{ id: string }> };
      };
      const runId = latest.value?.id ?? RID;
      await rec(host, 'swarm', 'state', 'happy', 'zero:swarm:state', {
        correlationId: CID,
        runId,
      });
      await rec(host, 'swarm', 'state', 'missing', 'zero:swarm:state', {
        correlationId: CID,
        runId: RID,
      });
      await rec(host, 'swarm', 'direct', 'missing', 'zero:swarm:direct', {
        correlationId: CID,
        input: { runId: RID, text: 'hello' },
      });
      await rec(host, 'swarm', 'latest', 'one', 'zero:swarm:latest', { correlationId: CID });
      await rec(host, 'swarm', 'stopSeat', 'missing', 'zero:swarm:stop-seat', {
        correlationId: CID,
        runId: RID,
        seatId: RID,
      });
      await rec(host, 'swarm', 'addSeat', 'missing-run', 'zero:swarm:add-seat', {
        correlationId: CID,
        runId: RID,
        role: 'builder',
        agentId: 'claude',
      });
      await rec(host, 'swarm', 'stop', 'missing', 'zero:swarm:stop', {
        correlationId: CID,
        runId: RID,
      });
      await rec(host, 'swarm', 'onEvent', 'subscribe', 'zero:swarm:event', {
        runId,
      });
      if (latest.value?.seats?.[0] !== undefined) {
        await rec(host, 'swarm', 'stopSeat', 'happy', 'zero:swarm:stop-seat', {
          correlationId: CID,
          runId,
          seatId: latest.value.seats[0].id,
        });
      }
      await rec(host, 'swarm', 'addSeat', 'happy', 'zero:swarm:add-seat', {
        correlationId: CID,
        runId,
        role: 'scout',
        agentId: 'claude',
      });
      await rec(host, 'swarm', 'direct', 'happy', 'zero:swarm:direct', {
        correlationId: CID,
        input: { runId, text: '@all status' },
      });
      await rec(host, 'swarm', 'stop', 'happy', 'zero:swarm:stop', {
        correlationId: CID,
        runId,
      });
      await rec(host, 'swarm', 'state', 'stopped', 'zero:swarm:state', {
        correlationId: CID,
        runId,
      });
      await rec(host, 'swarm', 'create', 'invalid', 'zero:swarm:create', { correlationId: CID });
      await rec(host, 'swarm', 'state', 'invalid', 'zero:swarm:state', { correlationId: CID });
      await rec(host, 'swarm', 'direct', 'invalid', 'zero:swarm:direct', { correlationId: CID });
      await rec(host, 'swarm', 'stop', 'invalid', 'zero:swarm:stop', { correlationId: CID });
      await rec(host, 'swarm', 'latest', 'invalid', 'zero:swarm:latest', {});
      await rec(host, 'swarm', 'addSeat', 'invalid', 'zero:swarm:add-seat', {
        correlationId: CID,
      });
      await rec(host, 'swarm', 'stopSeat', 'invalid', 'zero:swarm:stop-seat', {
        correlationId: CID,
      });
      await rec(host, 'swarm', 'create', 'bad-preset', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'X',
          folderPath: folder,
          mission: 'go',
          launchMode: 'auto',
          presetId: 'nope',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'claude' }],
        },
      });
      await rec(host, 'swarm', 'direct', 'empty-text', 'zero:swarm:direct', {
        correlationId: CID,
        input: { runId, text: '' },
      });
      await rec(host, 'swarm', 'addSeat', 'bad-role', 'zero:swarm:add-seat', {
        correlationId: CID,
        runId,
        role: 'wizard',
        agentId: 'claude',
      });
      await rec(host, 'swarm', 'create', 'missing-folder', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'X',
          folderPath: '/tmp/missing-corpus-swarm',
          mission: 'go',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'claude' }],
        },
      });
      await rec(host, 'swarm', 'state', 'after-stop', 'zero:swarm:state', {
        correlationId: CID,
        runId,
      });
      await rec(host, 'swarm', 'stop', 'already-stopped', 'zero:swarm:stop', {
        correlationId: CID,
        runId,
      });
      await rec(host, 'swarm', 'latest', 'after-stop', 'zero:swarm:latest', {
        correlationId: CID,
      });
      await rec(host, 'helm', 'listTasks', 'after-swarm', 'zero:helm', {
        action: 'listTasks',
      });
      await rec(host, 'chat', 'create', 'missing-input', 'zero:chat:create', {
        correlationId: CID,
        input: {},
      });
      await rec(host, 'chat', 'list', 'extra-field', 'zero:chat:list', {
        correlationId: CID,
        extra: true,
      });
      await rec(host, 'knowledge', 'selectVault', 'invalid', 'zero:knowledge:vault-select', {});
      await rec(host, 'knowledge', 'getSource', 'not-uuid', 'zero:knowledge:source-get', {
        correlationId: CID,
        input: { sourceId: 'nope' },
      });
      await rec(host, 'knowledge', 'syncVault', 'not-uuid', 'zero:knowledge:vault-sync', {
        correlationId: CID,
        input: { vaultId: 'nope' },
      });
      await rec(host, 'knowledge', 'answer', 'not-uuid', 'zero:knowledge:query', {
        correlationId: CID,
        input: { vaultId: 'nope', query: 'x' },
      });
      await rec(host, 'actions', 'snapshot', 'extra', 'zero:action:snapshot', {
        correlationId: CID,
        input: { extra: true },
      });
      await rec(host, 'actions', 'command', 'not-uuid-request', 'zero:action:command', {
        correlationId: CID,
        input: { requestId: 'nope', text: 'List tasks', modelRef: null },
      });
      await rec(host, 'actions', 'updatePolicy', 'bad-mode', 'zero:action:policy-update', {
        correlationId: CID,
        input: { toolId: 'task.list', mode: 'whatever' },
      });
      await rec(host, 'actions', 'approve', 'extra', 'zero:action:approve', {
        correlationId: CID,
        input: { approvalId: RID, extra: true },
      });
      await rec(host, 'swarm', 'create', 'bad-mode', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'X',
          folderPath: '/tmp',
          mission: 'go',
          launchMode: 'nope',
          presetId: 'skiff',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'claude' }],
        },
      });
      await rec(host, 'swarm', 'create', 'bad-agent', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'X',
          folderPath: '/tmp',
          mission: 'go',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'not-an-agent' }],
        },
      });
      await rec(host, 'swarm', 'create', 'no-seats', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: 'X',
          folderPath: '/tmp',
          mission: 'go',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [],
        },
      });
      await rec(host, 'swarm', 'state', 'not-uuid', 'zero:swarm:state', {
        correlationId: CID,
        runId: 'nope',
      });
      await rec(host, 'swarm', 'direct', 'not-uuid', 'zero:swarm:direct', {
        correlationId: CID,
        input: { runId: 'nope', text: 'hi' },
      });
      await rec(host, 'swarm', 'stop', 'not-uuid', 'zero:swarm:stop', {
        correlationId: CID,
        runId: 'nope',
      });
      await rec(host, 'swarm', 'stopSeat', 'not-uuid', 'zero:swarm:stop-seat', {
        correlationId: CID,
        runId: 'nope',
        seatId: RID,
      });
      await rec(host, 'swarm', 'addSeat', 'not-uuid', 'zero:swarm:add-seat', {
        correlationId: CID,
        runId: 'nope',
        role: 'builder',
        agentId: 'claude',
      });
      await rec(host, 'swarm', 'direct', 'missing-run', 'zero:swarm:direct', {
        correlationId: CID,
        input: { text: 'hi' },
      });
      await rec(host, 'swarm', 'create', 'missing-name', 'zero:swarm:create', {
        correlationId: CID,
        input: {
          name: '',
          folderPath: '/tmp',
          mission: 'go',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'claude' }],
        },
      });
      await rec(host, 'swarm', 'onEvent', 'missing-run', 'zero:swarm:event', {});
    } finally {
      host.close();
      for (const dir of temps) rmSync(dir, { recursive: true, force: true });
    }
    expect(true).toBe(true);
  });
});

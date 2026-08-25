import { createCorrelationId } from '@zero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, input: unknown) => unknown>(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', async () => {
  const { electronSession } = await import('./electron-mock.js');
  return {
    dialog: { showOpenDialog: mocks.showOpenDialog },
    ipcMain: {
      handle: (channel: string, handler: (_event: unknown, input: unknown) => unknown) =>
        mocks.handlers.set(channel, handler),
      removeHandler: (channel: string) => mocks.handlers.delete(channel),
    },
    session: electronSession,
  };
});

import type { CoreRuntime } from '@zero/core';
import { ipcChannels } from '@zero/protocol/ipc';

import { registerIpcHandlers } from '../src/main/ipc.js';

function vault(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    name: 'Fixture Vault',
    noteCount: 2,
    lastIndexedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe('knowledge IPC boundary', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
  });

  it('takes the vault path only from the trusted main-process folder dialog', async () => {
    const id = createCorrelationId();
    const registerVault = vi.fn(() => vault(id));
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/trusted/selected-vault'],
    });
    registerIpcHandlers({
      knowledge: { registerVault },
    } as unknown as CoreRuntime);
    const correlationId = createCorrelationId();

    await expect(
      mocks.handlers.get(ipcChannels.knowledgeVaultSelect)!({}, { correlationId }),
    ).resolves.toMatchObject({ ok: true, value: { id } });
    expect(registerVault).toHaveBeenCalledWith('/trusted/selected-vault', correlationId);

    await expect(
      mocks.handlers.get(ipcChannels.knowledgeVaultSelect)!(
        {},
        { correlationId, rootPath: '/renderer/injected' },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(1);
  });

  it('validates cited queries and source IDs before calling core', async () => {
    const vaultId = createCorrelationId();
    const sourceId = createCorrelationId();
    const chunkId = createCorrelationId();
    const correlationId = createCorrelationId();
    const modelRef = `${createCorrelationId()}:model`;
    const answer = vi.fn(async () => ({
      answer: 'Evidence [S1].',
      citations: [],
      finishReason: 'stop' as const,
    }));
    const getSource = vi.fn(() => ({
      sourceId,
      chunkId,
      vaultId,
      notePath: 'Decision.md',
      title: 'Decision',
      heading: 'Why',
      lineStart: 3,
      lineEnd: 4,
      content: '# Decision\n\n## Why\nEvidence.',
    }));
    registerIpcHandlers({
      knowledge: { answer, getSource },
    } as unknown as CoreRuntime);

    await expect(
      mocks.handlers.get(ipcChannels.knowledgeQuery)!(
        {},
        {
          correlationId,
          input: { vaultId, modelRef, query: 'Why?', maxSources: 4 },
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: { answer: 'Evidence [S1].' } });
    expect(answer).toHaveBeenCalledWith(
      { vaultId, modelRef, query: 'Why?', maxSources: 4 },
      correlationId,
      expect.any(AbortSignal),
    );

    expect(
      mocks.handlers.get(ipcChannels.knowledgeSourceGet)!(
        {},
        { correlationId, input: { sourceId, chunkId } },
      ),
    ).toMatchObject({ ok: true, value: { notePath: 'Decision.md' } });
    expect(getSource).toHaveBeenCalledWith(sourceId, chunkId);

    expect(
      mocks.handlers.get(ipcChannels.knowledgeSourceGet)!(
        {},
        { correlationId, input: { sourceId, chunkId, rootPath: '/private' } },
      ),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(getSource).toHaveBeenCalledTimes(1);
  });
});

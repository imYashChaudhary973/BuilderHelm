import { createCorrelationId, utcNow } from '@builderhelm/shared';
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

import type { CoreRuntime } from '@builderhelm/core';
import { ipcChannels } from '@builderhelm/protocol/ipc';

import { registerIpcHandlers } from '../src/main/ipc.js';

function projectDashboard(projectId: string) {
  const now = utcNow();
  return {
    project: {
      id: projectId,
      name: 'Helm Site',
      description: null,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    },
    tasks: [],
    decisions: [],
    repository: null,
    timeline: [],
  };
}

describe('project IPC boundary', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
  });

  it('takes a repository path only from the trusted main-process dialog', async () => {
    const projectId = createCorrelationId();
    const correlationId = createCorrelationId();
    const registerRepository = vi.fn(() => projectDashboard(projectId));
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/trusted/repository'],
    });
    registerIpcHandlers({
      projects: { registerRepository },
    } as unknown as CoreRuntime);

    await expect(
      mocks.handlers.get(ipcChannels.projectRepositorySelect)!(
        {},
        {
          correlationId,
          input: { projectId },
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: { project: { id: projectId } } });
    expect(registerRepository).toHaveBeenCalledWith(
      projectId,
      '/trusted/repository',
      correlationId,
    );

    await expect(
      mocks.handlers.get(ipcChannels.projectRepositorySelect)!(
        {},
        {
          correlationId,
          input: { projectId, rootPath: '/renderer/injected' },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(1);
  });
});

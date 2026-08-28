import { createCorrelationId, createId } from '@builderhelm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, input: unknown) => unknown>(),
  showMessageBox: vi.fn(),
}));

vi.mock('electron', async () => {
  const { electronSession } = await import('./electron-mock.js');
  return {
    dialog: { showOpenDialog: vi.fn(), showMessageBox: mocks.showMessageBox },
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

describe('action IPC boundary', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.showMessageBox.mockReset();
    mocks.showMessageBox.mockResolvedValue({ response: 0 });
  });

  it('validates action commands before invoking the core runtime', async () => {
    const command = vi.fn(async () => ({
      kind: 'read_result' as const,
      message: '0 tasks found.',
      toolId: 'task.list' as const,
      result: [],
    }));
    registerIpcHandlers({ actions: { command } } as unknown as CoreRuntime);
    const correlationId = createCorrelationId();
    const requestId = createId();

    await expect(
      mocks.handlers.get(ipcChannels.actionCommand)!(
        {},
        {
          correlationId,
          input: { requestId, text: 'List tasks', modelRef: null },
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: { toolId: 'task.list' } });
    expect(command).toHaveBeenCalledWith(
      { requestId, text: 'List tasks', modelRef: null },
      correlationId,
      expect.any(AbortSignal),
    );

    await expect(
      mocks.handlers.get(ipcChannels.actionCommand)!(
        {},
        {
          correlationId,
          input: {
            requestId: createId(),
            text: 'List tasks',
            modelRef: null,
            toolId: 'task.create',
            exactArguments: { title: 'Injected' },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Request validation failed' },
    });
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('accepts only an approval ID and never renderer-supplied replacement arguments', async () => {
    const approvalId = createId();
    const requestId = createId();
    const approve = vi.fn(async () => ({
      kind: 'read_result' as const,
      message: 'Approved fixture.',
      toolId: 'task.list' as const,
      result: [],
    }));
    const snapshot = vi.fn(() => ({
      pendingApprovals: [
        {
          id: approvalId,
          toolId: 'task.create',
          summary: 'Create task “Fixture”',
          risk: 'reversible_write',
          reversible: true,
          affectedResources: [{ type: 'task', id: requestId, label: 'Fixture' }],
          exactArguments: { projectId: requestId, title: 'Fixture' },
        },
      ],
    }));
    registerIpcHandlers({ actions: { approve, snapshot } } as unknown as CoreRuntime);
    const correlationId = createCorrelationId();

    await expect(
      mocks.handlers.get(ipcChannels.actionApprove)!(
        {},
        {
          correlationId,
          input: { approvalId, exactArguments: { title: 'Changed after approval' } },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(approve).not.toHaveBeenCalled();

    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(
      mocks.handlers.get(ipcChannels.actionApprove)!(
        {},
        {
          correlationId,
          input: { approvalId },
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(snapshot).toHaveBeenCalledWith(correlationId);
    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringContaining('"title": "Fixture"'),
      }),
    );
    expect(approve).toHaveBeenCalledWith(approvalId, correlationId);
  });

  it('fails closed when trusted approval confirmation is cancelled', async () => {
    const correlationId = createCorrelationId();
    const approvalId = createId();
    const approve = vi.fn();
    const snapshot = vi.fn(() => ({
      pendingApprovals: [
        {
          id: approvalId,
          toolId: 'project.add_decision',
          summary: 'Add decision',
          risk: 'reversible_write',
          reversible: false,
          affectedResources: [],
          exactArguments: { title: 'Fixture' },
        },
      ],
    }));
    registerIpcHandlers({ actions: { approve, snapshot } } as unknown as CoreRuntime);

    await expect(
      mocks.handlers.get(ipcChannels.actionApprove)!(
        {},
        { correlationId, input: { approvalId } },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'Action approval was cancelled' },
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it('requires trusted confirmation before persisting a permission policy', async () => {
    const correlationId = createCorrelationId();
    const updatePolicy = vi.fn(() => ({
      toolId: 'task.create' as const,
      mode: 'auto_approve' as const,
      updatedAt: '2026-08-12T00:00:00.000Z',
    }));
    registerIpcHandlers({ actions: { updatePolicy } } as unknown as CoreRuntime);
    const request = {
      correlationId,
      input: { toolId: 'task.create', mode: 'auto_approve' },
    };

    await expect(
      mocks.handlers.get(ipcChannels.actionPolicyUpdate)!({}, request),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(updatePolicy).not.toHaveBeenCalled();

    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(
      mocks.handlers.get(ipcChannels.actionPolicyUpdate)!({}, request),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'Set task.create to auto_approve?',
        defaultId: 0,
        cancelId: 0,
      }),
    );
    expect(updatePolicy).toHaveBeenCalledWith(request.input, correlationId);
  });
});

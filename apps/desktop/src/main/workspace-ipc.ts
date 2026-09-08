import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CoreRuntime } from '@builderhelm/core';
import {
  FOUNDATION_CHANNELS as channels,
  workspaceSnapshotSchema,
  workspaceRecordSchema,
  editorDraftSchema,
  workspaceSelectInputSchema,
  workspaceIdInputSchema,
  workspaceMetaSchema,
  workspaceImportInputSchema,
  workspaceOrderInputSchema,
  editorDraftInputSchema,
  editorDraftListInputSchema,
} from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createCorrelationId,
  normalizeError,
} from '@builderhelm/shared';
import type { BoardPtyManager } from './board-pty-manager.js';
import { resolveWorkspace } from './file-reader.js';

const exec = promisify(execFile);
function authorize(event: IpcMainInvokeEvent): void {
  if (
    !BrowserWindow.fromWebContents(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new BuilderHelmError(
      'PERMISSION_DENIED',
      'This operation requires the desktop workspace.',
    );
  }
}

export function registerWorkspaceIpc(
  core: CoreRuntime,
  board?: BoardPtyManager,
): () => void {
  const restarting = new Set<string>();
  if (board)
    board.onOutput = (id, paneId, text) => {
      try {
        core.workspaces.output(id, paneId, text);
      } catch {
        core.logger.warn({
          event: 'workspace.output_save_failed',
          correlationId: createCorrelationId(),
          data: { id, paneId },
        });
      }
    };

  // All responses are validated by the narrow preload methods as well.
  const handle = (
    name: string,
    action: (event: IpcMainInvokeEvent, input: unknown) => unknown | Promise<unknown>,
  ) => {
    ipcMain.handle(name, async (event, input: unknown) => {
      try {
        authorize(event);
        return { ok: true, value: await action(event, input) };
      } catch (cause) {
        const error = normalizeError(cause);
        return {
          ok: false,
          error: {
            code: error.code,
            message:
              cause instanceof BuilderHelmError
                ? error.message
                : 'Workspace operation failed.',
            retryable: false,
          },
        };
      }
    });
  };
  handle(channels.snapshot, (event) => {
    const snapshot = core.workspaces.snapshot();
    for (const record of snapshot.records) {
      if (record.state === 'running' && board?.hasSession(record.id)) {
        const summary = board.snapshot(record.id, event.sender);
        if (summary.panes.length > 0) core.workspaces.save({ ...record, summary });
      }
    }
    return workspaceSnapshotSchema.parse(core.workspaces.snapshot());
  });
  handle(channels.select, (_event, input) => {
    const value = workspaceSelectInputSchema.parse(input);
    core.workspaces.select(value.id, value.paneId);
    return { saved: true };
  });
  handle(channels.metadata, async (_event, input) => {
    const meta = workspaceMetaSchema.parse(input);
    meta.root = await realpath(meta.root);
    core.workspaces.metadata(meta);
    return { saved: true };
  });
  handle(channels.importLegacy, async (_event, input) => {
    const { entries } = workspaceImportInputSchema.parse(input);
    const canonical = await Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        root: await realpath(entry.root).catch(() => entry.root),
      })),
    );
    core.workspaces.importLegacy(canonical);
    return { saved: true };
  });
  handle(channels.order, (_event, input) => {
    const value = workspaceOrderInputSchema.parse(input);
    core.workspaces.order(value.id, value.paneIds);
    return { saved: true };
  });
  handle(channels.drafts, (_event, input) => {
    const { root } = editorDraftListInputSchema.parse(input);
    const canonical = resolveWorkspace(root).root;
    return core.workspaces
      .drafts(canonical)
      .map((draft) => editorDraftSchema.parse(draft));
  });
  handle(channels.saveDraft, (_event, input) => {
    const value = editorDraftInputSchema.parse(input);
    const canonical = resolveWorkspace(value.root, value.path);
    core.workspaces.draft({ ...value, ...canonical });
    return { saved: true };
  });
  handle(channels.restart, async (event, input) => {
    const { id } = workspaceIdInputSchema.parse(input);
    if (!board || restarting.has(id))
      throw new BuilderHelmError('VALIDATION_FAILED', 'Workspace is already opening.');
    if (board.hasSession(id)) return core.workspaces.get(id);
    const record = core.workspaces.get(id);
    const locations = record.summary?.panes ?? record.locations;
    if (locations.length === 0)
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'No checkout was created. Start a new workspace; the interrupted record is retained.',
      );
    restarting.add(id);
    try {
      const verified = await Promise.all(
        locations.map(async (location) => {
          const cwd = await realpath(location.cwd);
          if (cwd !== location.cwd)
            throw new BuilderHelmError(
              'PERMISSION_DENIED',
              'The checkout location changed. Reopen the project explicitly.',
            );
          if (record.request.isolation === 'worktree') {
            const common = async (path: string) =>
              (
                await exec(
                  'git',
                  ['rev-parse', '--path-format=absolute', '--git-common-dir'],
                  { cwd: path, timeout: 5000 },
                )
              ).stdout.trim();
            if (
              (await common(cwd)) !== (await common(record.root)) ||
              (await core.board.readBranch(cwd)) !== location.branch
            )
              throw new BuilderHelmError(
                'PERMISSION_DENIED',
                'The retained checkout no longer matches this workspace.',
              );
          }
          return { ...location, cwd };
        }),
      );
      // Reopening starts shells only. It never replays a previous agent prompt or command.
      const request = {
        ...record.request,
        paneCount: record.request.paneCount,
        panes: verified.map((_, slot) => ({ slot, agentId: 'shell' as const })),
      };
      const summary = await board.createSession(
        request,
        async (slot) => verified[slot]!,
        event.sender,
        id,
      );
      core.workspaces.finish(id, summary);
      return workspaceRecordSchema.parse(core.workspaces.get(id));
    } catch (error) {
      core.workspaces.interrupt(id);
      throw error;
    } finally {
      restarting.delete(id);
    }
  });
  return () => {
    for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
  };
}

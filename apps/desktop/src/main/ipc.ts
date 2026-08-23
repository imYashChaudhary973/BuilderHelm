import { randomUUID } from 'node:crypto';

import type { CoreRuntime } from '@zero/core';
import {
  actionCommandIpcResponseSchema,
  actionCommandRequestSchema,
  actionSnapshotIpcResponseSchema,
  actionSnapshotRequestSchema,
  approvalRejectIpcResponseSchema,
  approvalResolveIpcResponseSchema,
  approvalResolveRequestSchema,
  permissionPolicyUpdateIpcResponseSchema,
  permissionPolicyUpdateRequestSchema,
} from '@zero/protocol/actions';
import {
  boardCreateInputSchema,
  boardCreateIpcResponseSchema,
  boardDetectAgentsInputSchema,
  boardDetectAgentsIpcResponseSchema,
  boardPaneCloseInputSchema,
  boardPaneCloseIpcResponseSchema,
  boardPresetDeleteInputSchema,
  boardPresetDeleteIpcResponseSchema,
  boardPresetListIpcResponseSchema,
  boardPresetSaveInputSchema,
  boardPresetSaveIpcResponseSchema,
  boardResizeIpcResponseSchema,
  boardSelectFolderInputSchema,
  boardSelectFolderIpcResponseSchema,
  boardPaneResizeInputSchema,
  boardPaneWriteInputSchema,
  boardWriteIpcResponseSchema,
} from '@zero/protocol/board';
import {
  chatCreateRequestSchema,
  chatGetRequestSchema,
  chatListRequestSchema,
  chatStreamCancelIpcResponseSchema,
  chatStreamCancelRequestSchema,
  chatStreamEnvelopeSchema,
  chatStreamStartIpcResponseSchema,
  chatStreamStartRequestSchema,
  chatThreadIpcResponseSchema,
  chatThreadListIpcResponseSchema,
  chatTranscriptIpcResponseSchema,
  type ChatClientStreamEvent,
} from '@zero/protocol/chat';
import { ipcChannels, systemHealthRequestSchema } from '@zero/protocol/ipc';
import {
  knowledgeAnswerIpcResponseSchema,
  knowledgeQueryRequestSchema,
  knowledgeSourceIpcResponseSchema,
  knowledgeSourceRequestSchema,
  knowledgeVaultListIpcResponseSchema,
  knowledgeVaultListRequestSchema,
  knowledgeVaultMutationIpcResponseSchema,
  knowledgeVaultSelectIpcResponseSchema,
  knowledgeVaultSelectRequestSchema,
  knowledgeVaultSyncRequestSchema,
} from '@zero/protocol/knowledge';
import {
  modelListIpcResponseSchema,
  modelListRequestSchema,
  modelListResponseSchema,
  modelCapabilityOverrideListIpcResponseSchema,
  modelCapabilityOverrideListRequestSchema,
  modelCapabilityOverrideUpdateIpcResponseSchema,
  modelCapabilityOverrideUpdateRequestSchema,
  providerCreateRequestSchema,
  providerDeleteRequestSchema,
  providerDiscoverModelsRequestSchema,
  providerListRequestSchema,
  providerTestConnectionIpcResponseSchema,
  providerTestConnectionRequestSchema,
  providerUpdateRequestSchema,
} from '@zero/protocol/providers';
import {
  projectDashboardIpcResponseSchema,
  projectDashboardRequestSchema,
  projectRepositoryRefreshIpcResponseSchema,
  projectRepositoryRefreshRequestSchema,
  projectRepositorySelectIpcResponseSchema,
  projectRepositorySelectRequestSchema,
} from '@zero/protocol/projects';
import { normalizeError, ZeroError } from '@zero/shared';
import type { BoardPtyManager } from './board-pty-manager.js';
import { dialog, ipcMain, type WebContents } from 'electron';
import { ZodError } from 'zod';

function ipcError(error: unknown): {
  readonly code: ReturnType<typeof normalizeError>['code'];
  readonly message: string;
  readonly retryable: boolean;
} {
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      retryable: false,
    };
  }
  const normalized = normalizeError(error);
  return {
    code: normalized.code,
    message:
      error instanceof ZeroError
        ? normalized.message
        : 'The request could not be completed',
    retryable: normalized.retryable,
  };
}

function sendChatEvent(
  sender: WebContents,
  runId: string,
  event: ChatClientStreamEvent,
): void {
  if (sender.isDestroyed()) return;
  sender.send(
    ipcChannels.chatStreamEvent,
    chatStreamEnvelopeSchema.parse({ runId, event }),
  );
}

export function registerIpcHandlers(
  core: CoreRuntime,
  board?: BoardPtyManager,
): () => void {
  const activeStreams = new Map<
    string,
    { readonly controller: AbortController; readonly senderId: number }
  >();
  ipcMain.handle(ipcChannels.systemHealth, (_event, input: unknown) => {
    const request = systemHealthRequestSchema.parse(input);
    return core.health(request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerList, (_event, input: unknown) => {
    providerListRequestSchema.parse(input);
    return core.providers.list();
  });
  ipcMain.handle(ipcChannels.providerCreate, async (_event, input: unknown) => {
    const request = providerCreateRequestSchema.parse(input);
    return core.providers.create(request.input, request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerUpdate, async (_event, input: unknown) => {
    const request = providerUpdateRequestSchema.parse(input);
    return core.providers.update(request.input, request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerDelete, async (_event, input: unknown) => {
    const request = providerDeleteRequestSchema.parse(input);
    return core.providers.delete(request.input.id, request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerTestConnection, async (_event, input: unknown) => {
    try {
      const request = providerTestConnectionRequestSchema.parse(input);
      const value = await core.models.testConnection(
        request.input.providerId,
        request.correlationId,
      );
      return providerTestConnectionIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return providerTestConnectionIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelDiscover, async (_event, input: unknown) => {
    try {
      const request = providerDiscoverModelsRequestSchema.parse(input);
      const value = modelListResponseSchema.parse(
        await core.models.discover(request.input.providerId, request.correlationId),
      );
      return modelListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return modelListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelList, (_event, input: unknown) => {
    try {
      const request = modelListRequestSchema.parse(input);
      const value = modelListResponseSchema.parse(
        core.models.list(request.input.providerId),
      );
      return modelListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return modelListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelCapabilityOverrideList, (_event, input: unknown) => {
    try {
      const request = modelCapabilityOverrideListRequestSchema.parse(input);
      return modelCapabilityOverrideListIpcResponseSchema.parse({
        ok: true,
        value: core.models.listCapabilityOverrides(request.input.providerId),
      });
    } catch (error) {
      return modelCapabilityOverrideListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelCapabilityOverrideUpdate, (_event, input: unknown) => {
    try {
      const request = modelCapabilityOverrideUpdateRequestSchema.parse(input);
      return modelCapabilityOverrideUpdateIpcResponseSchema.parse({
        ok: true,
        value: core.models.updateCapabilityOverride(
          request.input.modelRef,
          request.input.overrides,
          request.correlationId,
        ),
      });
    } catch (error) {
      return modelCapabilityOverrideUpdateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.knowledgeVaultList, (_event, input: unknown) => {
    try {
      knowledgeVaultListRequestSchema.parse(input);
      return knowledgeVaultListIpcResponseSchema.parse({
        ok: true,
        value: core.knowledge.listVaults(),
      });
    } catch (error) {
      return knowledgeVaultListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.knowledgeVaultSelect, async (_event, input: unknown) => {
    try {
      const request = knowledgeVaultSelectRequestSchema.parse(input);
      const selected = await dialog.showOpenDialog({
        title: 'Select Obsidian vault',
        properties: ['openDirectory'],
      });
      const rootPath = selected.filePaths[0];
      const value =
        selected.canceled || rootPath === undefined
          ? null
          : core.knowledge.registerVault(rootPath, request.correlationId);
      return knowledgeVaultSelectIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return knowledgeVaultSelectIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.knowledgeVaultSync, (_event, input: unknown) => {
    try {
      const request = knowledgeVaultSyncRequestSchema.parse(input);
      return knowledgeVaultMutationIpcResponseSchema.parse({
        ok: true,
        value: core.knowledge.syncVault(request.input.vaultId, request.correlationId),
      });
    } catch (error) {
      return knowledgeVaultMutationIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.knowledgeQuery, async (_event, input: unknown) => {
    try {
      const request = knowledgeQueryRequestSchema.parse(input);
      const value = await core.knowledge.answer(
        request.input,
        request.correlationId,
        AbortSignal.timeout(120_000),
      );
      return knowledgeAnswerIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return knowledgeAnswerIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.knowledgeSourceGet, (_event, input: unknown) => {
    try {
      const request = knowledgeSourceRequestSchema.parse(input);
      return knowledgeSourceIpcResponseSchema.parse({
        ok: true,
        value: core.knowledge.getSource(request.input.sourceId, request.input.chunkId),
      });
    } catch (error) {
      return knowledgeSourceIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.actionSnapshot, (_event, input: unknown) => {
    try {
      const request = actionSnapshotRequestSchema.parse(input);
      return actionSnapshotIpcResponseSchema.parse({
        ok: true,
        value: core.actions.snapshot(request.correlationId),
      });
    } catch (error) {
      return actionSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.actionCommand, async (_event, input: unknown) => {
    try {
      const request = actionCommandRequestSchema.parse(input);
      const value = await core.actions.command(
        request.input,
        request.correlationId,
        AbortSignal.timeout(60_000),
      );
      return actionCommandIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return actionCommandIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.actionApprove, async (_event, input: unknown) => {
    try {
      const request = approvalResolveRequestSchema.parse(input);
      const approval = core.actions
        .snapshot(request.correlationId)
        .pendingApprovals.find((candidate) => candidate.id === request.input.approvalId);
      if (approval === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The approval request was not found');
      }
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: 'Approve local action',
        message: approval.summary,
        detail: [
          `Tool: ${approval.toolId}`,
          `Risk: ${approval.risk}`,
          `Reversible: ${approval.reversible ? 'yes' : 'no'}`,
          `Resources: ${
            approval.affectedResources.map((resource) => resource.label).join(', ') ||
            'none'
          }`,
          '',
          'Exact arguments:',
          JSON.stringify(approval.exactArguments, null, 2),
        ].join('\n'),
        buttons: ['Cancel', 'Approve'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) {
        throw new ZeroError('PERMISSION_DENIED', 'Action approval was cancelled');
      }
      const value = await core.actions.approve(
        request.input.approvalId,
        request.correlationId,
      );
      return approvalResolveIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return approvalResolveIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.actionReject, (_event, input: unknown) => {
    try {
      const request = approvalResolveRequestSchema.parse(input);
      return approvalRejectIpcResponseSchema.parse({
        ok: true,
        value: core.actions.reject(request.input.approvalId, request.correlationId),
      });
    } catch (error) {
      return approvalRejectIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.actionPolicyUpdate, async (_event, input: unknown) => {
    try {
      const request = permissionPolicyUpdateRequestSchema.parse(input);
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: 'Change tool permission',
        message: `Set ${request.input.toolId} to ${request.input.mode}?`,
        detail:
          request.input.mode === 'auto_approve'
            ? 'Matching actions may run without another approval prompt.'
            : 'This changes the persistent permission policy for this tool.',
        buttons: ['Cancel', 'Save policy'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) {
        throw new ZeroError('PERMISSION_DENIED', 'Permission change was cancelled');
      }
      return permissionPolicyUpdateIpcResponseSchema.parse({
        ok: true,
        value: core.actions.updatePolicy(request.input, request.correlationId),
      });
    } catch (error) {
      return permissionPolicyUpdateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.projectDashboard, (_event, input: unknown) => {
    try {
      projectDashboardRequestSchema.parse(input);
      return projectDashboardIpcResponseSchema.parse({
        ok: true,
        value: core.projects.dashboard(),
      });
    } catch (error) {
      return projectDashboardIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.projectRepositorySelect, async (_event, input: unknown) => {
    try {
      const request = projectRepositorySelectRequestSchema.parse(input);
      const selected = await dialog.showOpenDialog({
        title: 'Select local Git repository',
        properties: ['openDirectory'],
      });
      const rootPath = selected.filePaths[0];
      const value =
        selected.canceled || rootPath === undefined
          ? null
          : core.projects.registerRepository(
              request.input.projectId,
              rootPath,
              request.correlationId,
            );
      return projectRepositorySelectIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return projectRepositorySelectIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.projectRepositoryRefresh, (_event, input: unknown) => {
    try {
      const request = projectRepositoryRefreshRequestSchema.parse(input);
      return projectRepositoryRefreshIpcResponseSchema.parse({
        ok: true,
        value: core.projects.refreshRepository(
          request.input.repositoryId,
          request.correlationId,
        ),
      });
    } catch (error) {
      return projectRepositoryRefreshIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.chatList, (_event, input: unknown) => {
    try {
      chatListRequestSchema.parse(input);
      return chatThreadListIpcResponseSchema.parse({
        ok: true,
        value: core.chats.list(),
      });
    } catch (error) {
      return chatThreadListIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.chatCreate, (_event, input: unknown) => {
    try {
      const request = chatCreateRequestSchema.parse(input);
      return chatThreadIpcResponseSchema.parse({
        ok: true,
        value: core.chats.create(request.input, request.correlationId),
      });
    } catch (error) {
      return chatThreadIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.chatGet, (_event, input: unknown) => {
    try {
      const request = chatGetRequestSchema.parse(input);
      return chatTranscriptIpcResponseSchema.parse({
        ok: true,
        value: core.chats.get(request.input.threadId),
      });
    } catch (error) {
      return chatTranscriptIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.chatStreamStart, (event, input: unknown) => {
    try {
      const request = chatStreamStartRequestSchema.parse(input);
      if (activeStreams.has(request.runId)) {
        throw new ZeroError('VALIDATION_FAILED', 'Chat stream is already active');
      }
      const controller = new AbortController();
      const sender = event.sender;
      const abort = () => controller.abort();
      activeStreams.set(request.runId, { controller, senderId: sender.id });
      sender.once('destroyed', abort);

      void (async () => {
        try {
          for await (const streamEvent of core.chats.stream(
            request.input,
            request.correlationId,
            controller.signal,
          )) {
            sendChatEvent(sender, request.runId, streamEvent);
          }
        } catch (error) {
          sendChatEvent(sender, request.runId, { type: 'error', error: ipcError(error) });
        } finally {
          activeStreams.delete(request.runId);
          sender.removeListener('destroyed', abort);
        }
      })();

      return chatStreamStartIpcResponseSchema.parse({
        ok: true,
        value: { runId: request.runId },
      });
    } catch (error) {
      return chatStreamStartIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.chatStreamCancel, (event, input: unknown) => {
    try {
      const request = chatStreamCancelRequestSchema.parse(input);
      const active = activeStreams.get(request.input.runId);
      if (active !== undefined && active.senderId !== event.sender.id) {
        throw new ZeroError(
          'PERMISSION_DENIED',
          'Chat stream belongs to another renderer',
        );
      }
      active?.controller.abort();
      return chatStreamCancelIpcResponseSchema.parse({
        ok: true,
        value: { cancelled: active !== undefined },
      });
    } catch (error) {
      return chatStreamCancelIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  function requireBoard(): BoardPtyManager {
    if (board === undefined) {
      throw new ZeroError('INTEGRATION_OFFLINE', 'Board terminal host is not available');
    }
    return board;
  }

  ipcMain.handle(ipcChannels.boardCreate, async (event, input: unknown) => {
    try {
      const request = boardCreateInputSchema.parse(input);
      const tag = randomUUID().slice(0, 8);
      const value = await requireBoard().createSession(
        request,
        async (slot) => {
          if (request.isolation !== 'worktree') return undefined;
          return core.board.createWorktree(
            request.folderPath,
            `${tag}-${slot}`,
            request.correlationId,
          );
        },
        event.sender,
      );
      return boardCreateIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return boardCreateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardWrite, async (_event, input: unknown) => {
    try {
      const request = boardPaneWriteInputSchema.parse(input);
      await requireBoard().write(request);
      return boardWriteIpcResponseSchema.parse({
        ok: true,
        value: { written: true },
      });
    } catch (error) {
      return boardWriteIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardResize, async (_event, input: unknown) => {
    try {
      const request = boardPaneResizeInputSchema.parse(input);
      await requireBoard().resize(request);
      return boardResizeIpcResponseSchema.parse({
        ok: true,
        value: { resized: true },
      });
    } catch (error) {
      return boardResizeIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardPaneClose, async (_event, input: unknown) => {
    try {
      const request = boardPaneCloseInputSchema.parse(input);
      await requireBoard().closePane(request);
      return boardPaneCloseIpcResponseSchema.parse({
        ok: true,
        value: { closed: true },
      });
    } catch (error) {
      return boardPaneCloseIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardSelectFolder, async (_event, input: unknown) => {
    try {
      boardSelectFolderInputSchema.parse(input);
      const selected = await dialog.showOpenDialog({
        title: 'Select working folder',
        properties: ['openDirectory'],
      });
      const path = selected.filePaths[0];
      const value = selected.canceled || path === undefined ? null : path;
      return boardSelectFolderIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return boardSelectFolderIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardDetectAgents, async (_event, input: unknown) => {
    try {
      boardDetectAgentsInputSchema.parse(input);
      const value = await core.board.detectAgents();
      return boardDetectAgentsIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return boardDetectAgentsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardPresetList, (_event, input: unknown) => {
    try {
      boardSelectFolderInputSchema.parse(input);
      return boardPresetListIpcResponseSchema.parse({
        ok: true,
        value: core.board.listPresets(),
      });
    } catch (error) {
      return boardPresetListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardPresetSave, (_event, input: unknown) => {
    try {
      const request = boardPresetSaveInputSchema.parse(input);
      return boardPresetSaveIpcResponseSchema.parse({
        ok: true,
        value: core.board.savePreset(request.preset, request.correlationId),
      });
    } catch (error) {
      return boardPresetSaveIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardPresetDelete, (_event, input: unknown) => {
    try {
      const request = boardPresetDeleteInputSchema.parse(input);
      core.board.deletePreset(request.id, request.correlationId);
      return boardPresetDeleteIpcResponseSchema.parse({
        ok: true,
        value: { deleted: true },
      });
    } catch (error) {
      return boardPresetDeleteIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  return () => {
    for (const active of activeStreams.values()) active.controller.abort();
    activeStreams.clear();
    ipcMain.removeHandler(ipcChannels.systemHealth);
    ipcMain.removeHandler(ipcChannels.providerList);
    ipcMain.removeHandler(ipcChannels.providerCreate);
    ipcMain.removeHandler(ipcChannels.providerUpdate);
    ipcMain.removeHandler(ipcChannels.providerDelete);
    ipcMain.removeHandler(ipcChannels.providerTestConnection);
    ipcMain.removeHandler(ipcChannels.modelDiscover);
    ipcMain.removeHandler(ipcChannels.modelList);
    ipcMain.removeHandler(ipcChannels.modelCapabilityOverrideList);
    ipcMain.removeHandler(ipcChannels.modelCapabilityOverrideUpdate);
    ipcMain.removeHandler(ipcChannels.knowledgeVaultList);
    ipcMain.removeHandler(ipcChannels.knowledgeVaultSelect);
    ipcMain.removeHandler(ipcChannels.knowledgeVaultSync);
    ipcMain.removeHandler(ipcChannels.knowledgeQuery);
    ipcMain.removeHandler(ipcChannels.knowledgeSourceGet);
    ipcMain.removeHandler(ipcChannels.actionSnapshot);
    ipcMain.removeHandler(ipcChannels.actionCommand);
    ipcMain.removeHandler(ipcChannels.actionApprove);
    ipcMain.removeHandler(ipcChannels.actionReject);
    ipcMain.removeHandler(ipcChannels.actionPolicyUpdate);
    ipcMain.removeHandler(ipcChannels.projectDashboard);
    ipcMain.removeHandler(ipcChannels.projectRepositorySelect);
    ipcMain.removeHandler(ipcChannels.projectRepositoryRefresh);
    ipcMain.removeHandler(ipcChannels.chatList);
    ipcMain.removeHandler(ipcChannels.chatCreate);
    ipcMain.removeHandler(ipcChannels.chatGet);
    ipcMain.removeHandler(ipcChannels.chatStreamStart);
    ipcMain.removeHandler(ipcChannels.chatStreamCancel);
    ipcMain.removeHandler(ipcChannels.boardCreate);
    ipcMain.removeHandler(ipcChannels.boardWrite);
    ipcMain.removeHandler(ipcChannels.boardResize);
    ipcMain.removeHandler(ipcChannels.boardPaneClose);
    ipcMain.removeHandler(ipcChannels.boardSelectFolder);
    ipcMain.removeHandler(ipcChannels.boardDetectAgents);
    ipcMain.removeHandler(ipcChannels.boardPresetList);
    ipcMain.removeHandler(ipcChannels.boardPresetSave);
    ipcMain.removeHandler(ipcChannels.boardPresetDelete);
  };
}

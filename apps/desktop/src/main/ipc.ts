import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CoreRuntime } from '@builderhelm/core';
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
} from '@builderhelm/protocol/actions';
import {
  boardAddPaneInputSchema,
  boardAddPaneIpcResponseSchema,
  boardCreateInputSchema,
  boardCreateIpcResponseSchema,
  boardDetectAgentsInputSchema,
  boardDetectAgentsIpcResponseSchema,
  boardHomeDirIpcResponseSchema,
  boardLandInputSchema,
  boardLandIpcResponseSchema,
  boardLandPreviewIpcResponseSchema,
  boardPaneCloseInputSchema,
  boardPaneCloseIpcResponseSchema,
  boardPaneAckInputSchema,
  boardPaneAckIpcResponseSchema,
  boardPaneDrainInputSchema,
  boardPaneDrainIpcResponseSchema,
  boardPaneResizeInputSchema,
  boardPaneWriteInputSchema,
  boardPresetDeleteInputSchema,
  boardPresetDeleteIpcResponseSchema,
  boardPresetListIpcResponseSchema,
  boardPresetSaveInputSchema,
  boardPresetSaveIpcResponseSchema,
  boardResizeIpcResponseSchema,
  boardSelectFolderInputSchema,
  boardSelectFolderIpcResponseSchema,
  boardWriteIpcResponseSchema,
} from '@builderhelm/protocol/board';
import {
  swarmCreateIpcResponseSchema,
  swarmCreateRequestSchema,
  swarmDirectIpcResponseSchema,
  swarmDirectRequestSchema,
  swarmStateIpcResponseSchema,
  swarmStateRequestSchema,
  swarmStopIpcResponseSchema,
  swarmStopRequestSchema,
  swarmStopSeatIpcResponseSchema,
  swarmStopSeatRequestSchema,
  swarmLatestIpcResponseSchema,
  swarmLatestRequestSchema,
} from '@builderhelm/protocol/swarm';
import {
  kanbanCreateIpcResponseSchema,
  kanbanCreateRequestSchema,
  kanbanDeleteIpcResponseSchema,
  kanbanDeleteRequestSchema,
  kanbanListIpcResponseSchema,
  kanbanListRequestSchema,
  kanbanMoveIpcResponseSchema,
  kanbanMoveRequestSchema,
  kanbanProjectCreateIpcResponseSchema,
  kanbanProjectCreateRequestSchema,
  kanbanProjectListIpcResponseSchema,
  kanbanProjectListRequestSchema,
  kanbanUpdateIpcResponseSchema,
  kanbanUpdateRequestSchema,
} from '@builderhelm/protocol/kanban';
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
} from '@builderhelm/protocol/chat';
import {
  browserApproveRequestSchema,
  browserArtifactsIpcResponseSchema,
  browserArtifactsRequestSchema,
  browserCommandIpcResponseSchema,
  browserCommandRequestSchema,
  browserDriveIpcResponseSchema,
  browserDriveRequestSchema,
  browserEventsIpcResponseSchema,
  browserEventsRequestSchema,
  browserOriginsIpcResponseSchema,
  browserOriginsRequestSchema,
  browserPickIpcResponseSchema,
  browserPickRequestSchema,
  browserPickSendIpcResponseSchema,
  browserPickSendRequestSchema,
  browserReceiptsIpcResponseSchema,
  browserScreenshotIpcResponseSchema,
  browserScreenshotRequestSchema,
  browserSnapshotIpcResponseSchema,
  browserSnapshotRequestSchema,
  desktopActIpcResponseSchema,
  desktopActRequestSchema,
  desktopApproveRequestSchema,
  desktopScreenshotIpcResponseSchema,
  desktopScreenshotRequestSchema,
} from '@builderhelm/protocol/browser';
import {
  editorCreateIpcResponseSchema,
  editorCreateRequestSchema,
  editorGitCommitIpcResponseSchema,
  editorGitCommitRequestSchema,
  editorGitIpcResponseSchema,
  editorGitRequestSchema,
  editorGitStageIpcResponseSchema,
  editorGitStageRequestSchema,
  editorListIpcResponseSchema,
  editorListRequestSchema,
  editorPickIpcResponseSchema,
  editorPickRequestSchema,
  editorReadIpcResponseSchema,
  editorReadRequestSchema,
  editorSearchIpcResponseSchema,
  editorSearchRequestSchema,
  editorWriteIpcResponseSchema,
  editorWriteRequestSchema,
} from '@builderhelm/protocol/editor';
import { ipcChannels, systemHealthRequestSchema } from '@builderhelm/protocol/ipc';
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
} from '@builderhelm/protocol/knowledge';
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
} from '@builderhelm/protocol/providers';
import {
  projectDashboardIpcResponseSchema,
  projectDashboardRequestSchema,
  projectRepositoryRefreshIpcResponseSchema,
  projectRepositoryRefreshRequestSchema,
  projectRepositorySelectIpcResponseSchema,
  projectRepositorySelectRequestSchema,
} from '@builderhelm/protocol/projects';
import {
  voiceKeyDeleteIpcResponseSchema,
  voiceKeyDeleteRequestSchema,
  voiceKeySaveRequestSchema,
  voiceModelCancelRequestSchema,
  voiceModelDeleteRequestSchema,
  voiceModelDownloadRequestSchema,
  voiceModelEventSchema,
  voiceSettingsUpdateRequestSchema,
  voiceStatusIpcResponseSchema,
  voiceStatusRequestSchema,
  voiceTranscribeIpcResponseSchema,
  voiceTranscribeRequestSchema,
  type VoiceSettings,
} from '@builderhelm/protocol/voice';
import {
  createCorrelationId,
  normalizeError,
  BuilderHelmError,
} from '@builderhelm/shared';
import { CliSwarmPlanner, LocalGitInspector, type SwarmPlanner } from '@builderhelm/core';
import type { BoardPtyManager } from './board-pty-manager.js';
import type { PtySwarmRunner } from './swarm-runner.js';
import type { VoiceModelManager } from './voice-models.js';
import type { VoiceRuntime } from './voice-runtime.js';
import { PreviewBrowser } from './preview-browser.js';
import { DesktopControl } from './desktop-control.js';
import {
  commitGit,
  createEditorEntry,
  listEditorDir,
  listGitChanges,
  pickEditorFile,
  readEditorFile,
  searchEditorFiles,
  stageGitPath,
  writeEditorFile,
} from './file-reader.js';
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
      error instanceof BuilderHelmError
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
  swarmRunner?: PtySwarmRunner,
  voice?: {
    models: VoiceModelManager;
    runtime: VoiceRuntime;
    onSettings?: (settings: VoiceSettings) => void;
  },
): () => void {
  const preview = new PreviewBrowser();
  const desktop = new DesktopControl();
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
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The approval request was not found',
        );
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
        throw new BuilderHelmError('PERMISSION_DENIED', 'Action approval was cancelled');
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
        throw new BuilderHelmError(
          'PERMISSION_DENIED',
          'Permission change was cancelled',
        );
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
        throw new BuilderHelmError('VALIDATION_FAILED', 'Chat stream is already active');
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
        throw new BuilderHelmError(
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

  const swarmSenders = new Map<string, WebContents>();
  // Test doubles pass partial cores; the real runtime always has swarm.
  const unsubscribeSwarmEvents =
    core.swarm?.onRunEvent?.((runId: string) => {
      const sender = swarmSenders.get(runId);
      if (sender !== undefined && !sender.isDestroyed()) {
        sender.send(ipcChannels.swarmEvent, { runId });
      }
    }) ?? (() => {});

  function requireSwarmRunner(): PtySwarmRunner {
    if (swarmRunner === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Swarm host is not available');
    }
    return swarmRunner;
  }

  /**
   * Decomposition needs a CLI that can constrain output to a JSON Schema.
   * Without one the swarm still runs, as a single task for one builder.
   */
  async function pickSwarmPlanner(folderPath: string): Promise<SwarmPlanner> {
    const detections = await core.board.detectAgents();
    const structured = detections.find(
      (item) => item.available && item.capabilities.structuredOutput === 'json-schema',
    );
    if (structured === undefined) {
      return {
        async plan(request) {
          return [
            {
              title: request.mission.split('\n')[0]?.slice(0, 200) ?? 'Swarm mission',
              detail: request.mission,
              files: [],
              dependsOn: [],
            },
          ];
        },
      };
    }
    return new CliSwarmPlanner({
      agentId: structured.id,
      cwd: folderPath,
      ...(structured.path === null ? {} : { executable: structured.path }),
    });
  }

  function requireBoard(): BoardPtyManager {
    if (board === undefined) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Board terminal host is not available',
      );
    }
    return board;
  }

  ipcMain.handle(ipcChannels.swarmCreate, async (event, input: unknown) => {
    try {
      const request = swarmCreateRequestSchema.parse(input);
      const runner = requireSwarmRunner();
      // Seats need worktrees. Plain folders get `git init` plus an empty
      // commit so isolation works without making the user think about git.
      const repo = await core.board.ensureRepository(request.input.folderPath);
      const run = core.swarm.createRun(request.input, request.correlationId);
      const sessionId = runner.openSession(
        run.id,
        request.input.folderPath,
        'worktree',
        event.sender,
      );
      core.swarm.attachBoardSession(run.id, sessionId);
      if (repo.initialized) {
        core.swarm.note(
          run.id,
          `Initialized a git repository on ${repo.branch} so seats can isolate. Your files were not committed.`,
        );
      }
      swarmSenders.set(run.id, event.sender);
      // Launch is instant: warm the seats and plan in the background while
      // the live view already shows the coordinating phase.
      void (async () => {
        try {
          await core.swarm.warmSeats(run.id);
          const planner = await pickSwarmPlanner(request.input.folderPath);
          await core.swarm.planTasks(run.id, planner, request.correlationId);
          await core.swarm.pump(run.id);
        } catch (error) {
          core.logger.error({
            event: 'swarm.launch_failed',
            correlationId: request.correlationId,
            data: { runId: run.id, error: normalizeError(error).message },
          });
          core.swarm.failRun(run.id, normalizeError(error).message);
        }
      })();
      return swarmCreateIpcResponseSchema.parse({ ok: true, value: run });
    } catch (error) {
      return swarmCreateIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.swarmState, (_event, input: unknown) => {
    try {
      const request = swarmStateRequestSchema.parse(input);
      return swarmStateIpcResponseSchema.parse({
        ok: true,
        value: core.swarm.state(request.runId),
      });
    } catch (error) {
      return swarmStateIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.swarmDirect, (_event, input: unknown) => {
    try {
      const request = swarmDirectRequestSchema.parse(input);
      core.swarm.direct(
        request.input.runId,
        request.input.seatIds,
        request.input.body,
        request.correlationId,
      );
      return swarmDirectIpcResponseSchema.parse({ ok: true, value: { queued: true } });
    } catch (error) {
      return swarmDirectIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.swarmStop, (_event, input: unknown) => {
    try {
      const request = swarmStopRequestSchema.parse(input);
      core.swarm.stop(request.runId);
      swarmRunner?.release(request.runId);
      return swarmStopIpcResponseSchema.parse({ ok: true, value: { stopped: true } });
    } catch (error) {
      return swarmStopIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.swarmLatest, (_event, input: unknown) => {
    try {
      swarmLatestRequestSchema.parse(input);
      return swarmLatestIpcResponseSchema.parse({
        ok: true,
        value: core.swarm.latestRun(),
      });
    } catch (error) {
      return swarmLatestIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.swarmStopSeat, (_event, input: unknown) => {
    try {
      const request = swarmStopSeatRequestSchema.parse(input);
      core.swarm.stopSeat(request.runId, request.seatId, request.correlationId);
      return swarmStopSeatIpcResponseSchema.parse({
        ok: true,
        value: { stopped: true },
      });
    } catch (error) {
      return swarmStopSeatIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.boardCreate, async (event, input: unknown) => {
    try {
      const request = boardCreateInputSchema.parse(input);
      const tag = randomUUID().slice(0, 8);
      const value = await requireBoard().createSession(
        request,
        async (slot) => {
          if (request.isolation === 'worktree') {
            try {
              const worktree = await core.board.createWorktree(
                request.folderPath,
                `p${slot + 1}-${tag}`,
                request.correlationId,
              );
              return { cwd: worktree.path, branch: worktree.branch };
            } catch (error) {
              const branch = await core.board.readBranch(request.folderPath);
              if (branch === null) {
                throw new BuilderHelmError(
                  'VALIDATION_FAILED',
                  'Worktree per pane needs a git repository. Use Shared folder, or pick a repo.',
                );
              }
              throw error;
            }
          }
          return {
            cwd: request.folderPath,
            branch: await core.board.readBranch(request.folderPath),
          };
        },
        event.sender,
      );
      return boardCreateIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      core.logger.error({
        event: 'board.create_failed',
        correlationId: createCorrelationId(),
        data: {
          message: error instanceof Error ? error.message : 'unknown',
        },
      });
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
  ipcMain.handle(ipcChannels.boardPaneAdd, async (_event, input: unknown) => {
    try {
      const request = boardAddPaneInputSchema.parse(input);
      const host = requireBoard();
      const context = host.sessionContext(request.sessionId);
      const value = await host.addPane(
        request.sessionId,
        request.agentId,
        request.command,
        request.argv,
        async (slot) => {
          if (context.isolation === 'worktree') {
            const worktree = await core.board.createWorktree(
              context.folderPath,
              `p${slot + 1}-${context.worktreeTag}`,
              request.correlationId,
            );
            return { cwd: worktree.path, branch: worktree.branch };
          }
          return {
            cwd: context.folderPath,
            branch: await core.board.readBranch(context.folderPath),
          };
        },
      );
      return boardAddPaneIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return boardAddPaneIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardPaneDrain, (_event, input: unknown) => {
    try {
      const request = boardPaneDrainInputSchema.parse(input);
      return boardPaneDrainIpcResponseSchema.parse({
        ok: true,
        value: requireBoard().drainPane(request),
      });
    } catch (error) {
      return boardPaneDrainIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardPaneAck, (_event, input: unknown) => {
    try {
      const request = boardPaneAckInputSchema.parse(input);
      requireBoard().ackPane(request);
      return boardPaneAckIpcResponseSchema.parse({ ok: true, value: { acked: true } });
    } catch (error) {
      return boardPaneAckIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
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
  ipcMain.handle(ipcChannels.boardHomeDir, () =>
    boardHomeDirIpcResponseSchema.parse({ ok: true, value: homedir() }),
  );
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
  ipcMain.handle(ipcChannels.boardLand, async (_event, input: unknown) => {
    try {
      const request = boardLandInputSchema.parse(input);
      const value = await core.board.landBranch(
        request.repoPath,
        request.branch,
        request.correlationId,
        request.reviewedHead,
      );
      return boardLandIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return boardLandIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.boardLandPreview, async (_event, input: unknown) => {
    try {
      const request = boardLandInputSchema.parse(input);
      const value = await core.board.previewLand(
        request.repoPath,
        request.branch,
        request.correlationId,
      );
      return boardLandPreviewIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return boardLandPreviewIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.kanbanProjectList, (_event, input: unknown) => {
    try {
      kanbanProjectListRequestSchema.parse(input);
      return kanbanProjectListIpcResponseSchema.parse({
        ok: true,
        value: core.board.listProjects(),
      });
    } catch (error) {
      return kanbanProjectListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.kanbanProjectCreate, (_event, input: unknown) => {
    try {
      const request = kanbanProjectCreateRequestSchema.parse(input);
      return kanbanProjectCreateIpcResponseSchema.parse({
        ok: true,
        value: core.board.createProject(request.input.name, request.correlationId),
      });
    } catch (error) {
      return kanbanProjectCreateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.kanbanList, (_event, input: unknown) => {
    try {
      const request = kanbanListRequestSchema.parse(input);
      return kanbanListIpcResponseSchema.parse({
        ok: true,
        value: core.board.listCards(request.input.workspace),
      });
    } catch (error) {
      return kanbanListIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.kanbanCreate, (_event, input: unknown) => {
    try {
      const request = kanbanCreateRequestSchema.parse(input);
      return kanbanCreateIpcResponseSchema.parse({
        ok: true,
        value: core.board.createCard(
          request.input.workspace,
          request.input.title,
          request.correlationId,
          request.input.column,
        ),
      });
    } catch (error) {
      return kanbanCreateIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.kanbanMove, (_event, input: unknown) => {
    try {
      const request = kanbanMoveRequestSchema.parse(input);
      return kanbanMoveIpcResponseSchema.parse({
        ok: true,
        value: core.board.moveCard(
          request.input.id,
          request.input.column,
          request.correlationId,
        ),
      });
    } catch (error) {
      return kanbanMoveIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.kanbanUpdate, (_event, input: unknown) => {
    try {
      const request = kanbanUpdateRequestSchema.parse(input);
      return kanbanUpdateIpcResponseSchema.parse({
        ok: true,
        value: core.board.updateCard(
          request.input.id,
          request.input.title,
          request.correlationId,
        ),
      });
    } catch (error) {
      return kanbanUpdateIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.kanbanDelete, (_event, input: unknown) => {
    try {
      const request = kanbanDeleteRequestSchema.parse(input);
      return kanbanDeleteIpcResponseSchema.parse({
        ok: true,
        value: core.board.deleteCard(request.input.id, request.correlationId),
      });
    } catch (error) {
      return kanbanDeleteIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserCommand, async (event, input: unknown) => {
    try {
      const request = browserCommandRequestSchema.parse(input);
      const value = await preview.handle(event.sender, request.input);
      return browserCommandIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserCommandIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  function previewHeadSha(root: string | undefined): string {
    if (root === undefined) return 'unversioned';
    try {
      return new LocalGitInspector().inspect(root).headSha;
    } catch {
      return 'unversioned';
    }
  }

  ipcMain.handle(ipcChannels.browserOrigins, (_event, input: unknown) => {
    try {
      browserOriginsRequestSchema.parse(input);
      const value = board?.listPreviewOrigins() ?? [];
      return browserOriginsIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserOriginsIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserSnapshot, async (_event, input: unknown) => {
    try {
      const request = browserSnapshotRequestSchema.parse(input);
      const snap = await preview.snapshot();
      core.previewArtifacts.record({
        runId: request.input.runId ?? null,
        headSha: previewHeadSha(request.input.root),
        kind: 'snapshot',
        url: snap.url,
        viewport: snap.viewport,
        nodes: snap.nodes,
      });
      return browserSnapshotIpcResponseSchema.parse({
        ok: true,
        value: snap,
      });
    } catch (error) {
      return browserSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserScreenshot, async (_event, input: unknown) => {
    try {
      const request = browserScreenshotRequestSchema.parse(input);
      const shot = await preview.screenshot();
      const value = core.previewArtifacts.record({
        runId: request.input.runId ?? null,
        headSha: previewHeadSha(request.input.root),
        kind: 'screenshot',
        url: shot.url,
        viewport: shot.viewport,
        png: shot.png,
      });
      return browserScreenshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserScreenshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserArtifacts, (_event, input: unknown) => {
    try {
      const request = browserArtifactsRequestSchema.parse(input);
      const value = core.previewArtifacts.list({
        headSha: previewHeadSha(request.input.root),
        runId: request.input.runId ?? null,
      });
      return browserArtifactsIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserArtifactsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserDrive, async (_event, input: unknown) => {
    try {
      const request = browserDriveRequestSchema.parse(input);
      const value = await preview.drive(request.input);
      return browserDriveIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserDriveIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserApprove, async (_event, input: unknown) => {
    try {
      const request = browserApproveRequestSchema.parse(input);
      const value = await preview.resolveDrive(request.input.id, request.input.allow);
      return browserDriveIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserDriveIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserEvents, (_event, input: unknown) => {
    try {
      browserEventsRequestSchema.parse(input);
      return browserEventsIpcResponseSchema.parse({
        ok: true,
        value: preview.listEvents(),
      });
    } catch (error) {
      return browserEventsIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserPick, async (_event, input: unknown) => {
    try {
      browserPickRequestSchema.parse(input);
      const value = await preview.pick();
      return browserPickIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserPickIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserPickSend, (_event, input: unknown) => {
    try {
      const request = browserPickSendRequestSchema.parse(input);
      const picked = preview.lastPicked();
      if (picked === null) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Pick an element first');
      }
      const run = core.swarm.latestRun();
      if (run === null) {
        return browserPickSendIpcResponseSchema.parse({
          ok: true,
          value: { sent: false },
        });
      }
      const builders = core.swarm
        .state(run.id)
        .seats.filter((seat) => seat.role === 'builder')
        .map((seat) => seat.id);
      if (builders.length === 0) {
        return browserPickSendIpcResponseSchema.parse({
          ok: true,
          value: { sent: false },
        });
      }
      core.swarm.direct(
        run.id,
        builders,
        `Preview pick ${picked.role} "${picked.name}"\n${request.input.note}\n${picked.html}`,
        request.correlationId,
      );
      return browserPickSendIpcResponseSchema.parse({ ok: true, value: { sent: true } });
    } catch (error) {
      return browserPickSendIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserReceipts, (_event, input: unknown) => {
    try {
      browserEventsRequestSchema.parse(input);
      return browserReceiptsIpcResponseSchema.parse({
        ok: true,
        value: preview.listReceipts(),
      });
    } catch (error) {
      return browserReceiptsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.desktopScreenshot, async (_event, input: unknown) => {
    try {
      desktopScreenshotRequestSchema.parse(input);
      return desktopScreenshotIpcResponseSchema.parse({
        ok: true,
        value: await desktop.screenshot(),
      });
    } catch (error) {
      return desktopScreenshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.desktopAct, async (_event, input: unknown) => {
    try {
      const request = desktopActRequestSchema.parse(input);
      return desktopActIpcResponseSchema.parse({
        ok: true,
        value: await desktop.act(request.input),
      });
    } catch (error) {
      return desktopActIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.desktopApprove, async (_event, input: unknown) => {
    try {
      const request = desktopApproveRequestSchema.parse(input);
      return desktopActIpcResponseSchema.parse({
        ok: true,
        value: await desktop.resolve(request.input.id, request.input.allow),
      });
    } catch (error) {
      return desktopActIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.editorPick, async (_event, input: unknown) => {
    try {
      editorPickRequestSchema.parse(input);
      const value = await pickEditorFile();
      return editorPickIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorPickIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.editorRead, (_event, input: unknown) => {
    try {
      const request = editorReadRequestSchema.parse(input);
      const value = readEditorFile(request.input.root, request.input.path);
      return editorReadIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorReadIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorList, (_event, input: unknown) => {
    try {
      const request = editorListRequestSchema.parse(input);
      const value = listEditorDir(
        request.input.root,
        request.input.path ?? request.input.root,
        request.input.hidden === true,
      );
      return editorListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorGit, (_event, input: unknown) => {
    try {
      const request = editorGitRequestSchema.parse(input);
      let value = null;
      try {
        const snap = new LocalGitInspector().inspect(request.input.root);
        value = { ...snap, changes: [...listGitChanges(snap.rootPath)] };
      } catch {
        value = null;
      }
      return editorGitIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorGitIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorWrite, (_event, input: unknown) => {
    try {
      const request = editorWriteRequestSchema.parse(input);
      const value = writeEditorFile(
        request.input.root,
        request.input.path,
        request.input.text,
      );
      return editorWriteIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorWriteIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorCreate, (_event, input: unknown) => {
    try {
      const request = editorCreateRequestSchema.parse(input);
      const value = createEditorEntry(
        request.input.root,
        request.input.path,
        request.input.kind,
      );
      return editorCreateIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorCreateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorSearch, (_event, input: unknown) => {
    try {
      const request = editorSearchRequestSchema.parse(input);
      const value = searchEditorFiles(
        request.input.root,
        request.input.query,
        request.input.hidden === true,
      );
      return editorSearchIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorSearchIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorGitStage, (_event, input: unknown) => {
    try {
      const request = editorGitStageRequestSchema.parse(input);
      stageGitPath(request.input.root, request.input.path, request.input.staged);
      const snap = new LocalGitInspector().inspect(request.input.root);
      const value = { ...snap, changes: [...listGitChanges(snap.rootPath)] };
      return editorGitStageIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorGitStageIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.editorGitCommit, (_event, input: unknown) => {
    try {
      const request = editorGitCommitRequestSchema.parse(input);
      commitGit(request.input.root, request.input.message);
      const snap = new LocalGitInspector().inspect(request.input.root);
      const value = { ...snap, changes: [...listGitChanges(snap.rootPath)] };
      return editorGitCommitIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return editorGitCommitIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  function presentVoice(value: Awaited<ReturnType<CoreRuntime['voice']['status']>>) {
    voice?.onSettings?.(value.settings);
    return voiceStatusIpcResponseSchema.parse({ ok: true, value });
  }

  ipcMain.handle(ipcChannels.voiceStatus, async (_event, input: unknown) => {
    try {
      voiceStatusRequestSchema.parse(input);
      return presentVoice(await core.voice.status());
    } catch (error) {
      return voiceStatusIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.voiceSettingsUpdate, async (_event, input: unknown) => {
    try {
      const request = voiceSettingsUpdateRequestSchema.parse(input);
      return presentVoice(
        await core.voice.updateSettings(request.input, request.correlationId),
      );
    } catch (error) {
      return voiceStatusIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.voiceKeySave, async (_event, input: unknown) => {
    try {
      const request = voiceKeySaveRequestSchema.parse(input);
      return presentVoice(
        await core.voice.saveOpenAiKey(request.input, request.correlationId),
      );
    } catch (error) {
      return voiceStatusIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.voiceKeyDelete, async (_event, input: unknown) => {
    try {
      const request = voiceKeyDeleteRequestSchema.parse(input);
      const value = await core.voice.deleteOpenAiKey(request.correlationId);
      voice?.onSettings?.(value.settings);
      return voiceKeyDeleteIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return voiceKeyDeleteIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  function requireVoice(): { models: VoiceModelManager; runtime: VoiceRuntime } {
    if (voice === undefined) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Voice models are not available.',
      );
    }
    return voice;
  }

  ipcMain.handle(ipcChannels.voiceModelDownload, async (event, input: unknown) => {
    try {
      const request = voiceModelDownloadRequestSchema.parse(input);
      const host = requireVoice();
      const sender = event.sender;
      await host.models.download(request.input.modelId, (modelEvent) => {
        if (!sender.isDestroyed()) {
          sender.send(
            ipcChannels.voiceModelEvent,
            voiceModelEventSchema.parse(modelEvent),
          );
        }
      });
      return presentVoice(await core.voice.status());
    } catch (error) {
      return voiceStatusIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.voiceModelCancel, async (_event, input: unknown) => {
    try {
      const request = voiceModelCancelRequestSchema.parse(input);
      requireVoice().models.cancel(request.input.modelId);
      return presentVoice(await core.voice.status());
    } catch (error) {
      return voiceStatusIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.voiceModelDelete, async (_event, input: unknown) => {
    try {
      const request = voiceModelDeleteRequestSchema.parse(input);
      const host = requireVoice();
      if (host.models.installed(request.input.modelId)) host.runtime.unload();
      host.models.delete(request.input.modelId);
      const current = await core.voice.status();
      if (current.settings.modelId === request.input.modelId) {
        await core.voice.updateSettings({ modelId: null }, request.correlationId);
      }
      return presentVoice(await core.voice.status());
    } catch (error) {
      return voiceStatusIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.voiceTranscribe, async (_event, input: unknown) => {
    try {
      const request = voiceTranscribeRequestSchema.parse(input);
      const status = await core.voice.status();
      if (!status.settings.enabled) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Voice dictation is off.');
      }
      const modelId = status.settings.modelId;
      if (modelId === null) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Select a speech model.');
      }
      const model = status.models.find((entry) => entry.id === modelId);
      if (model === undefined) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Select a speech model.');
      }
      const bytes = Buffer.from(request.input.audioBase64, 'base64');
      if (bytes.byteLength < 44) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Audio is empty.');
      }
      if (model.runtime === 'cloud') {
        const result = await core.voice.transcribe(
          { bytes: new Uint8Array(bytes), filename: request.input.filename },
          request.correlationId,
        );
        return voiceTranscribeIpcResponseSchema.parse({ ok: true, value: result });
      }
      if (!model.installed) {
        throw new BuilderHelmError(
          'MODEL_UNAVAILABLE',
          'The speech model is not installed.',
        );
      }
      const dir = await mkdtemp(join(tmpdir(), 'builderhelm-voice-'));
      const wavPath = join(dir, 'clip.wav');
      try {
        await writeFile(wavPath, bytes);
        const text = await requireVoice().runtime.transcribeWav(modelId, wavPath);
        return voiceTranscribeIpcResponseSchema.parse({
          ok: true,
          value: { text },
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch (error) {
      const mapped =
        error instanceof BuilderHelmError || error instanceof ZodError
          ? error
          : new BuilderHelmError('MODEL_UNAVAILABLE', "Couldn't transcribe that clip.", {
              cause: error,
            });
      return voiceTranscribeIpcResponseSchema.parse({
        ok: false,
        error: ipcError(mapped),
      });
    }
  });

  if (typeof core.voice?.status === 'function') {
    void core.voice
      .status()
      .then((value) => voice?.onSettings?.(value.settings))
      .catch(() => {
        // Hotkeys register on the next successful voice status call.
      });
  }

  return () => {
    for (const active of activeStreams.values()) active.controller.abort();
    activeStreams.clear();
    preview.dispose();
    ipcMain.removeHandler(ipcChannels.systemHealth);
    ipcMain.removeHandler(ipcChannels.providerList);
    ipcMain.removeHandler(ipcChannels.providerCreate);
    ipcMain.removeHandler(ipcChannels.providerUpdate);
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
    ipcMain.removeHandler(ipcChannels.swarmCreate);
    ipcMain.removeHandler(ipcChannels.swarmState);
    ipcMain.removeHandler(ipcChannels.swarmDirect);
    ipcMain.removeHandler(ipcChannels.swarmStop);
    ipcMain.removeHandler(ipcChannels.swarmStopSeat);
    ipcMain.removeHandler(ipcChannels.swarmLatest);
    unsubscribeSwarmEvents();
    ipcMain.removeHandler(ipcChannels.boardCreate);
    ipcMain.removeHandler(ipcChannels.boardWrite);
    ipcMain.removeHandler(ipcChannels.boardResize);
    ipcMain.removeHandler(ipcChannels.boardPaneClose);
    ipcMain.removeHandler(ipcChannels.boardPaneAdd);
    ipcMain.removeHandler(ipcChannels.boardPaneDrain);
    ipcMain.removeHandler(ipcChannels.boardSelectFolder);
    ipcMain.removeHandler(ipcChannels.boardHomeDir);
    ipcMain.removeHandler(ipcChannels.boardDetectAgents);
    ipcMain.removeHandler(ipcChannels.boardPresetList);
    ipcMain.removeHandler(ipcChannels.boardPresetSave);
    ipcMain.removeHandler(ipcChannels.boardPresetDelete);
    ipcMain.removeHandler(ipcChannels.boardLand);
    ipcMain.removeHandler(ipcChannels.boardLandPreview);
    ipcMain.removeHandler(ipcChannels.kanbanProjectList);
    ipcMain.removeHandler(ipcChannels.kanbanProjectCreate);
    ipcMain.removeHandler(ipcChannels.kanbanList);
    ipcMain.removeHandler(ipcChannels.kanbanCreate);
    ipcMain.removeHandler(ipcChannels.kanbanMove);
    ipcMain.removeHandler(ipcChannels.kanbanUpdate);
    ipcMain.removeHandler(ipcChannels.kanbanDelete);
    ipcMain.removeHandler(ipcChannels.browserCommand);
    ipcMain.removeHandler(ipcChannels.browserOrigins);
    ipcMain.removeHandler(ipcChannels.browserSnapshot);
    ipcMain.removeHandler(ipcChannels.browserScreenshot);
    ipcMain.removeHandler(ipcChannels.browserArtifacts);
    ipcMain.removeHandler(ipcChannels.browserDrive);
    ipcMain.removeHandler(ipcChannels.browserApprove);
    ipcMain.removeHandler(ipcChannels.browserEvents);
    ipcMain.removeHandler(ipcChannels.browserPick);
    ipcMain.removeHandler(ipcChannels.browserPickSend);
    ipcMain.removeHandler(ipcChannels.browserReceipts);
    ipcMain.removeHandler(ipcChannels.desktopScreenshot);
    ipcMain.removeHandler(ipcChannels.desktopAct);
    ipcMain.removeHandler(ipcChannels.desktopApprove);
    ipcMain.removeHandler(ipcChannels.editorPick);
    ipcMain.removeHandler(ipcChannels.editorRead);
    ipcMain.removeHandler(ipcChannels.editorList);
    ipcMain.removeHandler(ipcChannels.editorGit);
    ipcMain.removeHandler(ipcChannels.editorWrite);
    ipcMain.removeHandler(ipcChannels.editorCreate);
    ipcMain.removeHandler(ipcChannels.editorSearch);
    ipcMain.removeHandler(ipcChannels.editorGitStage);
    ipcMain.removeHandler(ipcChannels.editorGitCommit);
    ipcMain.removeHandler(ipcChannels.voiceStatus);
    ipcMain.removeHandler(ipcChannels.voiceSettingsUpdate);
    ipcMain.removeHandler(ipcChannels.voiceKeySave);
    ipcMain.removeHandler(ipcChannels.voiceKeyDelete);
    ipcMain.removeHandler(ipcChannels.voiceModelDownload);
    ipcMain.removeHandler(ipcChannels.voiceModelCancel);
    ipcMain.removeHandler(ipcChannels.voiceModelDelete);
    ipcMain.removeHandler(ipcChannels.voiceTranscribe);
  };
}

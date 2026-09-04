import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CoreRuntime } from '@builderhelm/core';
import {
  accountAddRequestSchema,
  accountConfirmLoginRequestSchema,
  accountLoginTerminalRequestSchema,
  accountRemoveRequestSchema,
  accountSetActiveRequestSchema,
  accountSnapshotIpcResponseSchema,
  accountSnapshotRequestSchema,
  accountToggleHookRequestSchema,
} from '@builderhelm/protocol/accounts';
import {
  noSleepIpcResponseSchema,
  noSleepReadRequestSchema,
  noSleepSetRequestSchema,
  type NoSleepState,
} from '@builderhelm/protocol/no-sleep';
import {
  authBeginRequestSchema,
  authCancelRequestSchema,
  authIpcResponseSchema,
  authOpenAccountRequestSchema,
  authReadRequestSchema,
  authSignOutRequestSchema,
} from '@builderhelm/protocol/auth';
import {
  agentCancelInputSchema,
  agentCandidatesIpcResponseSchema,
  agentConfigureInputSchema,
  agentDiffInputSchema,
  agentForgetInputSchema,
  agentListInputSchema,
  agentPromptInputSchema,
  agentRespondPermissionInputSchema,
  agentSessionIpcResponseSchema,
  agentSessionListIpcResponseSchema,
  agentSessionStartInputSchema,
  agentSetConfigInputSchema,
  agentThreadGetInputSchema,
  agentThreadListIpcResponseSchema,
  agentTranscriptIpcResponseSchema,
  agentVoidIpcResponseSchema,
} from '@builderhelm/protocol';
import type { AuthHandoff } from './auth-handoff.js';
import type { AgentManager } from './acp/manager.js';
import type { AgentRegistry } from './acp/registry.js';
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
  swarmLandTaskIpcResponseSchema,
  swarmLandTaskRequestSchema,
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
  kanbanLinkRunIpcResponseSchema,
  kanbanLinkRunRequestSchema,
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
  githubIssueImportIpcResponseSchema,
  githubIssueImportRequestSchema,
  githubIssueListIpcResponseSchema,
  githubIssueListRequestSchema,
  githubIssueSyncIpcResponseSchema,
  githubIssueSyncRequestSchema,
  linearIssueImportIpcResponseSchema,
  linearIssueImportRequestSchema,
  linearIssueListIpcResponseSchema,
  linearIssueListRequestSchema,
  linearIssueSyncIpcResponseSchema,
  linearIssueSyncRequestSchema,
  linearKeyDeleteIpcResponseSchema,
  linearKeyDeleteRequestSchema,
  linearKeySaveIpcResponseSchema,
  linearKeySaveRequestSchema,
  linearStatusIpcResponseSchema,
  linearStatusRequestSchema,
} from '@builderhelm/protocol/integrations';

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
  browserAnnotateRequestSchema,
  browserApproveRequestSchema,
  browserArtifactsIpcResponseSchema,
  browserArtifactsRequestSchema,
  browserCommandIpcResponseSchema,
  browserCommandRequestSchema,
  browserCookieImportIpcResponseSchema,
  browserCookieImportRequestSchema,
  browserDrawSaveRequestSchema,
  browserDriveIpcResponseSchema,
  browserDriveRequestSchema,
  browserEventsIpcResponseSchema,
  browserEventsRequestSchema,
  browserMenuIpcResponseSchema,
  browserMenuRequestSchema,
  browserOriginsIpcResponseSchema,
  browserOriginsRequestSchema,
  browserProfilePartition,
  browserPickIpcResponseSchema,
  browserPickRequestSchema,
  browserPickSendIpcResponseSchema,
  browserPickSendRequestSchema,
  browserProfileCreateRequestSchema,
  browserProfileDeleteRequestSchema,
  browserReceiptsIpcResponseSchema,
  browserScreenshotIpcResponseSchema,
  browserScreenshotRequestSchema,
  browserSettingsIpcResponseSchema,
  browserSettingsRequestSchema,
  browserSettingsUpdateRequestSchema,
  browserSnapshotIpcResponseSchema,
  browserSnapshotRequestSchema,
  browserStateSchema,
  desktopActIpcResponseSchema,
  desktopActRequestSchema,
  desktopApproveRequestSchema,
  desktopScreenshotIpcResponseSchema,
  desktopScreenshotRequestSchema,
  formatAnnotationDetail,
} from '@builderhelm/protocol/browser';
import {
  editorCreateIpcResponseSchema,
  editorCreateRequestSchema,
  editorGitCommitIpcResponseSchema,
  editorGitCommitRequestSchema,
  editorGitCommitFilesIpcResponseSchema,
  editorGitCommitFilesRequestSchema,
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
import {
  reviewCheckListIpcResponseSchema,
  reviewCheckListRequestSchema,
  reviewCheckRunIpcResponseSchema,
  reviewCheckRunRequestSchema,
  reviewCiIpcResponseSchema,
  reviewCiRequestSchema,
  reviewCommentCreateIpcResponseSchema,
  reviewCommentCreateRequestSchema,
  reviewCommentListIpcResponseSchema,
  reviewCommentListRequestSchema,
  reviewDiffIpcResponseSchema,
  reviewDiffRequestSchema,
  reviewLandInspectIpcResponseSchema,
  reviewLandInspectRequestSchema,
  reviewPrDraftIpcResponseSchema,
  reviewPrDraftRequestSchema,
} from '@builderhelm/protocol/review';
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
import { popupBrowserMenu, registerBrowserMenuIpc } from './browser-menu.js';
import { setPreviewZoomHandlers } from './legal-menu.js';
import { importProfileCookies } from './browser-cookies.js';
import {
  commitGit,
  createEditorEntry,
  listEditorDir,
  listGitChanges,
  readCommitFiles,
  pickEditorFile,
  readEditorFile,
  searchEditorFiles,
  stageGitPath,
  writeEditorFile,
} from './file-reader.js';
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  session,
  type WebContents,
} from 'electron';
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
  onAccountsChanged?: () => void,
  /** Applies the OS blocker and returns what it now holds. */
  onNoSleepSync?: () => NoSleepState,
  /** Reports chat-stream activity so Agent mode can hold the blocker. */
  onNoSleepActivity?: (active: boolean) => void,
  auth?: AuthHandoff,
  agents?: { manager: AgentManager; registry: AgentRegistry },
): () => void {
  const preview = new PreviewBrowser(core.browserSettings);
  const desktop = new DesktopControl();
  registerBrowserMenuIpc();
  setPreviewZoomHandlers({
    in: () => preview.nudgeZoom(1),
    out: () => preview.nudgeZoom(-1),
    reset: () => preview.nudgeZoom(0),
  });
  // Navigation the page starts itself must reach the toolbar, so main pushes
  // state instead of waiting for the renderer's next command.
  preview.onState((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.isDestroyed()) continue;
      win.webContents.send(
        ipcChannels.browserStateEvent,
        browserStateSchema.parse(state),
      );
    }
  });
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
      // A streaming model counts as an agent working for No Sleep.
      onNoSleepActivity?.(activeStreams.size > 0);
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
          onNoSleepActivity?.(activeStreams.size > 0);
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

  ipcMain.handle(ipcChannels.swarmLandTask, async (_event, input: unknown) => {
    try {
      const request = swarmLandTaskRequestSchema.parse(input);
      const value = await core.swarm.landTask(
        request.input.runId,
        request.input.taskId,
        request.input.reviewedHead,
        request.correlationId,
      );
      return swarmLandTaskIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return swarmLandTaskIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
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
      if (request.reviewedHead === undefined) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'Landing requires the reviewed head SHA',
        );
      }
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
  ipcMain.handle(ipcChannels.kanbanLinkRun, (_event, input: unknown) => {
    try {
      const request = kanbanLinkRunRequestSchema.parse(input);
      return kanbanLinkRunIpcResponseSchema.parse({
        ok: true,
        value: core.board.linkCardRun(
          request.input.cardId,
          request.input.runId,
          request.correlationId,
        ),
      });
    } catch (error) {
      return kanbanLinkRunIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.githubIssueList, async (_event, input: unknown) => {
    try {
      githubIssueListRequestSchema.parse(input);
      return githubIssueListIpcResponseSchema.parse({
        ok: true,
        value: await core.githubIssues.listAssigned(),
      });
    } catch (error) {
      return githubIssueListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.githubIssueImport, async (_event, input: unknown) => {
    try {
      const request = githubIssueImportRequestSchema.parse(input);
      return githubIssueImportIpcResponseSchema.parse({
        ok: true,
        value: await core.githubIssues.importIssue(
          request.input.workspace,
          request.input.url,
          request.correlationId,
        ),
      });
    } catch (error) {
      return githubIssueImportIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.githubIssueSync, async (_event, input: unknown) => {
    try {
      const request = githubIssueSyncRequestSchema.parse(input);
      return githubIssueSyncIpcResponseSchema.parse({
        ok: true,
        value: await core.githubIssues.syncIssue(request.input, request.correlationId),
      });
    } catch (error) {
      return githubIssueSyncIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.linearIssueList, async (_event, input: unknown) => {
    try {
      linearIssueListRequestSchema.parse(input);
      return linearIssueListIpcResponseSchema.parse({
        ok: true,
        value: await core.linearIssues.listAssigned(),
      });
    } catch (error) {
      return linearIssueListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.linearIssueImport, async (_event, input: unknown) => {
    try {
      const request = linearIssueImportRequestSchema.parse(input);
      return linearIssueImportIpcResponseSchema.parse({
        ok: true,
        value: await core.linearIssues.importIssue(
          request.input.workspace,
          request.input.url,
          request.correlationId,
        ),
      });
    } catch (error) {
      return linearIssueImportIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.linearIssueSync, async (_event, input: unknown) => {
    try {
      const request = linearIssueSyncRequestSchema.parse(input);
      return linearIssueSyncIpcResponseSchema.parse({
        ok: true,
        value: await core.linearIssues.syncIssue(request.input, request.correlationId),
      });
    } catch (error) {
      return linearIssueSyncIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.linearStatus, async (_event, input: unknown) => {
    try {
      linearStatusRequestSchema.parse(input);
      return linearStatusIpcResponseSchema.parse({
        ok: true,
        value: await core.linearIssues.status(),
      });
    } catch (error) {
      return linearStatusIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.linearKeySave, async (_event, input: unknown) => {
    try {
      const request = linearKeySaveRequestSchema.parse(input);
      return linearKeySaveIpcResponseSchema.parse({
        ok: true,
        value: await core.linearIssues.saveKey(request.input.key, request.correlationId),
      });
    } catch (error) {
      return linearKeySaveIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.linearKeyDelete, async (_event, input: unknown) => {
    try {
      const request = linearKeyDeleteRequestSchema.parse(input);
      return linearKeyDeleteIpcResponseSchema.parse({
        ok: true,
        value: await core.linearIssues.deleteKey(request.correlationId),
      });
    } catch (error) {
      return linearKeyDeleteIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
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
      const request = browserPickRequestSchema.parse(input);
      const value = await preview.pick(request.input.mode);
      return browserPickIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserPickIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserAnnotate, async (_event, input: unknown) => {
    try {
      const request = browserAnnotateRequestSchema.parse(input);
      const { index, pick } = await preview.pinAnnotation();
      const value = core.previewArtifacts.record({
        runId: request.input.runId ?? null,
        headSha: previewHeadSha(request.input.root),
        kind: 'annotation',
        url: pick.url,
        viewport: pick.viewport,
        detail: formatAnnotationDetail({ index, note: request.input.note, pick }),
        ...(pick.pngBase64 === null
          ? {}
          : { png: new Uint8Array(Buffer.from(pick.pngBase64, 'base64')) }),
      });
      return browserScreenshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserScreenshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserDrawSave, (_event, input: unknown) => {
    try {
      const request = browserDrawSaveRequestSchema.parse(input);
      const png = Buffer.from(request.input.png);
      clipboard.writeImage(nativeImage.createFromBuffer(png));
      const value = core.previewArtifacts.record({
        runId: request.input.runId ?? null,
        headSha: previewHeadSha(request.input.root),
        kind: 'screenshot',
        url: preview.currentUrl(),
        viewport: preview.currentViewport(),
        png: new Uint8Array(png),
      });
      return browserScreenshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserScreenshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserMenu, async (event, input: unknown) => {
    try {
      const request = browserMenuRequestSchema.parse(input);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win === null) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'No window for the menu');
      }
      const value = await popupBrowserMenu(win, request.input, {
        origins: board?.listPreviewOrigins() ?? [],
        settings: core.browserSettings.read(),
        viewport: preview.currentViewport(),
      });
      return browserMenuIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserMenuIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.browserSettings, (_event, input: unknown) => {
    try {
      browserSettingsRequestSchema.parse(input);
      return browserSettingsIpcResponseSchema.parse({
        ok: true,
        value: core.browserSettings.read(),
      });
    } catch (error) {
      return browserSettingsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserSettingsUpdate, (_event, input: unknown) => {
    try {
      const request = browserSettingsUpdateRequestSchema.parse(input);
      return browserSettingsIpcResponseSchema.parse({
        ok: true,
        value: core.browserSettings.update(request.input),
      });
    } catch (error) {
      return browserSettingsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserProfileCreate, (_event, input: unknown) => {
    try {
      const request = browserProfileCreateRequestSchema.parse(input);
      return browserSettingsIpcResponseSchema.parse({
        ok: true,
        value: core.browserSettings.createProfile(request.input.name),
      });
    } catch (error) {
      return browserSettingsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserProfileDelete, async (event, input: unknown) => {
    try {
      const request = browserProfileDeleteRequestSchema.parse(input);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win === null) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'No window for the prompt');
      }
      const settings = core.browserSettings.read();
      const profile = settings.profiles.find((entry) => entry.id === request.input.id);
      if (profile === undefined) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'No such browser profile');
      }
      // Deleting a profile destroys its cookies and cache, so the confirmation
      // is a trusted main-process dialog rather than a renderer prompt.
      const confirmed = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0,
        title: 'Delete browser profile',
        message: `Delete ${profile.name}?`,
        detail: 'Its cookies, cache, and stored sign-ins are erased.',
      });
      if (confirmed.response !== 1) {
        return browserSettingsIpcResponseSchema.parse({ ok: true, value: settings });
      }
      const next = core.browserSettings.deleteProfile(profile.id);
      await session.fromPartition(browserProfilePartition(profile.id)).clearStorageData();
      return browserSettingsIpcResponseSchema.parse({ ok: true, value: next });
    } catch (error) {
      return browserSettingsIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.browserCookieImport, async (event, input: unknown) => {
    try {
      const request = browserCookieImportRequestSchema.parse(input);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win === null) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'No window for the picker');
      }
      const profile = core.browserSettings
        .read()
        .profiles.find((entry) => entry.id === request.input.id);
      if (profile === undefined) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'No such browser profile');
      }
      const value = await importProfileCookies(win, profile);
      if (!value.cancelled) {
        core.browserSettings.recordCookieImport(
          profile.id,
          value.domains,
          value.imported,
        );
      }
      return browserCookieImportIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return browserCookieImportIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
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
        `Preview pick ${picked.role} "${picked.name}" at ${picked.locator}\n` +
          `${request.input.note}\n${picked.url}`,
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
        const snap = new LocalGitInspector().inspect(
          request.input.root,
          request.input.base,
        );
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

  ipcMain.handle(ipcChannels.editorGitCommitFiles, (_event, input: unknown) => {
    try {
      const request = editorGitCommitFilesRequestSchema.parse(input);
      return editorGitCommitFilesIpcResponseSchema.parse({
        ok: true,
        value: readCommitFiles(request.input.root, request.input.sha),
      });
    } catch (error) {
      return editorGitCommitFilesIpcResponseSchema.parse({
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

  ipcMain.handle(ipcChannels.reviewDiff, async (_event, input: unknown) => {
    try {
      const request = reviewDiffRequestSchema.parse(input);
      const value = await core.review.diff(request.input);
      return reviewDiffIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewDiffIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.reviewCommentCreate, async (_event, input: unknown) => {
    try {
      const request = reviewCommentCreateRequestSchema.parse(input);
      const owner = core.swarm.ownerForFile(request.input.root, request.input.path);
      const value = await core.review.addComment({
        ...request.input,
        runId: request.input.runId ?? owner?.runId ?? null,
        seatId: request.input.seatId ?? owner?.seatId ?? null,
      });
      if (value.seatId !== null && value.runId !== null) {
        core.swarm.direct(
          value.runId,
          [value.seatId],
          `Review comment on ${value.path}:${String(value.line)}\n${value.body}`,
          request.correlationId,
        );
      }
      return reviewCommentCreateIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewCommentCreateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.reviewCommentList, async (_event, input: unknown) => {
    try {
      const request = reviewCommentListRequestSchema.parse(input);
      const value = await core.review.listComments(
        request.input.root,
        request.input.path,
      );
      return reviewCommentListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewCommentListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.reviewCheckRun, async (_event, input: unknown) => {
    try {
      const request = reviewCheckRunRequestSchema.parse(input);
      const value = await core.review.runCheck(request.input.root, request.input.command);
      return reviewCheckRunIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewCheckRunIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.reviewCheckList, async (_event, input: unknown) => {
    try {
      const request = reviewCheckListRequestSchema.parse(input);
      const value = await core.review.listChecks(request.input.root);
      return reviewCheckListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewCheckListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  ipcMain.handle(ipcChannels.reviewPrDraft, async (_event, input: unknown) => {
    try {
      const request = reviewPrDraftRequestSchema.parse(input);
      const value = await core.review.draftPr(
        request.input.root,
        request.input.title,
        request.input.body,
        request.input.base,
      );
      return reviewPrDraftIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewPrDraftIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.reviewCi, async (_event, input: unknown) => {
    try {
      const request = reviewCiRequestSchema.parse(input);
      const value = await core.review.ci(request.input.root, request.input.reviewedHead);
      return reviewCiIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewCiIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

  ipcMain.handle(ipcChannels.reviewLandInspect, async (_event, input: unknown) => {
    try {
      const request = reviewLandInspectRequestSchema.parse(input);
      const value = await core.review.inspectLand(
        request.input.root,
        request.input.branch,
        request.input.reviewedHead,
      );
      return reviewLandInspectIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return reviewLandInspectIpcResponseSchema.parse({
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

  ipcMain.handle(ipcChannels.accountSnapshot, async (_event, input: unknown) => {
    try {
      const request = accountSnapshotRequestSchema.parse(input);
      return accountSnapshotIpcResponseSchema.parse({
        ok: true,
        value: await core.accounts.snapshot(request.input.live === true),
      });
    } catch (error) {
      return accountSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.accountAdd, async (_event, input: unknown) => {
    try {
      const request = accountAddRequestSchema.parse(input);
      const value = await core.accounts.add(request.input.provider);
      onAccountsChanged?.();
      return accountSnapshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return accountSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.accountConfirmLogin, async (_event, input: unknown) => {
    try {
      const request = accountConfirmLoginRequestSchema.parse(input);
      const value = await core.accounts.confirmLogin(
        request.input.provider,
        request.input.id,
      );
      onAccountsChanged?.();
      return accountSnapshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return accountSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.accountLoginTerminal, (event, input: unknown) => {
    try {
      const request = accountLoginTerminalRequestSchema.parse(input);
      const { provider, configRoot, accountId } = request.input;
      const envName =
        provider === 'claude'
          ? 'CLAUDE_CONFIG_DIR'
          : provider === 'codex'
            ? 'CODEX_HOME'
            : 'GROK_HOME';
      const loginCommand =
        provider === 'claude'
          ? 'claude auth login'
          : provider === 'codex'
            ? 'codex login'
            : 'grok login';
      const sender = event.sender;
      // Terminal.app owns the TTY so the browser-based OAuth flow works; the
      // user signs in with the provider, auth never passes through BuilderHelm.
      execFile(
        'osascript',
        [
          '-e',
          `tell application "Terminal" to do script "${envName}='${configRoot.replace(/'/g, '')}' ${loginCommand}"`,
        ],
        () => {
          // A browser OAuth round trip takes far longer than the CLI takes to
          // start, so poll the home until its identity lands and only then
          // label it. Confirming on a fixed short delay reported a completed
          // login as a failed one and rolled the account back.
          const deadline = Date.now() + 300_000;
          const settle = (): void => {
            void core.accounts
              .confirmLogin(provider, accountId)
              .then((value) => {
                onAccountsChanged?.();
                if (!sender.isDestroyed()) {
                  sender.send(
                    ipcChannels.accountSnapshot,
                    accountSnapshotIpcResponseSchema.parse({ ok: true, value }),
                  );
                }
              })
              .catch(() => {
                // The account was removed while the login ran.
              });
          };
          const tick = setInterval(() => {
            const signedIn = core.accounts.accountEmail(provider, accountId) !== null;
            if (!signedIn && Date.now() < deadline) return;
            clearInterval(tick);
            settle();
          }, 2_000);
        },
      );
      return { opened: true } as const;
    } catch (error) {
      throw ipcError(error);
    }
  });
  ipcMain.handle(ipcChannels.accountRemove, async (_event, input: unknown) => {
    try {
      const request = accountRemoveRequestSchema.parse(input);
      const value = await core.accounts.remove(request.input.provider, request.input.id);
      onAccountsChanged?.();
      return accountSnapshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return accountSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.accountSetActive, async (_event, input: unknown) => {
    try {
      const request = accountSetActiveRequestSchema.parse(input);
      const value = await core.accounts.setActive(
        request.input.provider,
        request.input.id,
      );
      onAccountsChanged?.();
      return accountSnapshotIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return accountSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.accountToggleHook, async (_event, input: unknown) => {
    try {
      const request = accountToggleHookRequestSchema.parse(input);
      core.accounts.setHookSystemDefault(request.input.enabled);
      onAccountsChanged?.();
      return accountSnapshotIpcResponseSchema.parse({
        ok: true,
        value: await core.accounts.snapshot(),
      });
    } catch (error) {
      return accountSnapshotIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.noSleepRead, (_event, input: unknown) => {
    try {
      noSleepReadRequestSchema.parse(input);
      return noSleepIpcResponseSchema.parse({
        ok: true,
        value: onNoSleepSync?.() ?? core.noSleep.read(false),
      });
    } catch (error) {
      return noSleepIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.noSleepSet, (_event, input: unknown) => {
    try {
      const request = noSleepSetRequestSchema.parse(input);
      core.noSleep.set(request.input.mode, false);
      // The desktop applies the OS blocker and reports what it actually holds.
      return noSleepIpcResponseSchema.parse({
        ok: true,
        value: onNoSleepSync?.() ?? core.noSleep.read(false),
      });
    } catch (error) {
      return noSleepIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.authRead, async (_event, input: unknown) => {
    try {
      authReadRequestSchema.parse(input);
      return authIpcResponseSchema.parse({
        ok: true,
        value: await (auth?.read() ?? core.auth.read()),
      });
    } catch (error) {
      return authIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.authBegin, async (_event, input: unknown) => {
    try {
      authBeginRequestSchema.parse(input);
      if (auth === undefined) throw new Error('Sign in is not available.');
      return authIpcResponseSchema.parse({ ok: true, value: await auth.begin() });
    } catch (error) {
      return authIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.authCancel, async (_event, input: unknown) => {
    try {
      authCancelRequestSchema.parse(input);
      if (auth === undefined) throw new Error('Sign in is not available.');
      return authIpcResponseSchema.parse({ ok: true, value: await auth.cancel() });
    } catch (error) {
      return authIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.authSignOut, async (_event, input: unknown) => {
    try {
      authSignOutRequestSchema.parse(input);
      if (auth === undefined) throw new Error('Sign in is not available.');
      return authIpcResponseSchema.parse({ ok: true, value: await auth.signOut() });
    } catch (error) {
      return authIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.authOpenAccount, async (_event, input: unknown) => {
    try {
      authOpenAccountRequestSchema.parse(input);
      if (auth === undefined) throw new Error('Sign in is not available.');
      return authIpcResponseSchema.parse({ ok: true, value: await auth.openAccount() });
    } catch (error) {
      return authIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
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

  // Agent sessions. Every handler needs `agents`, so the guard is one helper
  // rather than a repeated undefined check.
  function requireAgents(): NonNullable<typeof agents> {
    if (agents === undefined) {
      throw new BuilderHelmError('INTEGRATION_OFFLINE', 'Agent chat is not available.');
    }
    return agents;
  }

  ipcMain.handle(ipcChannels.agentCandidates, async (_event, input: unknown) => {
    try {
      agentListInputSchema.parse(input);
      const value = await requireAgents().registry.candidates();
      return agentCandidatesIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return agentCandidatesIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.agentConfigure, (_event, input: unknown) => {
    try {
      const parsed = agentConfigureInputSchema.parse(input);
      requireAgents().registry.add(parsed.agent);
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentForget, (_event, input: unknown) => {
    try {
      const parsed = agentForgetInputSchema.parse(input);
      requireAgents().registry.remove(parsed.agentId);
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentSessionStart, async (_event, input: unknown) => {
    try {
      const parsed = agentSessionStartInputSchema.parse(input);
      const value = await requireAgents().manager.start({
        agentId: parsed.agentId,
        cwd: parsed.cwd,
        threadId: parsed.threadId,
        resumeSessionId: parsed.resumeSessionId,
      });
      return agentSessionIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return agentSessionIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentSessionList, (_event, input: unknown) => {
    try {
      agentListInputSchema.parse(input);
      const value = requireAgents().manager.list();
      return agentSessionListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return agentSessionListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.agentSessionClose, async (_event, input: unknown) => {
    try {
      const parsed = agentCancelInputSchema.parse(input);
      await requireAgents().manager.close(parsed.sessionId);
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentPrompt, async (_event, input: unknown) => {
    try {
      const parsed = agentPromptInputSchema.parse(input);
      // Resolves when the turn ends; progress already went out as events.
      await requireAgents().manager.prompt(parsed.sessionId, parsed.content);
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentCancel, (_event, input: unknown) => {
    try {
      const parsed = agentCancelInputSchema.parse(input);
      requireAgents().manager.cancel(parsed.sessionId);
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentSetConfig, async (_event, input: unknown) => {
    try {
      const parsed = agentSetConfigInputSchema.parse(input);
      await requireAgents().manager.setConfigOption(
        parsed.sessionId,
        parsed.configId,
        parsed.value,
      );
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentRespondPermission, (_event, input: unknown) => {
    try {
      const parsed = agentRespondPermissionInputSchema.parse(input);
      requireAgents().manager.respond(
        parsed.sessionId,
        parsed.response.requestId,
        parsed.response.decision,
      );
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.agentThreadList, (_event, input: unknown) => {
    try {
      agentListInputSchema.parse(input);
      const value = requireAgents().manager.threads();
      return agentThreadListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return agentThreadListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.agentThreadGet, (_event, input: unknown) => {
    try {
      const parsed = agentThreadGetInputSchema.parse(input);
      const value = requireAgents().manager.transcript(parsed.threadId);
      return agentTranscriptIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return agentTranscriptIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.agentDiff, async (_event, input: unknown) => {
    try {
      const parsed = agentDiffInputSchema.parse(input);
      await requireAgents().manager.applyDiff(
        parsed.sessionId,
        parsed.path,
        parsed.action,
      );
      return agentVoidIpcResponseSchema.parse({ ok: true, value: null });
    } catch (error) {
      return agentVoidIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });

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
    ipcMain.removeHandler(ipcChannels.swarmLandTask);
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
    ipcMain.removeHandler(ipcChannels.kanbanLinkRun);
    ipcMain.removeHandler(ipcChannels.githubIssueList);
    ipcMain.removeHandler(ipcChannels.githubIssueImport);
    ipcMain.removeHandler(ipcChannels.githubIssueSync);
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
    ipcMain.removeHandler(ipcChannels.browserAnnotate);
    ipcMain.removeHandler(ipcChannels.browserDrawSave);
    ipcMain.removeHandler(ipcChannels.browserMenu);
    ipcMain.removeHandler(ipcChannels.browserMenuPick);
    ipcMain.removeHandler(ipcChannels.browserSettings);
    ipcMain.removeHandler(ipcChannels.browserSettingsUpdate);
    ipcMain.removeHandler(ipcChannels.browserProfileCreate);
    ipcMain.removeHandler(ipcChannels.browserProfileDelete);
    ipcMain.removeHandler(ipcChannels.browserCookieImport);
    ipcMain.removeHandler(ipcChannels.desktopScreenshot);
    ipcMain.removeHandler(ipcChannels.desktopAct);
    ipcMain.removeHandler(ipcChannels.desktopApprove);
    ipcMain.removeHandler(ipcChannels.editorPick);
    ipcMain.removeHandler(ipcChannels.accountAdd);
    ipcMain.removeHandler(ipcChannels.accountConfirmLogin);
    ipcMain.removeHandler(ipcChannels.accountRemove);
    ipcMain.removeHandler(ipcChannels.editorGit);
    ipcMain.removeHandler(ipcChannels.editorGitCommitFiles);
    ipcMain.removeHandler(ipcChannels.editorCreate);
    ipcMain.removeHandler(ipcChannels.editorSearch);
    ipcMain.removeHandler(ipcChannels.editorGitStage);
    ipcMain.removeHandler(ipcChannels.editorGitCommit);
    ipcMain.removeHandler(ipcChannels.reviewDiff);
    ipcMain.removeHandler(ipcChannels.reviewCommentCreate);
    ipcMain.removeHandler(ipcChannels.reviewCommentList);
    ipcMain.removeHandler(ipcChannels.reviewCheckRun);
    ipcMain.removeHandler(ipcChannels.reviewCheckList);
    ipcMain.removeHandler(ipcChannels.accountSetActive);
    ipcMain.removeHandler(ipcChannels.accountToggleHook);
    ipcMain.removeHandler(ipcChannels.noSleepRead);
    ipcMain.removeHandler(ipcChannels.noSleepSet);
    ipcMain.removeHandler(ipcChannels.authRead);
    ipcMain.removeHandler(ipcChannels.authBegin);
    ipcMain.removeHandler(ipcChannels.authCancel);
    ipcMain.removeHandler(ipcChannels.authSignOut);
    ipcMain.removeHandler(ipcChannels.authOpenAccount);
    ipcMain.removeHandler(ipcChannels.agentCandidates);
    ipcMain.removeHandler(ipcChannels.agentConfigure);
    ipcMain.removeHandler(ipcChannels.agentForget);
    ipcMain.removeHandler(ipcChannels.agentSessionStart);
    ipcMain.removeHandler(ipcChannels.agentSessionList);
    ipcMain.removeHandler(ipcChannels.agentSessionClose);
    ipcMain.removeHandler(ipcChannels.agentPrompt);
    ipcMain.removeHandler(ipcChannels.agentCancel);
    ipcMain.removeHandler(ipcChannels.agentSetConfig);
    ipcMain.removeHandler(ipcChannels.agentRespondPermission);
    ipcMain.removeHandler(ipcChannels.agentThreadList);
    ipcMain.removeHandler(ipcChannels.agentThreadGet);
    ipcMain.removeHandler(ipcChannels.agentDiff);
    ipcMain.removeHandler(ipcChannels.voiceTranscribe);
    ipcMain.removeHandler(ipcChannels.accountSnapshot);
    ipcMain.removeHandler(ipcChannels.accountAdd);
    ipcMain.removeHandler(ipcChannels.accountRemove);
    ipcMain.removeHandler(ipcChannels.accountSetActive);
    ipcMain.removeHandler(ipcChannels.voiceSettingsUpdate);
    ipcMain.removeHandler(ipcChannels.voiceKeySave);
    ipcMain.removeHandler(ipcChannels.voiceKeyDelete);
    ipcMain.removeHandler(ipcChannels.voiceModelDownload);
    ipcMain.removeHandler(ipcChannels.voiceModelCancel);
    ipcMain.removeHandler(ipcChannels.voiceModelDelete);
    ipcMain.removeHandler(ipcChannels.voiceTranscribe);
  };
}

import {
  accountAddInputSchema,
  accountConfirmLoginInputSchema,
  accountLoginTerminalInputSchema,
  accountRemoveInputSchema,
  accountSetActiveInputSchema,
  accountSnapshotIpcResponseSchema,
  accountToggleHookInputSchema,
} from '@builderhelm/protocol/accounts';
import {
  noSleepIpcResponseSchema,
  noSleepSetInputSchema,
  noSleepStateSchema,
} from '@builderhelm/protocol/no-sleep';
import { authIpcResponseSchema, authStateSchema } from '@builderhelm/protocol/auth';
import {
  actionCommandInputSchema,
  actionCommandIpcResponseSchema,
  actionSnapshotInputSchema,
  actionSnapshotIpcResponseSchema,
  approvalRejectIpcResponseSchema,
  approvalResolveInputSchema,
  approvalResolveIpcResponseSchema,
  permissionPolicyUpdateInputSchema,
  permissionPolicyUpdateIpcResponseSchema,
} from '@builderhelm/protocol/actions';
import {
  boardAddPaneInputSchema,
  boardAddPaneIpcResponseSchema,
  boardCreateInputSchema,
  boardCreateIpcResponseSchema,
  boardDetectAgentsIpcResponseSchema,
  boardPaneCloseInputSchema,
  boardPaneCloseIpcResponseSchema,
  boardPaneAckInputSchema,
  boardPaneAckIpcResponseSchema,
  boardPaneDrainInputSchema,
  boardPaneDrainIpcResponseSchema,
  boardPaneEventEnvelopeSchema,
  boardHomeDirIpcResponseSchema,
  boardPaneResizeInputSchema,
  boardPaneWriteInputSchema,
  boardPresetDeleteInputSchema,
  boardPresetDeleteIpcResponseSchema,
  boardPresetListIpcResponseSchema,
  boardPresetSaveInputSchema,
  boardPresetSaveIpcResponseSchema,
  boardResizeIpcResponseSchema,
  boardSelectFolderIpcResponseSchema,
  boardWriteIpcResponseSchema,
  boardLandInputSchema,
  boardLandIpcResponseSchema,
  boardLandPreviewIpcResponseSchema,
  type BoardPaneEventEnvelope,
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
  kanbanCreateInputSchema,
  kanbanCreateIpcResponseSchema,
  kanbanDeleteInputSchema,
  kanbanDeleteIpcResponseSchema,
  kanbanListInputSchema,
  kanbanLinkRunInputSchema,
  kanbanLinkRunIpcResponseSchema,
  kanbanListIpcResponseSchema,
  kanbanMoveInputSchema,
  kanbanMoveIpcResponseSchema,
  kanbanProjectCreateInputSchema,
  kanbanProjectCreateIpcResponseSchema,
  kanbanProjectListInputSchema,
  kanbanProjectListIpcResponseSchema,
  kanbanUpdateInputSchema,
  kanbanUpdateIpcResponseSchema,
} from '@builderhelm/protocol/kanban';
import {
  githubIssueImportInputSchema,
  githubIssueImportIpcResponseSchema,
  githubIssueListInputSchema,
  githubIssueListIpcResponseSchema,
  githubIssueSyncInputSchema,
  githubIssueSyncIpcResponseSchema,
  linearIssueImportInputSchema,
  linearIssueImportIpcResponseSchema,
  linearIssueListInputSchema,
  linearIssueListIpcResponseSchema,
  linearIssueSyncInputSchema,
  linearIssueSyncIpcResponseSchema,
  linearKeyDeleteIpcResponseSchema,
  linearKeySaveInputSchema,
  linearKeySaveIpcResponseSchema,
  linearStatusIpcResponseSchema,
} from '@builderhelm/protocol/integrations';

import {
  ipcChannels,
  systemHealthResponseSchema,
  type BuilderHelmDesktopApi,
} from '@builderhelm/protocol/ipc';
import {
  browserArtifactsIpcResponseSchema,
  browserCommandIpcResponseSchema,
  browserCommandInputSchema,
  browserCookieImportIpcResponseSchema,
  browserDriveIpcResponseSchema,
  browserEventsIpcResponseSchema,
  browserMenuInputSchema,
  browserMenuIpcResponseSchema,
  browserMenuPayloadSchema,
  browserMenuPickSchema,
  browserOriginsIpcResponseSchema,
  browserPickIpcResponseSchema,
  browserPickSendIpcResponseSchema,
  browserProfileCreateInputSchema,
  browserProfileDeleteInputSchema,
  browserReceiptsIpcResponseSchema,
  browserScreenshotIpcResponseSchema,
  browserSettingsIpcResponseSchema,
  browserSettingsUpdateInputSchema,
  browserSnapshotIpcResponseSchema,
  browserStateSchema,
  desktopActIpcResponseSchema,
  desktopActInputSchema,
  desktopScreenshotIpcResponseSchema,
  previewAnnotationInputSchema,
  previewArtifactListInputSchema,
  previewDrawSaveInputSchema,
  previewDriveInputSchema,
  previewPickInputSchema,
  previewScreenshotInputSchema,
} from '@builderhelm/protocol/browser';
import {
  editorCreateInputSchema,
  editorCreateIpcResponseSchema,
  editorGitCommitInputSchema,
  editorGitCommitIpcResponseSchema,
  editorGitCommitFilesInputSchema,
  editorGitCommitFilesIpcResponseSchema,
  editorGitInputSchema,
  editorGitIpcResponseSchema,
  editorGitStageInputSchema,
  editorGitStageIpcResponseSchema,
  editorListInputSchema,
  editorListIpcResponseSchema,
  editorPickIpcResponseSchema,
  editorReadInputSchema,
  editorReadIpcResponseSchema,
  editorSearchInputSchema,
  editorSearchIpcResponseSchema,
  editorWriteInputSchema,
  editorWriteIpcResponseSchema,
} from '@builderhelm/protocol/editor';
import {
  reviewCheckListIpcResponseSchema,
  reviewCheckListInputSchema,
  reviewCheckRunIpcResponseSchema,
  reviewCheckRunInputSchema,
  reviewCiIpcResponseSchema,
  reviewCiInputSchema,
  reviewCommentCreateIpcResponseSchema,
  reviewCommentCreateInputSchema,
  reviewCommentListIpcResponseSchema,
  reviewCommentListInputSchema,
  reviewDiffIpcResponseSchema,
  reviewDiffInputSchema,
  reviewLandInspectIpcResponseSchema,
  reviewLandInspectInputSchema,
  reviewPrDraftIpcResponseSchema,
  reviewPrDraftInputSchema,
} from '@builderhelm/protocol/review';
import {
  voiceHotkeyEventSchema,
  voiceKeyDeleteIpcResponseSchema,
  voiceKeySaveInputSchema,
  voiceModelEventSchema,
  voiceModelIdInputSchema,
  voiceSettingsUpdateInputSchema,
  voiceStatusIpcResponseSchema,
  voiceTranscribeInputSchema,
  voiceTranscribeIpcResponseSchema,
} from '@builderhelm/protocol/voice';
import {
  createProviderInputSchema,
  deleteProviderInputSchema,
  modelListInputSchema,
  modelListIpcResponseSchema,
  modelCapabilityOverrideListInputSchema,
  modelCapabilityOverrideListIpcResponseSchema,
  modelCapabilityOverrideUpdateInputSchema,
  modelCapabilityOverrideUpdateIpcResponseSchema,
  providerDeleteResponseSchema,
  providerListResponseSchema,
  providerMutationResponseSchema,
  providerOperationInputSchema,
  providerTestConnectionIpcResponseSchema,
  updateProviderInputSchema,
} from '@builderhelm/protocol/providers';
import {
  chatStreamCancelInputSchema,
  chatStreamCancelIpcResponseSchema,
  chatStreamEnvelopeSchema,
  chatStreamInputSchema,
  chatStreamStartIpcResponseSchema,
  chatThreadInputSchema,
  chatThreadIpcResponseSchema,
  chatThreadListIpcResponseSchema,
  chatTranscriptIpcResponseSchema,
  createChatThreadInputSchema,
  type ChatClientStreamEvent,
} from '@builderhelm/protocol/chat';
import {
  knowledgeAnswerIpcResponseSchema,
  knowledgeQueryInputSchema,
  knowledgeSourceInputSchema,
  knowledgeSourceIpcResponseSchema,
  knowledgeVaultListInputSchema,
  knowledgeVaultListIpcResponseSchema,
  knowledgeVaultMutationIpcResponseSchema,
  knowledgeVaultSelectIpcResponseSchema,
  knowledgeVaultSyncInputSchema,
} from '@builderhelm/protocol/knowledge';
import {
  projectDashboardIpcResponseSchema,
  projectRepositoryRefreshInputSchema,
  projectRepositoryRefreshIpcResponseSchema,
  projectRepositorySelectInputSchema,
  projectRepositorySelectIpcResponseSchema,
} from '@builderhelm/protocol/projects';
import { contextBridge, ipcRenderer } from 'electron';
import {
  agentCandidatesIpcResponseSchema,
  agentSessionEventSchema,
  agentSessionIpcResponseSchema,
  agentSessionListIpcResponseSchema,
  agentThreadListIpcResponseSchema,
  agentTranscriptIpcResponseSchema,
  agentVoidIpcResponseSchema,
} from '@builderhelm/protocol/agent-session';
import { runtimeCapabilitiesIpcResponseSchema } from '@builderhelm/protocol/runtime';
import {
  agentProfileIpcResponseSchema,
  agentProfileListIpcResponseSchema,
} from '@builderhelm/protocol/agent-profiles';

function unwrap<T>(result: {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly message: string };
}): T {
  if (result.ok && result.value !== undefined) return result.value;
  throw new Error(result.error?.message ?? 'The request could not be completed');
}

const chatListeners = new Map<string, (event: ChatClientStreamEvent) => void>();

ipcRenderer.on(ipcChannels.chatStreamEvent, (_event, value: unknown) => {
  const parsed = chatStreamEnvelopeSchema.safeParse(value);
  if (!parsed.success) return;
  const listener = chatListeners.get(parsed.data.runId);
  if (listener === undefined) return;
  listener(parsed.data.event);
  if (parsed.data.event.type === 'done' || parsed.data.event.type === 'error') {
    chatListeners.delete(parsed.data.runId);
  }
});

const boardListeners = new Map<string, Set<(event: BoardPaneEventEnvelope) => void>>();

ipcRenderer.on(ipcChannels.boardEvent, (_event, value: unknown) => {
  const parsed = boardPaneEventEnvelopeSchema.safeParse(value);
  if (!parsed.success) return;
  const listeners = boardListeners.get(parsed.data.sessionId);
  if (listeners === undefined) return;
  for (const listener of listeners) listener(parsed.data);
});

const api: BuilderHelmDesktopApi = {
  system: {
    async health() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.systemHealth, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return systemHealthResponseSchema.parse(response);
    },
  },
  providers: {
    async list() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return providerListResponseSchema.parse(response);
    },
    async create(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerCreate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: createProviderInputSchema.parse(input),
      });
      return providerMutationResponseSchema.parse(response);
    },
    async update(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerUpdate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: updateProviderInputSchema.parse(input),
      });
      return providerMutationResponseSchema.parse(response);
    },
    async delete(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerDelete, {
        correlationId: globalThis.crypto.randomUUID(),
        input: deleteProviderInputSchema.parse(input),
      });
      return providerDeleteResponseSchema.parse(response);
    },
    async testConnection(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.providerTestConnection,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: providerOperationInputSchema.parse(input),
        },
      );
      return unwrap(providerTestConnectionIpcResponseSchema.parse(response));
    },
  },
  models: {
    async discover(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.modelDiscover, {
        correlationId: globalThis.crypto.randomUUID(),
        input: providerOperationInputSchema.parse(input),
      });
      return unwrap(modelListIpcResponseSchema.parse(response));
    },
    async list(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.modelList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: modelListInputSchema.parse(input),
      });
      return unwrap(modelListIpcResponseSchema.parse(response));
    },
    async listCapabilityOverrides(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.modelCapabilityOverrideList,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: modelCapabilityOverrideListInputSchema.parse(input),
        },
      );
      return unwrap(modelCapabilityOverrideListIpcResponseSchema.parse(response));
    },
    async updateCapabilityOverride(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.modelCapabilityOverrideUpdate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: modelCapabilityOverrideUpdateInputSchema.parse(input),
        },
      );
      return unwrap(modelCapabilityOverrideUpdateIpcResponseSchema.parse(response));
    },
  },
  chat: {
    async list() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(chatThreadListIpcResponseSchema.parse(response));
    },
    async create(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatCreate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: createChatThreadInputSchema.parse(input),
      });
      return unwrap(chatThreadIpcResponseSchema.parse(response));
    },
    async get(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatGet, {
        correlationId: globalThis.crypto.randomUUID(),
        input: chatThreadInputSchema.parse(input),
      });
      return unwrap(chatTranscriptIpcResponseSchema.parse(response));
    },
    async startStream(input, onEvent) {
      const parsedInput = chatStreamInputSchema.parse(input);
      const runId = globalThis.crypto.randomUUID();
      chatListeners.set(runId, onEvent);
      try {
        const response: unknown = await ipcRenderer.invoke(ipcChannels.chatStreamStart, {
          correlationId: globalThis.crypto.randomUUID(),
          runId,
          input: parsedInput,
        });
        return unwrap(chatStreamStartIpcResponseSchema.parse(response));
      } catch (error) {
        chatListeners.delete(runId);
        throw error;
      }
    },
    async cancelStream(input) {
      const parsedInput = chatStreamCancelInputSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatStreamCancel, {
        correlationId: globalThis.crypto.randomUUID(),
        input: parsedInput,
      });
      return unwrap(chatStreamCancelIpcResponseSchema.parse(response));
    },
  },
  knowledge: {
    async listVaults(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeVaultList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeVaultListInputSchema.parse(input),
      });
      return unwrap(knowledgeVaultListIpcResponseSchema.parse(response));
    },
    async selectVault() {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.knowledgeVaultSelect,
        { correlationId: globalThis.crypto.randomUUID() },
      );
      return unwrap(knowledgeVaultSelectIpcResponseSchema.parse(response));
    },
    async syncVault(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeVaultSync, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeVaultSyncInputSchema.parse(input),
      });
      return unwrap(knowledgeVaultMutationIpcResponseSchema.parse(response));
    },
    async answer(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeQuery, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeQueryInputSchema.parse(input),
      });
      return unwrap(knowledgeAnswerIpcResponseSchema.parse(response));
    },
    async getSource(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeSourceGet, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeSourceInputSchema.parse(input),
      });
      return unwrap(knowledgeSourceIpcResponseSchema.parse(response));
    },
  },
  actions: {
    async snapshot(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionSnapshot, {
        correlationId: globalThis.crypto.randomUUID(),
        input: actionSnapshotInputSchema.parse(input),
      });
      return unwrap(actionSnapshotIpcResponseSchema.parse(response));
    },
    async command(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionCommand, {
        correlationId: globalThis.crypto.randomUUID(),
        input: actionCommandInputSchema.parse(input),
      });
      return unwrap(actionCommandIpcResponseSchema.parse(response));
    },
    async approve(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionApprove, {
        correlationId: globalThis.crypto.randomUUID(),
        input: approvalResolveInputSchema.parse(input),
      });
      return unwrap(approvalResolveIpcResponseSchema.parse(response));
    },
    async reject(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionReject, {
        correlationId: globalThis.crypto.randomUUID(),
        input: approvalResolveInputSchema.parse(input),
      });
      return unwrap(approvalRejectIpcResponseSchema.parse(response));
    },
    async updatePolicy(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionPolicyUpdate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: permissionPolicyUpdateInputSchema.parse(input),
      });
      return unwrap(permissionPolicyUpdateIpcResponseSchema.parse(response));
    },
  },
  swarm: {
    async create(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmCreate,
        swarmCreateRequestSchema.parse(input),
      );
      return unwrap(swarmCreateIpcResponseSchema.parse(response));
    },
    async state(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmState,
        swarmStateRequestSchema.parse(input),
      );
      return unwrap(swarmStateIpcResponseSchema.parse(response));
    },
    async direct(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmDirect,
        swarmDirectRequestSchema.parse(input),
      );
      return unwrap(swarmDirectIpcResponseSchema.parse(response));
    },
    async landTask(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmLandTask,
        swarmLandTaskRequestSchema.parse(input),
      );
      return unwrap(swarmLandTaskIpcResponseSchema.parse(response));
    },
    async stop(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmStop,
        swarmStopRequestSchema.parse(input),
      );
      return unwrap(swarmStopIpcResponseSchema.parse(response));
    },
    onEvent(listener) {
      const subscription = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ): void => {
        if (
          typeof payload === 'object' &&
          payload !== null &&
          typeof (payload as { runId?: unknown }).runId === 'string'
        ) {
          listener((payload as { runId: string }).runId);
        }
      };
      ipcRenderer.on(ipcChannels.swarmEvent, subscription);
      return () => ipcRenderer.removeListener(ipcChannels.swarmEvent, subscription);
    },
    async latest(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmLatest,
        swarmLatestRequestSchema.parse(input),
      );
      return unwrap(swarmLatestIpcResponseSchema.parse(response));
    },
    async stopSeat(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmStopSeat,
        swarmStopSeatRequestSchema.parse(input),
      );
      return unwrap(swarmStopSeatIpcResponseSchema.parse(response));
    },
  },
  board: {
    async homeDir() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.boardHomeDir);
      return unwrap(boardHomeDirIpcResponseSchema.parse(response));
    },
    async createSession(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardCreate,
        boardCreateInputSchema.parse(input),
      );
      return unwrap(boardCreateIpcResponseSchema.parse(response));
    },
    async write(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardWrite,
        boardPaneWriteInputSchema.parse(input),
      );
      return unwrap(boardWriteIpcResponseSchema.parse(response));
    },
    async resize(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardResize,
        boardPaneResizeInputSchema.parse(input),
      );
      return unwrap(boardResizeIpcResponseSchema.parse(response));
    },
    async closePane(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardPaneClose,
        boardPaneCloseInputSchema.parse(input),
      );
      return unwrap(boardPaneCloseIpcResponseSchema.parse(response));
    },
    async addPane(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardPaneAdd,
        boardAddPaneInputSchema.parse(input),
      );
      return unwrap(boardAddPaneIpcResponseSchema.parse(response));
    },
    async drainPane(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardPaneDrain,
        boardPaneDrainInputSchema.parse(input),
      );
      return unwrap(boardPaneDrainIpcResponseSchema.parse(response));
    },
    async ackPane(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardPaneAck,
        boardPaneAckInputSchema.parse(input),
      );
      return unwrap(boardPaneAckIpcResponseSchema.parse(response));
    },
    async selectFolder() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.boardSelectFolder, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(boardSelectFolderIpcResponseSchema.parse(response));
    },
    async detectAgents() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.boardDetectAgents, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(boardDetectAgentsIpcResponseSchema.parse(response));
    },
    async listPresets() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.boardPresetList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(boardPresetListIpcResponseSchema.parse(response));
    },
    async savePreset(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardPresetSave,
        boardPresetSaveInputSchema.parse(input),
      );
      return unwrap(boardPresetSaveIpcResponseSchema.parse(response));
    },
    async deletePreset(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardPresetDelete,
        boardPresetDeleteInputSchema.parse(input),
      );
      return unwrap(boardPresetDeleteIpcResponseSchema.parse(response));
    },
    async land(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardLand,
        boardLandInputSchema.parse(input),
      );
      return unwrap(boardLandIpcResponseSchema.parse(response));
    },
    async previewLand(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.boardLandPreview,
        boardLandInputSchema.parse(input),
      );
      return unwrap(boardLandPreviewIpcResponseSchema.parse(response));
    },
    async listProjects(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanProjectList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanProjectListInputSchema.parse(input),
      });
      return unwrap(kanbanProjectListIpcResponseSchema.parse(response));
    },
    async createProject(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.kanbanProjectCreate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: kanbanProjectCreateInputSchema.parse(input),
        },
      );
      return unwrap(kanbanProjectCreateIpcResponseSchema.parse(response));
    },
    async listCards(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanListInputSchema.parse(input),
      });
      return unwrap(kanbanListIpcResponseSchema.parse(response));
    },
    async createCard(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanCreate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanCreateInputSchema.parse(input),
      });
      return unwrap(kanbanCreateIpcResponseSchema.parse(response));
    },
    async moveCard(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanMove, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanMoveInputSchema.parse(input),
      });
      return unwrap(kanbanMoveIpcResponseSchema.parse(response));
    },
    async updateCard(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanUpdate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanUpdateInputSchema.parse(input),
      });
      return unwrap(kanbanUpdateIpcResponseSchema.parse(response));
    },
    async linkCardRun(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanLinkRun, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanLinkRunInputSchema.parse(input),
      });
      return unwrap(kanbanLinkRunIpcResponseSchema.parse(response));
    },
    async deleteCard(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.kanbanDelete, {
        correlationId: globalThis.crypto.randomUUID(),
        input: kanbanDeleteInputSchema.parse(input),
      });
      return unwrap(kanbanDeleteIpcResponseSchema.parse(response));
    },
    onPaneEvent(sessionId, listener) {
      let listeners = boardListeners.get(sessionId);
      if (listeners === undefined) {
        listeners = new Set();
        boardListeners.set(sessionId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) boardListeners.delete(sessionId);
      };
    },
  },
  integrations: {
    async listGitHubIssues(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.githubIssueList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: githubIssueListInputSchema.parse(input),
      });
      return unwrap(githubIssueListIpcResponseSchema.parse(response));
    },
    async importGitHubIssue(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.githubIssueImport, {
        correlationId: globalThis.crypto.randomUUID(),
        input: githubIssueImportInputSchema.parse(input),
      });
      return unwrap(githubIssueImportIpcResponseSchema.parse(response));
    },
    async syncGitHubIssue(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.githubIssueSync, {
        correlationId: globalThis.crypto.randomUUID(),
        input: githubIssueSyncInputSchema.parse(input),
      });
      return unwrap(githubIssueSyncIpcResponseSchema.parse(response));
    },
    async listLinearIssues(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.linearIssueList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: linearIssueListInputSchema.parse(input),
      });
      return unwrap(linearIssueListIpcResponseSchema.parse(response));
    },
    async importLinearIssue(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.linearIssueImport, {
        correlationId: globalThis.crypto.randomUUID(),
        input: linearIssueImportInputSchema.parse(input),
      });
      return unwrap(linearIssueImportIpcResponseSchema.parse(response));
    },
    async syncLinearIssue(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.linearIssueSync, {
        correlationId: globalThis.crypto.randomUUID(),
        input: linearIssueSyncInputSchema.parse(input),
      });
      return unwrap(linearIssueSyncIpcResponseSchema.parse(response));
    },
    async linearStatus() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.linearStatus, {
        correlationId: globalThis.crypto.randomUUID(),
        input: {},
      });
      return unwrap(linearStatusIpcResponseSchema.parse(response));
    },
    async saveLinearKey(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.linearKeySave, {
        correlationId: globalThis.crypto.randomUUID(),
        input: linearKeySaveInputSchema.parse(input),
      });
      return unwrap(linearKeySaveIpcResponseSchema.parse(response));
    },
    async deleteLinearKey() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.linearKeyDelete, {
        correlationId: globalThis.crypto.randomUUID(),
        input: {},
      });
      return unwrap(linearKeyDeleteIpcResponseSchema.parse(response));
    },
  },
  projects: {
    async dashboard() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.projectDashboard, {
        correlationId: globalThis.crypto.randomUUID(),
        input: {},
      });
      return unwrap(projectDashboardIpcResponseSchema.parse(response));
    },
    async selectRepository(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.projectRepositorySelect,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: projectRepositorySelectInputSchema.parse(input),
        },
      );
      return unwrap(projectRepositorySelectIpcResponseSchema.parse(response));
    },
    async refreshRepository(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.projectRepositoryRefresh,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: projectRepositoryRefreshInputSchema.parse(input),
        },
      );
      return unwrap(projectRepositoryRefreshIpcResponseSchema.parse(response));
    },
  },
  browser: {
    async command(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserCommand, {
        correlationId: globalThis.crypto.randomUUID(),
        input: browserCommandInputSchema.parse(input),
      });
      return unwrap(browserCommandIpcResponseSchema.parse(response));
    },
    async origins() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserOrigins, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(browserOriginsIpcResponseSchema.parse(response));
    },
    async snapshot(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserSnapshot, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewScreenshotInputSchema.parse(input),
      });
      return unwrap(browserSnapshotIpcResponseSchema.parse(response));
    },
    async screenshot(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserScreenshot, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewScreenshotInputSchema.parse(input),
      });
      return unwrap(browserScreenshotIpcResponseSchema.parse(response));
    },
    async artifacts(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserArtifacts, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewArtifactListInputSchema.parse(input),
      });
      return unwrap(browserArtifactsIpcResponseSchema.parse(response));
    },
    async drive(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserDrive, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewDriveInputSchema.parse(input),
      });
      return unwrap(browserDriveIpcResponseSchema.parse(response));
    },
    async approve(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserApprove, {
        correlationId: globalThis.crypto.randomUUID(),
        input,
      });
      return unwrap(browserDriveIpcResponseSchema.parse(response));
    },
    async events() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserEvents, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(browserEventsIpcResponseSchema.parse(response));
    },
    async pick(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserPick, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewPickInputSchema.parse(input),
      });
      return unwrap(browserPickIpcResponseSchema.parse(response));
    },
    async annotate(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserAnnotate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewAnnotationInputSchema.parse(input),
      });
      return unwrap(browserScreenshotIpcResponseSchema.parse(response));
    },
    async saveDrawing(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserDrawSave, {
        correlationId: globalThis.crypto.randomUUID(),
        input: previewDrawSaveInputSchema.parse(input),
      });
      return unwrap(browserScreenshotIpcResponseSchema.parse(response));
    },
    async menu(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserMenu, {
        correlationId: globalThis.crypto.randomUUID(),
        input: browserMenuInputSchema.parse(input),
      });
      return unwrap(browserMenuIpcResponseSchema.parse(response));
    },
    onMenuPayload(listener) {
      const handler = (_event: unknown, payload: unknown): void => {
        const parsed = browserMenuPayloadSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.browserMenuPayload, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.browserMenuPayload, handler);
      };
    },
    pickMenu(choice) {
      // The window can be torn down between the click and the reply; a
      // rejected invoke here must not surface as an unhandled rejection.
      void ipcRenderer
        .invoke(ipcChannels.browserMenuPick, browserMenuPickSchema.parse({ choice }))
        .catch(() => undefined);
    },
    async settings() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserSettings, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(browserSettingsIpcResponseSchema.parse(response));
    },
    async updateSettings(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.browserSettingsUpdate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: browserSettingsUpdateInputSchema.parse(input),
        },
      );
      return unwrap(browserSettingsIpcResponseSchema.parse(response));
    },
    async createProfile(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.browserProfileCreate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: browserProfileCreateInputSchema.parse(input),
        },
      );
      return unwrap(browserSettingsIpcResponseSchema.parse(response));
    },
    async deleteProfile(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.browserProfileDelete,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: browserProfileDeleteInputSchema.parse(input),
        },
      );
      return unwrap(browserSettingsIpcResponseSchema.parse(response));
    },
    async importCookies(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.browserCookieImport,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: browserProfileDeleteInputSchema.parse(input),
        },
      );
      return unwrap(browserCookieImportIpcResponseSchema.parse(response));
    },
    async sendPick(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserPickSend, {
        correlationId: globalThis.crypto.randomUUID(),
        input,
      });
      return unwrap(browserPickSendIpcResponseSchema.parse(response));
    },
    async receipts() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.browserReceipts, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(browserReceiptsIpcResponseSchema.parse(response));
    },
    onState(listener) {
      const handler = (_event: unknown, payload: unknown): void => {
        const parsed = browserStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.browserStateEvent, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.browserStateEvent, handler);
      };
    },
  },
  desktop: {
    async screenshot() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.desktopScreenshot, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(desktopScreenshotIpcResponseSchema.parse(response));
    },
    async act(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.desktopAct, {
        correlationId: globalThis.crypto.randomUUID(),
        input: desktopActInputSchema.parse(input),
      });
      return unwrap(desktopActIpcResponseSchema.parse(response));
    },
    async approve(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.desktopApprove, {
        correlationId: globalThis.crypto.randomUUID(),
        input,
      });
      return unwrap(desktopActIpcResponseSchema.parse(response));
    },
  },
  editor: {
    async pick() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorPick, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(editorPickIpcResponseSchema.parse(response));
    },
    async read(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorRead, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorReadInputSchema.parse(input),
      });
      return unwrap(editorReadIpcResponseSchema.parse(response));
    },
    async list(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorListInputSchema.parse(input),
      });
      return unwrap(editorListIpcResponseSchema.parse(response));
    },
    async git(root, base = null) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorGit, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorGitInputSchema.parse({ root, base }),
      });
      return unwrap(editorGitIpcResponseSchema.parse(response));
    },
    async gitCommitFiles(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.editorGitCommitFiles,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: editorGitCommitFilesInputSchema.parse(input),
        },
      );
      return unwrap(editorGitCommitFilesIpcResponseSchema.parse(response));
    },
    async write(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorWrite, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorWriteInputSchema.parse(input),
      });
      return unwrap(editorWriteIpcResponseSchema.parse(response));
    },
    async create(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorCreate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorCreateInputSchema.parse(input),
      });
      return unwrap(editorCreateIpcResponseSchema.parse(response));
    },
    async search(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorSearch, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorSearchInputSchema.parse(input),
      });
      return unwrap(editorSearchIpcResponseSchema.parse(response));
    },
    async gitStage(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorGitStage, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorGitStageInputSchema.parse(input),
      });
      return unwrap(editorGitStageIpcResponseSchema.parse(response));
    },
    async gitCommit(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorGitCommit, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorGitCommitInputSchema.parse(input),
      });
      return unwrap(editorGitCommitIpcResponseSchema.parse(response));
    },
  },
  review: {
    async diff(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewDiff, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewDiffInputSchema.parse(input),
      });
      return unwrap(reviewDiffIpcResponseSchema.parse(response));
    },
    async comment(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.reviewCommentCreate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: reviewCommentCreateInputSchema.parse(input),
        },
      );
      return unwrap(reviewCommentCreateIpcResponseSchema.parse(response));
    },
    async comments(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewCommentList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewCommentListInputSchema.parse(input),
      });
      return unwrap(reviewCommentListIpcResponseSchema.parse(response));
    },
    async check(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewCheckRun, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewCheckRunInputSchema.parse(input),
      });
      return unwrap(reviewCheckRunIpcResponseSchema.parse(response));
    },
    async checks(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewCheckList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewCheckListInputSchema.parse(input),
      });
      return unwrap(reviewCheckListIpcResponseSchema.parse(response));
    },
    async prDraft(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewPrDraft, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewPrDraftInputSchema.parse(input),
      });
      return unwrap(reviewPrDraftIpcResponseSchema.parse(response));
    },
    async ci(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewCi, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewCiInputSchema.parse(input),
      });
      return unwrap(reviewCiIpcResponseSchema.parse(response));
    },
    async inspectLand(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.reviewLandInspect, {
        correlationId: globalThis.crypto.randomUUID(),
        input: reviewLandInspectInputSchema.parse(input),
      });
      return unwrap(reviewLandInspectIpcResponseSchema.parse(response));
    },
  },
  voice: {
    async status() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceStatus, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(voiceStatusIpcResponseSchema.parse(response));
    },
    async updateSettings(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.voiceSettingsUpdate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: voiceSettingsUpdateInputSchema.parse(input),
        },
      );
      return unwrap(voiceStatusIpcResponseSchema.parse(response));
    },
    async saveOpenAiKey(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceKeySave, {
        correlationId: globalThis.crypto.randomUUID(),
        input: voiceKeySaveInputSchema.parse(input),
      });
      return unwrap(voiceStatusIpcResponseSchema.parse(response));
    },
    async deleteOpenAiKey() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceKeyDelete, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(voiceKeyDeleteIpcResponseSchema.parse(response));
    },
    async downloadModel(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceModelDownload, {
        correlationId: globalThis.crypto.randomUUID(),
        input: voiceModelIdInputSchema.parse(input),
      });
      return unwrap(voiceStatusIpcResponseSchema.parse(response));
    },
    async cancelDownload(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceModelCancel, {
        correlationId: globalThis.crypto.randomUUID(),
        input: voiceModelIdInputSchema.parse(input),
      });
      return unwrap(voiceStatusIpcResponseSchema.parse(response));
    },
    async deleteModel(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceModelDelete, {
        correlationId: globalThis.crypto.randomUUID(),
        input: voiceModelIdInputSchema.parse(input),
      });
      return unwrap(voiceStatusIpcResponseSchema.parse(response));
    },
    onModelEvent(listener) {
      const subscription = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ): void => {
        const parsed = voiceModelEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.voiceModelEvent, subscription);
      return () => ipcRenderer.removeListener(ipcChannels.voiceModelEvent, subscription);
    },
    async transcribe(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.voiceTranscribe, {
        correlationId: globalThis.crypto.randomUUID(),
        input: voiceTranscribeInputSchema.parse(input),
      });
      return unwrap(voiceTranscribeIpcResponseSchema.parse(response));
    },
    onHotkey(listener) {
      const subscription = (
        _event: Electron.IpcRendererEvent,
        payload: unknown,
      ): void => {
        const parsed = voiceHotkeyEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.voiceHotkey, subscription);
      return () => ipcRenderer.removeListener(ipcChannels.voiceHotkey, subscription);
    },
  },
  accounts: {
    async snapshot(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.accountSnapshot, {
        correlationId: globalThis.crypto.randomUUID(),
        input: input?.live === true ? { live: true } : {},
      });
      return unwrap(accountSnapshotIpcResponseSchema.parse(response));
    },
    async add(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.accountAdd, {
        correlationId: globalThis.crypto.randomUUID(),
        input: accountAddInputSchema.parse(input),
      });
      return unwrap(accountSnapshotIpcResponseSchema.parse(response));
    },
    async openLoginTerminal(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.accountLoginTerminal,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: accountLoginTerminalInputSchema.parse(input),
        },
      );
      return response as { readonly opened: true };
    },
    async confirmLogin(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.accountConfirmLogin,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: accountConfirmLoginInputSchema.parse(input),
        },
      );
      return unwrap(accountSnapshotIpcResponseSchema.parse(response));
    },
    async remove(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.accountRemove, {
        correlationId: globalThis.crypto.randomUUID(),
        input: accountRemoveInputSchema.parse(input),
      });
      return unwrap(accountSnapshotIpcResponseSchema.parse(response));
    },
    async setActive(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.accountSetActive, {
        correlationId: globalThis.crypto.randomUUID(),
        input: accountSetActiveInputSchema.parse(input),
      });
      return unwrap(accountSnapshotIpcResponseSchema.parse(response));
    },
    async toggleHook(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.accountToggleHook, {
        correlationId: globalThis.crypto.randomUUID(),
        input: accountToggleHookInputSchema.parse(input),
      });
      return unwrap(accountSnapshotIpcResponseSchema.parse(response));
    },
  },
  noSleep: {
    async read() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.noSleepRead, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(noSleepIpcResponseSchema.parse(response));
    },
    async set(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.noSleepSet, {
        correlationId: globalThis.crypto.randomUUID(),
        input: noSleepSetInputSchema.parse(input),
      });
      return unwrap(noSleepIpcResponseSchema.parse(response));
    },
    onChange(listener) {
      const handler = (_event: unknown, payload: unknown): void => {
        const parsed = noSleepStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.noSleepEvent, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.noSleepEvent, handler);
      };
    },
  },
  auth: {
    async read() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.authRead, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(authIpcResponseSchema.parse(response));
    },
    async begin() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.authBegin, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(authIpcResponseSchema.parse(response));
    },
    async cancel() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.authCancel, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(authIpcResponseSchema.parse(response));
    },
    async signOut() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.authSignOut, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(authIpcResponseSchema.parse(response));
    },
    async openAccount() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.authOpenAccount, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(authIpcResponseSchema.parse(response));
    },
    onChange(listener) {
      const handler = (_event: unknown, payload: unknown): void => {
        const parsed = authStateSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.authEvent, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.authEvent, handler);
      };
    },
  },
  runtimes: {
    async capabilities() {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.runtimeCapabilities,
        { correlationId: globalThis.crypto.randomUUID() },
      );
      return unwrap(runtimeCapabilitiesIpcResponseSchema.parse(response));
    },
  },
  agents: {
    async candidates() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentCandidates, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(agentCandidatesIpcResponseSchema.parse(response));
    },
    async configure(agent) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentConfigure, {
        correlationId: globalThis.crypto.randomUUID(),
        agent,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async forget(agentId) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentForget, {
        correlationId: globalThis.crypto.randomUUID(),
        agentId,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async profiles() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentProfileList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(agentProfileListIpcResponseSchema.parse(response));
    },
    async profileUpsert(profile) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentProfileUpsert, {
        correlationId: globalThis.crypto.randomUUID(),
        profile,
      });
      return unwrap(agentProfileIpcResponseSchema.parse(response));
    },
    async profileDelete(profileId) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentProfileDelete, {
        correlationId: globalThis.crypto.randomUUID(),
        profileId,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async start(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentSessionStart, {
        correlationId: globalThis.crypto.randomUUID(),
        agentId: input.agentId,
        cwd: input.cwd,
        threadId: input.threadId,
        resumeSessionId: input.resumeSessionId,
        profileId: input.profileId ?? null,
      });
      return unwrap(agentSessionIpcResponseSchema.parse(response));
    },
    async sessions() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentSessionList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(agentSessionListIpcResponseSchema.parse(response));
    },
    async threads() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentThreadList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(agentThreadListIpcResponseSchema.parse(response));
    },
    async transcript(threadId) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentThreadGet, {
        correlationId: globalThis.crypto.randomUUID(),
        threadId,
      });
      return unwrap(agentTranscriptIpcResponseSchema.parse(response));
    },
    async close(sessionId) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentSessionClose, {
        correlationId: globalThis.crypto.randomUUID(),
        sessionId,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async prompt(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentPrompt, {
        correlationId: globalThis.crypto.randomUUID(),
        sessionId: input.sessionId,
        content: input.content,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async cancel(sessionId) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentCancel, {
        correlationId: globalThis.crypto.randomUUID(),
        sessionId,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async setConfigOption(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentSetConfig, {
        correlationId: globalThis.crypto.randomUUID(),
        sessionId: input.sessionId,
        configId: input.configId,
        value: input.value,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async respondPermission(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.agentRespondPermission,
        {
          correlationId: globalThis.crypto.randomUUID(),
          sessionId: input.sessionId,
          response: {
            requestId: input.requestId,
            decision: input.decision,
            optionId: null,
          },
        },
      );
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    async applyDiff(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.agentDiff, {
        correlationId: globalThis.crypto.randomUUID(),
        sessionId: input.sessionId,
        path: input.path,
        action: input.action,
      });
      return unwrap(agentVoidIpcResponseSchema.parse(response));
    },
    onEvent(listener) {
      const handler = (_event: unknown, payload: unknown): void => {
        // Dropping an unparseable event is deliberate: the union grows as ACP
        // does, and a renderer that throws on an unknown variant would break on
        // an agent upgrade.
        const parsed = agentSessionEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(ipcChannels.agentEvent, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.agentEvent, handler);
      };
    },
  },
};
contextBridge.exposeInMainWorld('builderHelm', api);

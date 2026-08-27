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
} from '@zero/protocol/actions';
import {
  boardAddPaneInputSchema,
  boardAddPaneIpcResponseSchema,
  boardCreateInputSchema,
  boardCreateIpcResponseSchema,
  boardDetectAgentsIpcResponseSchema,
  boardPaneCloseInputSchema,
  boardPaneCloseIpcResponseSchema,
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
} from '@zero/protocol/board';
import {
  swarmAddSeatIpcResponseSchema,
  swarmAddSeatRequestSchema,
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
} from '@zero/protocol/swarm';
import {
  kanbanCreateInputSchema,
  kanbanCreateIpcResponseSchema,
  kanbanDeleteInputSchema,
  kanbanDeleteIpcResponseSchema,
  kanbanListInputSchema,
  kanbanListIpcResponseSchema,
  kanbanMoveInputSchema,
  kanbanMoveIpcResponseSchema,
  kanbanProjectCreateInputSchema,
  kanbanProjectCreateIpcResponseSchema,
  kanbanProjectListInputSchema,
  kanbanProjectListIpcResponseSchema,
  kanbanUpdateInputSchema,
  kanbanUpdateIpcResponseSchema,
} from '@zero/protocol/kanban';
import {
  ipcChannels,
  systemHealthResponseSchema,
  type ZeroDesktopApi,
} from '@zero/protocol/ipc';
import {
  browserCommandIpcResponseSchema,
  browserCommandInputSchema,
} from '@zero/protocol/browser';
import {
  editorCreateInputSchema,
  editorCreateIpcResponseSchema,
  editorGitCommitInputSchema,
  editorGitCommitIpcResponseSchema,
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
} from '@zero/protocol/editor';
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
} from '@zero/protocol/providers';
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
} from '@zero/protocol/chat';
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
} from '@zero/protocol/knowledge';
import {
  projectDashboardIpcResponseSchema,
  projectRepositoryRefreshInputSchema,
  projectRepositoryRefreshIpcResponseSchema,
  projectRepositorySelectInputSchema,
  projectRepositorySelectIpcResponseSchema,
} from '@zero/protocol/projects';
import { contextBridge, ipcRenderer } from 'electron';

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

const api: ZeroDesktopApi = {
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
    async addSeat(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.swarmAddSeat,
        swarmAddSeatRequestSchema.parse(input),
      );
      return unwrap(swarmAddSeatIpcResponseSchema.parse(response));
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
    async git(root) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.editorGit, {
        correlationId: globalThis.crypto.randomUUID(),
        input: editorGitInputSchema.parse({ root }),
      });
      return unwrap(editorGitIpcResponseSchema.parse(response));
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
  helm: {
    async listAgents() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'listAgents',
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as ZeroDesktopApi['helm'] extends {
        listAgents: () => Promise<infer T>;
      }
        ? T
        : never;
    },
    async createAgent(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'createAgent',
        payload: input,
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as Awaited<ReturnType<ZeroDesktopApi['helm']['createAgent']>>;
    },
    async listRoutines() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'listRoutines',
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as Awaited<ReturnType<ZeroDesktopApi['helm']['listRoutines']>>;
    },
    async createRoutine(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'createRoutine',
        payload: input,
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as Awaited<ReturnType<ZeroDesktopApi['helm']['createRoutine']>>;
    },
    async listPlugins() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'listPlugins',
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as Awaited<ReturnType<ZeroDesktopApi['helm']['listPlugins']>>;
    },
    async connectPlugin(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'connectPlugin',
        payload: input,
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as Awaited<ReturnType<ZeroDesktopApi['helm']['connectPlugin']>>;
    },
    async listTasks() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.helm, {
        action: 'listTasks',
      });
      const parsed = response as {
        ok: boolean;
        value?: unknown;
        error?: { message: string };
      };
      if (!parsed.ok) throw new Error(parsed.error?.message ?? 'helm failed');
      return parsed.value as Awaited<ReturnType<ZeroDesktopApi['helm']['listTasks']>>;
    },
  },
};

contextBridge.exposeInMainWorld('zero', api);

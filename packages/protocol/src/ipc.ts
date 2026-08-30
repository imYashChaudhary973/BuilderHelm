import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import type {
  BoardAddPaneInput,
  BoardAgentDetection,
  BoardCreateInput,
  BoardLandInput,
  BoardLandPreview,
  BoardLandResult,
  BoardPaneCloseInput,
  BoardPaneAckInput,
  BoardPaneDrainInput,
  BoardPaneDrainResult,
  BoardPaneEventEnvelope,
  BoardPaneResizeInput,
  BoardPaneSummary,
  BoardPaneWriteInput,
  BoardPresetDeleteInput,
  BoardPresetRecord,
  BoardPresetSaveInput,
  BoardSessionSummary,
} from './board.js';
import type {
  SwarmCreateInput,
  SwarmDirectInput,
  SwarmRunRecord,
  SwarmState,
} from './swarm.js';
import type {
  KanbanCard,
  KanbanCreateInput,
  KanbanDeleteInput,
  KanbanListInput,
  KanbanMoveInput,
  KanbanProject,
  KanbanProjectCreateInput,
  KanbanProjectListInput,
  KanbanUpdateInput,
} from './kanban.js';

import type {
  BrowserCommandInput,
  BrowserState,
  PreviewArtifact,
  PreviewArtifactListInput,
  PreviewDriveInput,
  PreviewDriveResult,
  PreviewEvent,
  PreviewOrigin,
  PreviewPick,
  PreviewDriveReceipt,
  DesktopActInput,
  DesktopActResult,
  PreviewScreenshotInput,
  PreviewSnapshot,
} from './browser.js';
import type {
  EditorCreateInput,
  EditorEntry,
  EditorFile,
  EditorGit,
  EditorGitCommitInput,
  EditorGitStageInput,
  EditorListInput,
  EditorReadInput,
  EditorSearchInput,
  EditorWriteInput,
} from './editor.js';
import type {
  ActionCommandInput,
  ActionCommandOutcome,
  ActionSnapshot,
  ActionSnapshotInput,
  ApprovalRequest,
  ApprovalResolveInput,
  PermissionPolicy,
  PermissionPolicyUpdateInput,
} from './actions.js';
import type {
  CreateProviderInput,
  DeleteProviderInput,
  ModelListInput,
  ModelCapabilityOverrideListInput,
  ModelCapabilityOverrideUpdateInput,
  ProviderConnectionResult,
  ProviderOperationInput,
  ProviderSummary,
  UpdateProviderInput,
} from './providers.js';
import type { ModelCapabilityOverrideRecord, ModelRecord } from './model.js';
import type {
  KnowledgeAnswer,
  KnowledgeQueryInput,
  KnowledgeSourceInput,
  KnowledgeSourceView,
  KnowledgeVault,
  KnowledgeVaultListInput,
  KnowledgeVaultSyncInput,
} from './knowledge.js';
import type {
  ChatClientStreamEvent,
  ChatStreamInput,
  ChatThread,
  ChatTranscript,
  CreateChatThreadInput,
} from './chat.js';
import type {
  ProjectDashboard,
  ProjectDashboardSnapshot,
  ProjectRepositoryRefreshInput,
  ProjectRepositorySelectInput,
} from './projects.js';
import type {
  VoiceHotkeyEvent,
  VoiceKeySaveInput,
  VoiceModelEvent,
  VoiceModelIdInput,
  VoiceSettingsUpdateInput,
  VoiceStatus,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from './voice.js';

export const ipcChannels = {
  systemHealth: 'builderhelm:system:health',
  providerList: 'builderhelm:provider:list',
  providerCreate: 'builderhelm:provider:create',
  providerUpdate: 'builderhelm:provider:update',
  providerDelete: 'builderhelm:provider:delete',
  providerTestConnection: 'builderhelm:provider:test-connection',
  modelDiscover: 'builderhelm:model:discover',
  modelList: 'builderhelm:model:list',
  modelCapabilityOverrideList: 'builderhelm:model-capability-override:list',
  modelCapabilityOverrideUpdate: 'builderhelm:model-capability-override:update',
  knowledgeVaultList: 'builderhelm:knowledge:vault-list',
  knowledgeVaultSelect: 'builderhelm:knowledge:vault-select',
  knowledgeVaultSync: 'builderhelm:knowledge:vault-sync',
  knowledgeQuery: 'builderhelm:knowledge:query',
  knowledgeSourceGet: 'builderhelm:knowledge:source-get',
  actionSnapshot: 'builderhelm:action:snapshot',
  actionCommand: 'builderhelm:action:command',
  actionApprove: 'builderhelm:action:approve',
  actionReject: 'builderhelm:action:reject',
  actionPolicyUpdate: 'builderhelm:action:policy-update',
  projectDashboard: 'builderhelm:project:dashboard',
  projectRepositorySelect: 'builderhelm:project:repository-select',
  projectRepositoryRefresh: 'builderhelm:project:repository-refresh',
  chatList: 'builderhelm:chat:list',
  chatCreate: 'builderhelm:chat:create',
  chatGet: 'builderhelm:chat:get',
  chatStreamStart: 'builderhelm:chat:stream-start',
  chatStreamCancel: 'builderhelm:chat:stream-cancel',
  chatStreamEvent: 'builderhelm:chat:stream-event',
  boardCreate: 'builderhelm:board:create',
  boardEvent: 'builderhelm:board:event',
  boardWrite: 'builderhelm:board:write',
  boardResize: 'builderhelm:board:resize',
  boardPaneClose: 'builderhelm:board:pane-close',
  boardPaneAdd: 'builderhelm:board:pane-add',
  boardPaneDrain: 'builderhelm:board:pane-drain',
  boardPaneAck: 'builderhelm:board:pane-ack',
  boardHomeDir: 'builderhelm:board:home-dir',
  boardSelectFolder: 'builderhelm:board:select-folder',
  boardDetectAgents: 'builderhelm:board:detect-agents',
  boardPresetList: 'builderhelm:board:preset-list',
  boardPresetSave: 'builderhelm:board:preset-save',
  boardPresetDelete: 'builderhelm:board:preset-delete',
  boardLand: 'builderhelm:board:land',
  boardLandPreview: 'builderhelm:board:land-preview',
  swarmCreate: 'builderhelm:swarm:create',
  swarmState: 'builderhelm:swarm:state',
  swarmDirect: 'builderhelm:swarm:direct',
  swarmTaskUpdate: 'builderhelm:swarm:task-update',
  swarmStop: 'builderhelm:swarm:stop',
  swarmStopSeat: 'builderhelm:swarm:stop-seat',
  swarmLatest: 'builderhelm:swarm:latest',
  swarmEvent: 'builderhelm:swarm:event',
  kanbanProjectList: 'builderhelm:kanban:project-list',
  kanbanProjectCreate: 'builderhelm:kanban:project-create',
  kanbanList: 'builderhelm:kanban:list',
  kanbanCreate: 'builderhelm:kanban:create',
  kanbanMove: 'builderhelm:kanban:move',
  kanbanUpdate: 'builderhelm:kanban:update',
  kanbanDelete: 'builderhelm:kanban:delete',
  browserCommand: 'builderhelm:browser:command',
  browserOrigins: 'builderhelm:browser:origins',
  browserSnapshot: 'builderhelm:browser:snapshot',
  browserScreenshot: 'builderhelm:browser:screenshot',
  browserArtifacts: 'builderhelm:browser:artifacts',
  browserDrive: 'builderhelm:browser:drive',
  browserApprove: 'builderhelm:browser:approve',
  browserEvents: 'builderhelm:browser:events',
  browserPick: 'builderhelm:browser:pick',
  browserPickSend: 'builderhelm:browser:pick-send',
  browserReceipts: 'builderhelm:browser:receipts',
  desktopScreenshot: 'builderhelm:desktop:screenshot',
  desktopAct: 'builderhelm:desktop:act',
  desktopApprove: 'builderhelm:desktop:approve',
  editorPick: 'builderhelm:editor:pick',
  editorRead: 'builderhelm:editor:read',
  editorList: 'builderhelm:editor:list',
  editorGit: 'builderhelm:editor:git',
  editorWrite: 'builderhelm:editor:write',
  editorCreate: 'builderhelm:editor:create',
  editorSearch: 'builderhelm:editor:search',
  editorGitStage: 'builderhelm:editor:git-stage',
  editorGitCommit: 'builderhelm:editor:git-commit',
  voiceStatus: 'builderhelm:voice:status',
  voiceSettingsUpdate: 'builderhelm:voice:settings-update',
  voiceKeySave: 'builderhelm:voice:key-save',
  voiceKeyDelete: 'builderhelm:voice:key-delete',
  voiceModelDownload: 'builderhelm:voice:model-download',
  voiceModelCancel: 'builderhelm:voice:model-cancel',
  voiceModelDelete: 'builderhelm:voice:model-delete',
  voiceModelEvent: 'builderhelm:voice:model-event',
  voiceTranscribe: 'builderhelm:voice:transcribe',
  voiceHotkey: 'builderhelm:voice:hotkey',
} as const;

export const systemHealthRequestSchema = z
  .object({
    correlationId: z
      .string()
      .uuid()
      .transform((value) => value as CorrelationId),
  })
  .strict();

export const systemHealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    database: z.literal('ready'),
    occurredAt: z.string().datetime({ offset: false }),
    correlationId: z
      .string()
      .uuid()
      .transform((value) => value as CorrelationId),
  })
  .strict();

export type SystemHealthRequest = z.infer<typeof systemHealthRequestSchema>;
export type SystemHealthResponse = z.infer<typeof systemHealthResponseSchema>;

export interface BuilderHelmDesktopApi {
  readonly system: {
    health(): Promise<SystemHealthResponse>;
  };
  readonly providers: {
    list(): Promise<ProviderSummary[]>;
    create(input: CreateProviderInput): Promise<ProviderSummary>;
    update(input: UpdateProviderInput): Promise<ProviderSummary>;
    delete(input: DeleteProviderInput): Promise<{ deleted: true }>;
    testConnection(input: ProviderOperationInput): Promise<ProviderConnectionResult>;
  };
  readonly models: {
    discover(input: ProviderOperationInput): Promise<ModelRecord[]>;
    list(input: ModelListInput): Promise<ModelRecord[]>;
    listCapabilityOverrides(
      input: ModelCapabilityOverrideListInput,
    ): Promise<ModelCapabilityOverrideRecord[]>;
    updateCapabilityOverride(
      input: ModelCapabilityOverrideUpdateInput,
    ): Promise<ModelRecord>;
  };
  readonly chat: {
    list(): Promise<ChatThread[]>;
    create(input: CreateChatThreadInput): Promise<ChatThread>;
    get(input: { readonly threadId: string }): Promise<ChatTranscript>;
    startStream(
      input: ChatStreamInput,
      onEvent: (event: ChatClientStreamEvent) => void,
    ): Promise<{ readonly runId: string }>;
    cancelStream(input: {
      readonly runId: string;
    }): Promise<{ readonly cancelled: boolean }>;
  };
  readonly knowledge: {
    listVaults(input: KnowledgeVaultListInput): Promise<KnowledgeVault[]>;
    selectVault(): Promise<KnowledgeVault | null>;
    syncVault(input: KnowledgeVaultSyncInput): Promise<KnowledgeVault>;
    answer(input: KnowledgeQueryInput): Promise<KnowledgeAnswer>;
    getSource(input: KnowledgeSourceInput): Promise<KnowledgeSourceView>;
  };
  readonly actions: {
    snapshot(input: ActionSnapshotInput): Promise<ActionSnapshot>;
    command(input: ActionCommandInput): Promise<ActionCommandOutcome>;
    approve(input: ApprovalResolveInput): Promise<ActionCommandOutcome>;
    reject(input: ApprovalResolveInput): Promise<ApprovalRequest>;
    updatePolicy(input: PermissionPolicyUpdateInput): Promise<PermissionPolicy>;
  };
  readonly swarm: {
    create(input: {
      readonly correlationId: CorrelationId;
      readonly input: SwarmCreateInput;
    }): Promise<SwarmRunRecord>;
    state(input: {
      readonly correlationId: CorrelationId;
      readonly runId: string;
    }): Promise<SwarmState>;
    direct(input: {
      readonly correlationId: CorrelationId;
      readonly input: SwarmDirectInput;
    }): Promise<{ queued: true }>;
    stop(input: {
      readonly correlationId: CorrelationId;
      readonly runId: string;
    }): Promise<{ stopped: true }>;
    stopSeat(input: {
      readonly correlationId: CorrelationId;
      readonly runId: string;
      readonly seatId: string;
    }): Promise<{ stopped: true }>;
    latest(input: {
      readonly correlationId: CorrelationId;
    }): Promise<SwarmRunRecord | null>;
    /** Push: a run's ledger changed; refetch its state. */
    onEvent(listener: (runId: string) => void): () => void;
  };
  readonly board: {
    homeDir(): Promise<string>;
    createSession(input: BoardCreateInput): Promise<BoardSessionSummary>;
    write(input: BoardPaneWriteInput): Promise<{ readonly written: true }>;
    resize(input: BoardPaneResizeInput): Promise<{ readonly resized: true }>;
    closePane(input: BoardPaneCloseInput): Promise<{ readonly closed: true }>;
    addPane(input: BoardAddPaneInput): Promise<BoardPaneSummary>;
    drainPane(input: BoardPaneDrainInput): Promise<BoardPaneDrainResult>;
    ackPane(input: BoardPaneAckInput): Promise<{ readonly acked: true }>;
    selectFolder(): Promise<string | null>;
    detectAgents(): Promise<BoardAgentDetection[]>;
    listPresets(): Promise<BoardPresetRecord[]>;
    savePreset(input: BoardPresetSaveInput): Promise<BoardPresetRecord>;
    deletePreset(input: BoardPresetDeleteInput): Promise<{ readonly deleted: true }>;
    land(input: BoardLandInput): Promise<BoardLandResult>;
    previewLand(input: BoardLandInput): Promise<BoardLandPreview>;
    listProjects(input: KanbanProjectListInput): Promise<KanbanProject[]>;
    createProject(input: KanbanProjectCreateInput): Promise<KanbanProject>;
    listCards(input: KanbanListInput): Promise<KanbanCard[]>;
    createCard(input: KanbanCreateInput): Promise<KanbanCard>;
    moveCard(input: KanbanMoveInput): Promise<KanbanCard>;
    updateCard(input: KanbanUpdateInput): Promise<KanbanCard>;
    deleteCard(input: KanbanDeleteInput): Promise<{ readonly deleted: true }>;
    onPaneEvent(
      sessionId: string,
      listener: (event: BoardPaneEventEnvelope) => void,
    ): () => void;
  };
  readonly projects: {
    dashboard(): Promise<ProjectDashboardSnapshot>;
    selectRepository(
      input: ProjectRepositorySelectInput,
    ): Promise<ProjectDashboard | null>;
    refreshRepository(input: ProjectRepositoryRefreshInput): Promise<ProjectDashboard>;
  };
  readonly browser: {
    command(input: BrowserCommandInput): Promise<BrowserState>;
    origins(): Promise<PreviewOrigin[]>;
    snapshot(input: PreviewScreenshotInput): Promise<PreviewSnapshot>;
    screenshot(input: PreviewScreenshotInput): Promise<PreviewArtifact>;
    artifacts(input: PreviewArtifactListInput): Promise<PreviewArtifact[]>;
    drive(input: PreviewDriveInput): Promise<PreviewDriveResult>;
    approve(input: {
      readonly id: string;
      readonly allow: boolean;
    }): Promise<PreviewDriveResult>;
    events(): Promise<PreviewEvent[]>;
    pick(): Promise<PreviewPick>;
    sendPick(input: { readonly note: string }): Promise<{ readonly sent: boolean }>;
    receipts(): Promise<PreviewDriveReceipt[]>;
  };
  readonly desktop: {
    screenshot(): Promise<{ readonly pngBase64: string }>;
    act(input: DesktopActInput): Promise<DesktopActResult>;
    approve(input: {
      readonly id: string;
      readonly allow: boolean;
    }): Promise<DesktopActResult>;
  };
  readonly editor: {
    pick(): Promise<EditorFile | null>;
    read(input: EditorReadInput): Promise<EditorFile>;
    list(input: EditorListInput): Promise<EditorEntry[]>;
    git(root: string): Promise<EditorGit | null>;
    write(input: EditorWriteInput): Promise<EditorFile>;
    create(input: EditorCreateInput): Promise<EditorEntry>;
    search(input: EditorSearchInput): Promise<EditorEntry[]>;
    gitStage(input: EditorGitStageInput): Promise<EditorGit>;
    gitCommit(input: EditorGitCommitInput): Promise<EditorGit>;
  };
  readonly voice: {
    status(): Promise<VoiceStatus>;
    updateSettings(input: VoiceSettingsUpdateInput): Promise<VoiceStatus>;
    saveOpenAiKey(input: VoiceKeySaveInput): Promise<VoiceStatus>;
    deleteOpenAiKey(): Promise<VoiceStatus>;
    downloadModel(input: VoiceModelIdInput): Promise<VoiceStatus>;
    cancelDownload(input: VoiceModelIdInput): Promise<VoiceStatus>;
    deleteModel(input: VoiceModelIdInput): Promise<VoiceStatus>;
    transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult>;
    onModelEvent(listener: (event: VoiceModelEvent) => void): () => void;
    onHotkey(listener: (event: VoiceHotkeyEvent) => void): () => void;
  };
}

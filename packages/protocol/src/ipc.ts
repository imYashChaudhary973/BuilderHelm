import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import type {
  BoardAddPaneInput,
  BoardAgentDetection,
  BoardCreateInput,
  BoardLandInput,
  BoardLandPreview,
  BoardLandResult,
  BoardPaneCloseInput,
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

import type { BrowserCommandInput, BrowserState } from './browser.js';
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

export const ipcChannels = {
  systemHealth: 'zero:system:health',
  providerList: 'zero:provider:list',
  providerCreate: 'zero:provider:create',
  providerUpdate: 'zero:provider:update',
  providerDelete: 'zero:provider:delete',
  providerTestConnection: 'zero:provider:test-connection',
  modelDiscover: 'zero:model:discover',
  modelList: 'zero:model:list',
  modelCapabilityOverrideList: 'zero:model-capability-override:list',
  modelCapabilityOverrideUpdate: 'zero:model-capability-override:update',
  knowledgeVaultList: 'zero:knowledge:vault-list',
  knowledgeVaultSelect: 'zero:knowledge:vault-select',
  knowledgeVaultSync: 'zero:knowledge:vault-sync',
  knowledgeQuery: 'zero:knowledge:query',
  knowledgeSourceGet: 'zero:knowledge:source-get',
  actionSnapshot: 'zero:action:snapshot',
  actionCommand: 'zero:action:command',
  actionApprove: 'zero:action:approve',
  actionReject: 'zero:action:reject',
  actionPolicyUpdate: 'zero:action:policy-update',
  projectDashboard: 'zero:project:dashboard',
  projectRepositorySelect: 'zero:project:repository-select',
  projectRepositoryRefresh: 'zero:project:repository-refresh',
  chatList: 'zero:chat:list',
  chatCreate: 'zero:chat:create',
  chatGet: 'zero:chat:get',
  chatStreamStart: 'zero:chat:stream-start',
  chatStreamCancel: 'zero:chat:stream-cancel',
  chatStreamEvent: 'zero:chat:stream-event',
  boardCreate: 'zero:board:create',
  boardEvent: 'zero:board:event',
  boardWrite: 'zero:board:write',
  boardResize: 'zero:board:resize',
  boardPaneClose: 'zero:board:pane-close',
  boardPaneAdd: 'zero:board:pane-add',
  boardPaneDrain: 'zero:board:pane-drain',
  boardHomeDir: 'zero:board:home-dir',
  boardSelectFolder: 'zero:board:select-folder',
  boardDetectAgents: 'zero:board:detect-agents',
  boardPresetList: 'zero:board:preset-list',
  boardPresetSave: 'zero:board:preset-save',
  boardPresetDelete: 'zero:board:preset-delete',
  boardLand: 'zero:board:land',
  boardLandPreview: 'zero:board:land-preview',
  swarmCreate: 'zero:swarm:create',
  swarmState: 'zero:swarm:state',
  swarmDirect: 'zero:swarm:direct',
  swarmTaskUpdate: 'zero:swarm:task-update',
  swarmStop: 'zero:swarm:stop',
  swarmStopSeat: 'zero:swarm:stop-seat',
  swarmLatest: 'zero:swarm:latest',
  swarmEvent: 'zero:swarm:event',
  kanbanProjectList: 'zero:kanban:project-list',
  kanbanProjectCreate: 'zero:kanban:project-create',
  kanbanList: 'zero:kanban:list',
  kanbanCreate: 'zero:kanban:create',
  kanbanMove: 'zero:kanban:move',
  kanbanUpdate: 'zero:kanban:update',
  kanbanDelete: 'zero:kanban:delete',
  browserCommand: 'zero:browser:command',
  editorPick: 'zero:editor:pick',
  editorRead: 'zero:editor:read',
  editorList: 'zero:editor:list',
  editorGit: 'zero:editor:git',
  editorWrite: 'zero:editor:write',
  editorCreate: 'zero:editor:create',
  editorSearch: 'zero:editor:search',
  editorGitStage: 'zero:editor:git-stage',
  editorGitCommit: 'zero:editor:git-commit',
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

export interface ZeroDesktopApi {
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
}

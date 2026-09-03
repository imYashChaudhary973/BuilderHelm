import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import type {
  AccountAddInput,
  AccountConfirmLoginInput,
  AccountLoginTerminalInput,
  AccountRemoveInput,
  AccountSetActiveInput,
  AccountSnapshot,
  AccountSnapshotInput,
  AccountToggleHookInput,
} from './accounts.js';
import type { NoSleepSetInput, NoSleepState } from './no-sleep.js';
import type { AuthState } from './auth.js';
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
  SwarmLandTaskInput,
  SwarmRunRecord,
  SwarmState,
  SwarmTaskRecord,
} from './swarm.js';
import type {
  KanbanCard,
  KanbanCreateInput,
  KanbanDeleteInput,
  KanbanListInput,
  KanbanLinkRunInput,
  KanbanMoveInput,
  KanbanProject,
  KanbanProjectCreateInput,
  KanbanProjectListInput,
  KanbanUpdateInput,
} from './kanban.js';
import type {
  GitHubIssue,
  GitHubIssueImportInput,
  GitHubIssueListInput,
  GitHubIssueSyncInput,
  GitHubIssueSyncResult,
  LinearIssue,
  LinearIssueImportInput,
  LinearIssueListInput,
  LinearIssueSyncInput,
  LinearIssueSyncResult,
  LinearKeySaveInput,
  LinearStatus,
} from './integrations.js';

import type {
  BrowserCommandInput,
  BrowserCookieImportResult,
  BrowserMenuInput,
  BrowserMenuPayload,
  BrowserMenuResult,
  BrowserProfileCreateInput,
  BrowserProfileDeleteInput,
  BrowserSettings,
  BrowserSettingsUpdateInput,
  BrowserState,
  PreviewAnnotationInput,
  PreviewArtifact,
  PreviewArtifactListInput,
  PreviewDrawSaveInput,
  PreviewDriveInput,
  PreviewDriveResult,
  PreviewEvent,
  PreviewOrigin,
  PreviewPick,
  PreviewPickInput,
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
  EditorGitCommitFile,
  EditorGitCommitFilesInput,
  EditorGitStageInput,
  EditorListInput,
  EditorReadInput,
  EditorSearchInput,
  EditorWriteInput,
} from './editor.js';
import type {
  ReviewCheck,
  ReviewCheckListInput,
  ReviewCheckRunInput,
  ReviewCi,
  ReviewCiInput,
  ReviewComment,
  ReviewCommentCreateInput,
  ReviewCommentListInput,
  ReviewDiffFile,
  ReviewDiffInput,
  ReviewLandInspect,
  ReviewLandInspectInput,
  ReviewPr,
  ReviewPrDraftInput,
} from './review.js';
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
  kanbanLinkRun: 'builderhelm:kanban:link-run',
  githubIssueList: 'builderhelm:integration:github-issue-list',
  githubIssueImport: 'builderhelm:integration:github-issue-import',
  githubIssueSync: 'builderhelm:integration:github-issue-sync',
  linearIssueList: 'builderhelm:integration:linear-issue-list',
  linearIssueImport: 'builderhelm:integration:linear-issue-import',
  linearIssueSync: 'builderhelm:integration:linear-issue-sync',
  linearStatus: 'builderhelm:integration:linear-status',
  linearKeySave: 'builderhelm:integration:linear-key-save',
  linearKeyDelete: 'builderhelm:integration:linear-key-delete',
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
  browserSettings: 'builderhelm:browser:settings',
  browserSettingsUpdate: 'builderhelm:browser:settings-update',
  browserProfileCreate: 'builderhelm:browser:profile-create',
  browserProfileDelete: 'builderhelm:browser:profile-delete',
  browserCookieImport: 'builderhelm:browser:cookie-import',
  browserMenu: 'builderhelm:browser:menu',
  browserMenuPayload: 'builderhelm:browser:menu-payload',
  browserMenuPick: 'builderhelm:browser:menu-pick',
  browserAnnotate: 'builderhelm:browser:annotate',
  browserStateEvent: 'builderhelm:browser:state-event',
  browserDrawSave: 'builderhelm:browser:draw-save',
  desktopScreenshot: 'builderhelm:desktop:screenshot',
  desktopAct: 'builderhelm:desktop:act',
  desktopApprove: 'builderhelm:desktop:approve',
  editorPick: 'builderhelm:editor:pick',
  editorRead: 'builderhelm:editor:read',
  editorList: 'builderhelm:editor:list',
  editorGit: 'builderhelm:editor:git',
  editorGitCommitFiles: 'builderhelm:editor:git-commit-files',
  editorWrite: 'builderhelm:editor:write',
  editorCreate: 'builderhelm:editor:create',
  editorSearch: 'builderhelm:editor:search',
  editorGitStage: 'builderhelm:editor:git-stage',
  editorGitCommit: 'builderhelm:editor:git-commit',
  swarmLandTask: 'builderhelm:swarm:land-task',
  reviewDiff: 'builderhelm:review:diff',
  reviewCommentCreate: 'builderhelm:review:comment-create',
  reviewCommentList: 'builderhelm:review:comment-list',
  reviewCheckRun: 'builderhelm:review:check-run',
  reviewCheckList: 'builderhelm:review:check-list',
  reviewPrDraft: 'builderhelm:review:pr-draft',
  reviewCi: 'builderhelm:review:ci',
  reviewLandInspect: 'builderhelm:review:land-inspect',
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
  accountSnapshot: 'builderhelm:accounts:snapshot',
  accountAdd: 'builderhelm:accounts:add',
  accountConfirmLogin: 'builderhelm:accounts:confirm-login',
  accountLoginTerminal: 'builderhelm:accounts:login-terminal',
  accountRemove: 'builderhelm:accounts:remove',
  accountSetActive: 'builderhelm:accounts:set-active',
  accountToggleHook: 'builderhelm:accounts:toggle-hook',
  noSleepRead: 'builderhelm:no-sleep:read',
  noSleepSet: 'builderhelm:no-sleep:set',
  noSleepEvent: 'builderhelm:no-sleep:event',
  authRead: 'builderhelm:auth:read',
  authBegin: 'builderhelm:auth:begin',
  authCancel: 'builderhelm:auth:cancel',
  authSignOut: 'builderhelm:auth:signOut',
  authOpenAccount: 'builderhelm:auth:openAccount',
  authEvent: 'builderhelm:auth:event',
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
    landTask(input: {
      readonly correlationId: CorrelationId;
      readonly input: SwarmLandTaskInput;
    }): Promise<SwarmTaskRecord>;
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
    linkCardRun(input: KanbanLinkRunInput): Promise<KanbanCard>;
    deleteCard(input: KanbanDeleteInput): Promise<{ readonly deleted: true }>;
    onPaneEvent(
      sessionId: string,
      listener: (event: BoardPaneEventEnvelope) => void,
    ): () => void;
  };
  readonly integrations: {
    listGitHubIssues(input: GitHubIssueListInput): Promise<GitHubIssue[]>;
    importGitHubIssue(input: GitHubIssueImportInput): Promise<KanbanCard>;
    syncGitHubIssue(input: GitHubIssueSyncInput): Promise<GitHubIssueSyncResult>;
    listLinearIssues(input: LinearIssueListInput): Promise<LinearIssue[]>;
    importLinearIssue(input: LinearIssueImportInput): Promise<KanbanCard>;
    syncLinearIssue(input: LinearIssueSyncInput): Promise<LinearIssueSyncResult>;
    linearStatus(): Promise<LinearStatus>;
    saveLinearKey(input: LinearKeySaveInput): Promise<LinearStatus>;
    deleteLinearKey(): Promise<LinearStatus>;
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
    pick(input: PreviewPickInput): Promise<PreviewPick>;
    sendPick(input: { readonly note: string }): Promise<{ readonly sent: boolean }>;
    annotate(input: PreviewAnnotationInput): Promise<PreviewArtifact>;
    saveDrawing(input: PreviewDrawSaveInput): Promise<PreviewArtifact>;
    menu(input: BrowserMenuInput): Promise<BrowserMenuResult>;
    onMenuPayload(listener: (payload: BrowserMenuPayload) => void): () => void;
    pickMenu(choice: string | null): void;
    settings(): Promise<BrowserSettings>;
    updateSettings(input: BrowserSettingsUpdateInput): Promise<BrowserSettings>;
    createProfile(input: BrowserProfileCreateInput): Promise<BrowserSettings>;
    deleteProfile(input: BrowserProfileDeleteInput): Promise<BrowserSettings>;
    importCookies(input: BrowserProfileDeleteInput): Promise<BrowserCookieImportResult>;
    receipts(): Promise<PreviewDriveReceipt[]>;
    onState(listener: (state: BrowserState) => void): () => void;
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
    git(root: string, base?: string | null): Promise<EditorGit | null>;
    gitCommitFiles(input: EditorGitCommitFilesInput): Promise<EditorGitCommitFile[]>;
    write(input: EditorWriteInput): Promise<EditorFile>;
    create(input: EditorCreateInput): Promise<EditorEntry>;
    search(input: EditorSearchInput): Promise<EditorEntry[]>;
    gitStage(input: EditorGitStageInput): Promise<EditorGit>;
    gitCommit(input: EditorGitCommitInput): Promise<EditorGit>;
  };
  readonly review: {
    diff(input: ReviewDiffInput): Promise<ReviewDiffFile[]>;
    comment(input: ReviewCommentCreateInput): Promise<ReviewComment>;
    comments(input: ReviewCommentListInput): Promise<ReviewComment[]>;
    check(input: ReviewCheckRunInput): Promise<ReviewCheck>;
    checks(input: ReviewCheckListInput): Promise<ReviewCheck[]>;
    prDraft(input: ReviewPrDraftInput): Promise<ReviewPr>;
    ci(input: ReviewCiInput): Promise<ReviewCi>;
    inspectLand(input: ReviewLandInspectInput): Promise<ReviewLandInspect>;
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
  readonly accounts: {
    snapshot(input?: AccountSnapshotInput): Promise<AccountSnapshot>;
    add(input: AccountAddInput): Promise<AccountSnapshot>;
    confirmLogin(input: AccountConfirmLoginInput): Promise<AccountSnapshot>;
    openLoginTerminal(
      input: AccountLoginTerminalInput,
    ): Promise<{ readonly opened: true }>;
    remove(input: AccountRemoveInput): Promise<AccountSnapshot>;
    setActive(input: AccountSetActiveInput): Promise<AccountSnapshot>;
    toggleHook(input: AccountToggleHookInput): Promise<AccountSnapshot>;
  };
  readonly noSleep: {
    read(): Promise<NoSleepState>;
    set(input: NoSleepSetInput): Promise<NoSleepState>;
    onChange(listener: (state: NoSleepState) => void): () => void;
  };
  readonly auth: {
    read(): Promise<AuthState>;
    begin(): Promise<AuthState>;
    cancel(): Promise<AuthState>;
    signOut(): Promise<AuthState>;
    openAccount(): Promise<AuthState>;
    onChange(listener: (state: AuthState) => void): () => void;
  };
}

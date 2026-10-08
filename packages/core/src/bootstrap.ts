import {
  ActionRepository,
  backupDatabaseFile,
  ChatRepository,
  KnowledgeRepository,
  migrations,
  ModelRepository,
  openDatabase,
  PreviewArtifactRepository,
  SettingsRepository,
  ProviderRepository,
  ProjectRepositoryStore,
  ReviewRepository,
  runMigrations,
  VoiceRepository,
} from '@builderhelm/db';
import {
  OpenAITranscriptionAdapter,
  type GatewayFetch,
} from '@builderhelm/model-gateway';
import { createLogger, type LogSink, type Logger } from '@builderhelm/observability';
import type { SystemHealthResponse } from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createCorrelationId,
  utcNow,
  type CorrelationId,
} from '@builderhelm/shared';
import { dirname, join } from 'node:path';
import { ProviderService } from './providers/provider-service.js';
import { ChatService } from './chat/chat-service.js';
import { ModelService } from './models/model-service.js';
import { KnowledgeService } from './knowledge/knowledge-service.js';
import { ActionService } from './actions/action-service.js';
import { createWorkToolRegistry, PermissionEngine } from '@builderhelm/tools';
import { ProjectService } from './projects/project-service.js';
import { GitReviewService } from './projects/git-review.js';
import { BoardService } from './board/board-service.js';
import { WorkspaceStore } from './board/workspace-store.js';
import { GitHubIssuesService } from './integrations/github-issues.js';
import { LinearIssuesService } from './integrations/linear-issues.js';
import { PnpmTaskVerifier } from './swarm/pnpm-verifier.js';
import {
  SwarmService,
  type SwarmSeatRunner,
  type SwarmTaskVerifier,
} from './swarm/swarm-service.js';
import type { SwarmReviewer } from './swarm/swarm-reviewer.js';
import type { SecretStore } from './secrets/secret-store.js';
import { PreviewArtifactService } from './preview/preview-artifact-service.js';
import { BrowserSettingsService } from './browser/browser-settings-service.js';
import { NoSleepService } from './no-sleep/no-sleep-service.js';
import { AuthService } from './auth/auth-service.js';
import { VoiceService, type VoiceModelInventory } from './voice/voice-service.js';
import { AccountsService } from './accounts/accounts-service.js';
import { PricingService } from './usage/pricing.js';
import { UsageService } from './usage/usage-service.js';
import { ConnectionService, ownedConfigDir } from './connections/connection-service.js';
import { ScheduleService } from './schedules/schedule-service.js';
import { RemoteSessionService } from './remote/remote-session-service.js';
import {
  buildDiagnostics,
  type DiagnosticBundle,
} from './diagnostics/diagnostics-service.js';

export interface CoreOptions {
  readonly databasePath: string;
  readonly secretStore: SecretStore;
  readonly logSink?: LogSink;
  readonly modelGatewayFetch?: GatewayFetch;
  /** Host adapter that runs swarm seats; without it swarms fail closed. */
  readonly swarmRunner?: SwarmSeatRunner;
  readonly swarmVerifier?: SwarmTaskVerifier;
  readonly swarmReviewer?: SwarmReviewer;
  readonly voiceInventory?: VoiceModelInventory;
  readonly accountsRoot?: string;
}

export interface CoreRuntime {
  readonly logger: Logger;
  readonly chats: ChatService;
  readonly providers: ProviderService;
  readonly models: ModelService;
  readonly knowledge: KnowledgeService;
  readonly actions: ActionService;
  readonly projects: ProjectService;
  readonly board: BoardService;
  readonly workspaces: WorkspaceStore;
  readonly swarm: SwarmService;
  readonly review: GitReviewService;
  readonly githubIssues: GitHubIssuesService;
  readonly linearIssues: LinearIssuesService;
  readonly connections: ConnectionService;
  readonly schedules: ScheduleService;
  readonly remote: RemoteSessionService;
  readonly previewArtifacts: PreviewArtifactService;
  readonly browserSettings: BrowserSettingsService;
  /**
   * Key/JSON settings, for callers that store their own small policy blobs
   * rather than warranting a service. Used by the ACP agent registry and its
   * remembered approval rules (ADR 0008).
   */
  readonly settings: SettingsRepository;
  readonly noSleep: NoSleepService;
  readonly auth: AuthService;
  readonly voice: VoiceService;
  readonly accounts: AccountsService;
  readonly pricing: PricingService;
  readonly usage: UsageService;
  health(correlationId: CorrelationId): SystemHealthResponse;
  diagnostics(): DiagnosticBundle;
  close(): void;
}

export function bootstrapCore(options: CoreOptions): CoreRuntime {
  backupDatabaseFile(options.databasePath);
  const recentLogs: unknown[] = [];
  const logger = createLogger((line) => {
    try {
      recentLogs.push(JSON.parse(line) as unknown);
      if (recentLogs.length > 200) recentLogs.shift();
    } catch {
      // Non-JSON sink lines stay out of diagnostics.
    }
    if (options.logSink !== undefined) options.logSink(line);
    else process.stdout.write(`${line}\n`);
  });
  const startupCorrelationId = createCorrelationId();
  const database = openDatabase(options.databasePath);
  let schemaVersion = 0;
  try {
    const migrationResult = runMigrations(database, migrations);
    schemaVersion = migrationResult.currentVersion;
    logger.info({
      event: 'core.started',
      correlationId: startupCorrelationId,
      data: {
        schemaVersion: migrationResult.currentVersion,
        migrationsApplied: migrationResult.applied,
      },
    });
  } catch (error) {
    database.close();
    throw error;
  }

  let closed = false;
  const providerRepository = new ProviderRepository(database);
  const providers = new ProviderService(providerRepository, options.secretStore, logger);
  const models = new ModelService(
    providerRepository,
    new ModelRepository(database),
    options.secretStore,
    logger,
    options.modelGatewayFetch,
  );
  const chats = new ChatService(new ChatRepository(database), logger, models);
  const knowledge = new KnowledgeService(
    new KnowledgeRepository(database),
    models,
    logger,
  );
  const actionRepository = new ActionRepository(database);
  const actions = new ActionService(
    actionRepository,
    models,
    logger,
    createWorkToolRegistry(),
    new PermissionEngine(),
  );
  const projects = new ProjectService(
    actionRepository,
    new ProjectRepositoryStore(database),
    logger,
  );
  const board = new BoardService(database, logger);
  const workspaces = new WorkspaceStore(database);
  workspaces.reconcile();
  const voice = new VoiceService(
    new VoiceRepository(database),
    options.secretStore,
    logger,
    options.voiceInventory,
    new OpenAITranscriptionAdapter(options.modelGatewayFetch ?? fetch),
  );
  const review = new GitReviewService(new ReviewRepository(database));
  const githubIssues = new GitHubIssuesService(database, board, logger);
  const linearIssues = new LinearIssuesService(
    database,
    board,
    logger,
    options.secretStore,
  );
  const connections = new ConnectionService(
    database,
    options.secretStore,
    logger,
    ownedConfigDir(options.databasePath),
  );
  const schedules = new ScheduleService(database, connections, logger);
  const previewArtifacts = new PreviewArtifactService(
    new PreviewArtifactRepository(database),
  );
  const settings = new SettingsRepository(database);
  const browserSettings = new BrowserSettingsService(new SettingsRepository(database));
  const noSleep = new NoSleepService(new SettingsRepository(database));
  const auth = new AuthService(options.secretStore, new SettingsRepository(database));
  const accounts = new AccountsService(
    new SettingsRepository(database),
    board,
    logger,
    options.accountsRoot ?? join(dirname(options.databasePath), 'accounts'),
  );
  const pricing = new PricingService(new SettingsRepository(database));
  const usage = new UsageService(database, accounts, pricing, logger);
  const swarmRunner: SwarmSeatRunner = options.swarmRunner ?? {
    async execute() {
      return {
        status: 'failed',
        summary: 'no swarm runner is attached to this host',
        tokensUsed: 0,
        costUsd: 0,
      };
    },
  };
  const swarm: SwarmService = new SwarmService(
    database,
    logger,
    board,
    swarmRunner,
    options.swarmVerifier ?? new PnpmTaskVerifier(),
    options.swarmReviewer === undefined ? {} : { reviewer: options.swarmReviewer },
  );
  const remote = new RemoteSessionService(database, options.secretStore, logger, {
    status() {
      const latest = swarm.latestRun();
      const pending = actions.snapshot(createCorrelationId()).pendingApprovals;
      return {
        hostAuthoritative: true,
        lifetime: 'desktop-open',
        run: latest === null ? null : { id: latest.id, status: latest.status },
        pendingApprovals: pending.map((approval) => ({
          requestId: approval.requestId,
          summary: approval.summary,
        })),
      };
    },
    artifacts() {
      return previewArtifacts.list({}).map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        url: artifact.url,
        headSha: artifact.headSha,
        createdAt: artifact.createdAt,
      }));
    },
    instruct(input) {
      const state = swarm.state(input.runId);
      const seatIds = state.seats.map((seat) => seat.id);
      if (seatIds.length === 0) swarm.note(input.runId, input.text);
      else swarm.direct(input.runId, seatIds, input.text, createCorrelationId());
    },
    async approve(input) {
      const pending = actions
        .snapshot(createCorrelationId())
        .pendingApprovals.find((approval) => approval.requestId === input.requestId);
      if (pending === undefined) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown approval');
      }
      if (input.decision === 'allow') {
        await actions.approve(pending.id, createCorrelationId());
        return;
      }
      actions.reject(pending.id, createCorrelationId());
    },
    cancel(input) {
      swarm.stop(input.runId);
    },
  });
  const reconciledSwarms = swarm.reconcileInterruptedRuns();
  if (reconciledSwarms > 0) {
    logger.info({
      event: 'swarm.runs_reconciled',
      correlationId: startupCorrelationId,
      data: { count: reconciledSwarms },
    });
  }

  return {
    logger,
    chats,
    providers,
    models,
    knowledge,
    actions,
    projects,
    board,
    workspaces,
    swarm,
    review,
    githubIssues,
    linearIssues,
    connections,
    schedules,
    remote,
    previewArtifacts,
    browserSettings,
    settings,
    noSleep,
    auth,
    voice,
    accounts,
    pricing,
    usage,
    health(correlationId) {
      return {
        status: 'ok',
        database: 'ready',
        occurredAt: utcNow(),
        correlationId,
      };
    },
    diagnostics() {
      return buildDiagnostics({
        schemaVersion,
        logs: recentLogs,
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      remote.shutdown();
      knowledge.close();
      database.close();
      logger.info({ event: 'core.stopped', correlationId: createCorrelationId() });
    },
  };
}

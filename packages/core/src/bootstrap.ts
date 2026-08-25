import {
  ActionRepository,
  ChatRepository,
  KnowledgeRepository,
  migrations,
  ModelRepository,
  openDatabase,
  ProviderRepository,
  ProjectRepositoryStore,
  runMigrations,
} from '@zero/db';
import type { GatewayFetch } from '@zero/model-gateway';
import { createLogger, type LogSink, type Logger } from '@zero/observability';
import type { SystemHealthResponse } from '@zero/protocol';
import { createCorrelationId, utcNow, type CorrelationId } from '@zero/shared';

import { ProviderService } from './providers/provider-service.js';
import { ChatService } from './chat/chat-service.js';
import { ModelService } from './models/model-service.js';
import { KnowledgeService } from './knowledge/knowledge-service.js';
import { ActionService } from './actions/action-service.js';
import { createWorkToolRegistry, PermissionEngine } from '@zero/tools';
import { ProjectService } from './projects/project-service.js';
import { BoardService } from './board/board-service.js';
import { PnpmTaskVerifier } from './swarm/pnpm-verifier.js';
import {
  SwarmService,
  type SwarmSeatRunner,
  type SwarmTaskVerifier,
} from './swarm/swarm-service.js';
import type { SwarmReviewer } from './swarm/swarm-reviewer.js';
import type { SecretStore } from './secrets/secret-store.js';

export interface CoreOptions {
  readonly databasePath: string;
  readonly secretStore: SecretStore;
  readonly logSink?: LogSink;
  readonly modelGatewayFetch?: GatewayFetch;
  /** Host adapter that runs swarm seats; without it swarms fail closed. */
  readonly swarmRunner?: SwarmSeatRunner;
  readonly swarmVerifier?: SwarmTaskVerifier;
  readonly swarmReviewer?: SwarmReviewer;
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
  readonly swarm: SwarmService;
  health(correlationId: CorrelationId): SystemHealthResponse;
  close(): void;
}

export function bootstrapCore(options: CoreOptions): CoreRuntime {
  const logger = createLogger(options.logSink);
  const startupCorrelationId = createCorrelationId();
  const database = openDatabase(options.databasePath);

  try {
    const migrationResult = runMigrations(database, migrations);
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
    swarm,
    health(correlationId) {
      return {
        status: 'ok',
        database: 'ready',
        occurredAt: utcNow(),
        correlationId,
      };
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      knowledge.close();
      database.close();
      logger.info({ event: 'core.stopped', correlationId: createCorrelationId() });
    },
  };
}

import {
  ActionRepository,
  ChatRepository,
  KnowledgeRepository,
  migrations,
  ModelRepository,
  openDatabase,
  ProviderRepository,
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
import type { SecretStore } from './secrets/secret-store.js';

export interface CoreOptions {
  readonly databasePath: string;
  readonly secretStore: SecretStore;
  readonly logSink?: LogSink;
  readonly modelGatewayFetch?: GatewayFetch;
}

export interface CoreRuntime {
  readonly logger: Logger;
  readonly chats: ChatService;
  readonly providers: ProviderService;
  readonly models: ModelService;
  readonly knowledge: KnowledgeService;
  readonly actions: ActionService;
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
  const actions = new ActionService(
    new ActionRepository(database),
    models,
    logger,
    createWorkToolRegistry(),
    new PermissionEngine(),
  );

  return {
    logger,
    chats,
    providers,
    models,
    knowledge,
    actions,
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

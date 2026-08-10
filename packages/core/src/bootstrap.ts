import {
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
import { ModelService } from './models/model-service.js';
import type { SecretStore } from './secrets/secret-store.js';

export interface CoreOptions {
  readonly databasePath: string;
  readonly secretStore: SecretStore;
  readonly logSink?: LogSink;
  readonly modelGatewayFetch?: GatewayFetch;
}

export interface CoreRuntime {
  readonly logger: Logger;
  readonly providers: ProviderService;
  readonly models: ModelService;
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

  return {
    logger,
    providers,
    models,
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
      database.close();
      logger.info({ event: 'core.stopped', correlationId: createCorrelationId() });
    },
  };
}

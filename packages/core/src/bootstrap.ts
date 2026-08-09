import { migrations, openDatabase, ProviderRepository, runMigrations } from '@zero/db';
import { createLogger, type LogSink, type Logger } from '@zero/observability';
import type { SystemHealthResponse } from '@zero/protocol';
import { createCorrelationId, utcNow, type CorrelationId } from '@zero/shared';

import { ProviderService } from './providers/provider-service.js';
import type { SecretStore } from './secrets/secret-store.js';

export interface CoreOptions {
  readonly databasePath: string;
  readonly secretStore: SecretStore;
  readonly logSink?: LogSink;
}

export interface CoreRuntime {
  readonly logger: Logger;
  readonly providers: ProviderService;
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
  const providers = new ProviderService(
    new ProviderRepository(database),
    options.secretStore,
    logger,
  );

  return {
    logger,
    providers,
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

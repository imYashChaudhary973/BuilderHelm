import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import type {
  CreateProviderInput,
  DeleteProviderInput,
  ModelListInput,
  ProviderConnectionResult,
  ProviderOperationInput,
  ProviderSummary,
  UpdateProviderInput,
} from './providers.js';
import type { ModelRecord } from './model.js';

export const ipcChannels = {
  systemHealth: 'zero:system:health',
  providerList: 'zero:provider:list',
  providerCreate: 'zero:provider:create',
  providerUpdate: 'zero:provider:update',
  providerDelete: 'zero:provider:delete',
  providerTestConnection: 'zero:provider:test-connection',
  modelDiscover: 'zero:model:discover',
  modelList: 'zero:model:list',
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
  };
}

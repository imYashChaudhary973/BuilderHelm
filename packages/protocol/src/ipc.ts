import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import type {
  CreateProviderInput,
  DeleteProviderInput,
  ProviderSummary,
  UpdateProviderInput,
} from './providers.js';

export const ipcChannels = {
  systemHealth: 'zero:system:health',
  providerList: 'zero:provider:list',
  providerCreate: 'zero:provider:create',
  providerUpdate: 'zero:provider:update',
  providerDelete: 'zero:provider:delete',
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
  };
}

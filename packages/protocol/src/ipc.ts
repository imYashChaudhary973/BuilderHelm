import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

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
  ChatClientStreamEvent,
  ChatStreamInput,
  ChatThread,
  ChatTranscript,
  CreateChatThreadInput,
} from './chat.js';

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
  chatList: 'zero:chat:list',
  chatCreate: 'zero:chat:create',
  chatGet: 'zero:chat:get',
  chatStreamStart: 'zero:chat:stream-start',
  chatStreamCancel: 'zero:chat:stream-cancel',
  chatStreamEvent: 'zero:chat:stream-event',
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
}

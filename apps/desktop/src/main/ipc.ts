import type { CoreRuntime } from '@zero/core';
import { ipcChannels, systemHealthRequestSchema } from '@zero/protocol/ipc';
import {
  modelListIpcResponseSchema,
  modelListRequestSchema,
  modelListResponseSchema,
  providerCreateRequestSchema,
  providerDeleteRequestSchema,
  providerDiscoverModelsRequestSchema,
  providerListRequestSchema,
  providerTestConnectionIpcResponseSchema,
  providerTestConnectionRequestSchema,
  providerUpdateRequestSchema,
} from '@zero/protocol/providers';
import { normalizeError, ZeroError } from '@zero/shared';
import { ipcMain } from 'electron';

function ipcError(error: unknown): {
  readonly code: ReturnType<typeof normalizeError>['code'];
  readonly message: string;
  readonly retryable: boolean;
} {
  const normalized = normalizeError(error);
  return {
    code: normalized.code,
    message:
      error instanceof ZeroError
        ? normalized.message
        : 'The request could not be completed',
    retryable: normalized.retryable,
  };
}

export function registerIpcHandlers(core: CoreRuntime): () => void {
  ipcMain.handle(ipcChannels.systemHealth, (_event, input: unknown) => {
    const request = systemHealthRequestSchema.parse(input);
    return core.health(request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerList, (_event, input: unknown) => {
    providerListRequestSchema.parse(input);
    return core.providers.list();
  });
  ipcMain.handle(ipcChannels.providerCreate, async (_event, input: unknown) => {
    const request = providerCreateRequestSchema.parse(input);
    return core.providers.create(request.input, request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerUpdate, async (_event, input: unknown) => {
    const request = providerUpdateRequestSchema.parse(input);
    return core.providers.update(request.input, request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerDelete, async (_event, input: unknown) => {
    const request = providerDeleteRequestSchema.parse(input);
    return core.providers.delete(request.input.id, request.correlationId);
  });
  ipcMain.handle(ipcChannels.providerTestConnection, async (_event, input: unknown) => {
    try {
      const request = providerTestConnectionRequestSchema.parse(input);
      const value = await core.models.testConnection(
        request.input.providerId,
        request.correlationId,
      );
      return providerTestConnectionIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return providerTestConnectionIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelDiscover, async (_event, input: unknown) => {
    try {
      const request = providerDiscoverModelsRequestSchema.parse(input);
      const value = modelListResponseSchema.parse(
        await core.models.discover(request.input.providerId, request.correlationId),
      );
      return modelListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return modelListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelList, (_event, input: unknown) => {
    try {
      const request = modelListRequestSchema.parse(input);
      const value = modelListResponseSchema.parse(
        core.models.list(request.input.providerId),
      );
      return modelListIpcResponseSchema.parse({ ok: true, value });
    } catch (error) {
      return modelListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  return () => {
    ipcMain.removeHandler(ipcChannels.systemHealth);
    ipcMain.removeHandler(ipcChannels.providerList);
    ipcMain.removeHandler(ipcChannels.providerCreate);
    ipcMain.removeHandler(ipcChannels.providerUpdate);
    ipcMain.removeHandler(ipcChannels.providerDelete);
    ipcMain.removeHandler(ipcChannels.providerTestConnection);
    ipcMain.removeHandler(ipcChannels.modelDiscover);
    ipcMain.removeHandler(ipcChannels.modelList);
  };
}

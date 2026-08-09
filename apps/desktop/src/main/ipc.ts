import type { CoreRuntime } from '@zero/core';
import { ipcChannels, systemHealthRequestSchema } from '@zero/protocol/ipc';
import {
  providerCreateRequestSchema,
  providerDeleteRequestSchema,
  providerListRequestSchema,
  providerUpdateRequestSchema,
} from '@zero/protocol/providers';
import { ipcMain } from 'electron';

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

  return () => {
    ipcMain.removeHandler(ipcChannels.systemHealth);
    ipcMain.removeHandler(ipcChannels.providerList);
    ipcMain.removeHandler(ipcChannels.providerCreate);
    ipcMain.removeHandler(ipcChannels.providerUpdate);
    ipcMain.removeHandler(ipcChannels.providerDelete);
  };
}

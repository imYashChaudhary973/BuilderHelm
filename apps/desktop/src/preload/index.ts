import {
  ipcChannels,
  systemHealthResponseSchema,
  type ZeroDesktopApi,
} from '@zero/protocol/ipc';
import {
  createProviderInputSchema,
  deleteProviderInputSchema,
  providerDeleteResponseSchema,
  providerListResponseSchema,
  providerMutationResponseSchema,
  updateProviderInputSchema,
} from '@zero/protocol/providers';
import { contextBridge, ipcRenderer } from 'electron';

const api: ZeroDesktopApi = {
  system: {
    async health() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.systemHealth, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return systemHealthResponseSchema.parse(response);
    },
  },
  providers: {
    async list() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return providerListResponseSchema.parse(response);
    },
    async create(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerCreate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: createProviderInputSchema.parse(input),
      });
      return providerMutationResponseSchema.parse(response);
    },
    async update(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerUpdate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: updateProviderInputSchema.parse(input),
      });
      return providerMutationResponseSchema.parse(response);
    },
    async delete(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.providerDelete, {
        correlationId: globalThis.crypto.randomUUID(),
        input: deleteProviderInputSchema.parse(input),
      });
      return providerDeleteResponseSchema.parse(response);
    },
  },
};

contextBridge.exposeInMainWorld('zero', api);

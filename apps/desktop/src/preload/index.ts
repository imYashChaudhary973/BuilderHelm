import {
  ipcChannels,
  systemHealthResponseSchema,
  type ZeroDesktopApi,
} from '@zero/protocol/ipc';
import {
  createProviderInputSchema,
  deleteProviderInputSchema,
  modelListInputSchema,
  modelListIpcResponseSchema,
  providerDeleteResponseSchema,
  providerListResponseSchema,
  providerMutationResponseSchema,
  providerOperationInputSchema,
  providerTestConnectionIpcResponseSchema,
  updateProviderInputSchema,
} from '@zero/protocol/providers';
import { contextBridge, ipcRenderer } from 'electron';

function unwrap<T>(result: {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly message: string };
}): T {
  if (result.ok && result.value !== undefined) return result.value;
  throw new Error(result.error?.message ?? 'The request could not be completed');
}

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
    async testConnection(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.providerTestConnection,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: providerOperationInputSchema.parse(input),
        },
      );
      return unwrap(providerTestConnectionIpcResponseSchema.parse(response));
    },
  },
  models: {
    async discover(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.modelDiscover, {
        correlationId: globalThis.crypto.randomUUID(),
        input: providerOperationInputSchema.parse(input),
      });
      return unwrap(modelListIpcResponseSchema.parse(response));
    },
    async list(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.modelList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: modelListInputSchema.parse(input),
      });
      return unwrap(modelListIpcResponseSchema.parse(response));
    },
  },
};

contextBridge.exposeInMainWorld('zero', api);

import {
  actionCommandInputSchema,
  actionCommandIpcResponseSchema,
  actionSnapshotInputSchema,
  actionSnapshotIpcResponseSchema,
  approvalRejectIpcResponseSchema,
  approvalResolveInputSchema,
  approvalResolveIpcResponseSchema,
  permissionPolicyUpdateInputSchema,
  permissionPolicyUpdateIpcResponseSchema,
} from '@zero/protocol/actions';
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
  modelCapabilityOverrideListInputSchema,
  modelCapabilityOverrideListIpcResponseSchema,
  modelCapabilityOverrideUpdateInputSchema,
  modelCapabilityOverrideUpdateIpcResponseSchema,
  providerDeleteResponseSchema,
  providerListResponseSchema,
  providerMutationResponseSchema,
  providerOperationInputSchema,
  providerTestConnectionIpcResponseSchema,
  updateProviderInputSchema,
} from '@zero/protocol/providers';
import {
  chatStreamCancelInputSchema,
  chatStreamCancelIpcResponseSchema,
  chatStreamEnvelopeSchema,
  chatStreamInputSchema,
  chatStreamStartIpcResponseSchema,
  chatThreadInputSchema,
  chatThreadIpcResponseSchema,
  chatThreadListIpcResponseSchema,
  chatTranscriptIpcResponseSchema,
  createChatThreadInputSchema,
  type ChatClientStreamEvent,
} from '@zero/protocol/chat';
import {
  knowledgeAnswerIpcResponseSchema,
  knowledgeQueryInputSchema,
  knowledgeSourceInputSchema,
  knowledgeSourceIpcResponseSchema,
  knowledgeVaultListInputSchema,
  knowledgeVaultListIpcResponseSchema,
  knowledgeVaultMutationIpcResponseSchema,
  knowledgeVaultSelectIpcResponseSchema,
  knowledgeVaultSyncInputSchema,
} from '@zero/protocol/knowledge';
import { contextBridge, ipcRenderer } from 'electron';

function unwrap<T>(result: {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly message: string };
}): T {
  if (result.ok && result.value !== undefined) return result.value;
  throw new Error(result.error?.message ?? 'The request could not be completed');
}

const chatListeners = new Map<string, (event: ChatClientStreamEvent) => void>();

ipcRenderer.on(ipcChannels.chatStreamEvent, (_event, value: unknown) => {
  const parsed = chatStreamEnvelopeSchema.safeParse(value);
  if (!parsed.success) return;
  const listener = chatListeners.get(parsed.data.runId);
  if (listener === undefined) return;
  listener(parsed.data.event);
  if (parsed.data.event.type === 'done' || parsed.data.event.type === 'error') {
    chatListeners.delete(parsed.data.runId);
  }
});

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
    async listCapabilityOverrides(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.modelCapabilityOverrideList,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: modelCapabilityOverrideListInputSchema.parse(input),
        },
      );
      return unwrap(modelCapabilityOverrideListIpcResponseSchema.parse(response));
    },
    async updateCapabilityOverride(input) {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.modelCapabilityOverrideUpdate,
        {
          correlationId: globalThis.crypto.randomUUID(),
          input: modelCapabilityOverrideUpdateInputSchema.parse(input),
        },
      );
      return unwrap(modelCapabilityOverrideUpdateIpcResponseSchema.parse(response));
    },
  },
  chat: {
    async list() {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatList, {
        correlationId: globalThis.crypto.randomUUID(),
      });
      return unwrap(chatThreadListIpcResponseSchema.parse(response));
    },
    async create(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatCreate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: createChatThreadInputSchema.parse(input),
      });
      return unwrap(chatThreadIpcResponseSchema.parse(response));
    },
    async get(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatGet, {
        correlationId: globalThis.crypto.randomUUID(),
        input: chatThreadInputSchema.parse(input),
      });
      return unwrap(chatTranscriptIpcResponseSchema.parse(response));
    },
    async startStream(input, onEvent) {
      const parsedInput = chatStreamInputSchema.parse(input);
      const runId = globalThis.crypto.randomUUID();
      chatListeners.set(runId, onEvent);
      try {
        const response: unknown = await ipcRenderer.invoke(ipcChannels.chatStreamStart, {
          correlationId: globalThis.crypto.randomUUID(),
          runId,
          input: parsedInput,
        });
        return unwrap(chatStreamStartIpcResponseSchema.parse(response));
      } catch (error) {
        chatListeners.delete(runId);
        throw error;
      }
    },
    async cancelStream(input) {
      const parsedInput = chatStreamCancelInputSchema.parse(input);
      const response: unknown = await ipcRenderer.invoke(ipcChannels.chatStreamCancel, {
        correlationId: globalThis.crypto.randomUUID(),
        input: parsedInput,
      });
      return unwrap(chatStreamCancelIpcResponseSchema.parse(response));
    },
  },
  knowledge: {
    async listVaults(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeVaultList, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeVaultListInputSchema.parse(input),
      });
      return unwrap(knowledgeVaultListIpcResponseSchema.parse(response));
    },
    async selectVault() {
      const response: unknown = await ipcRenderer.invoke(
        ipcChannels.knowledgeVaultSelect,
        { correlationId: globalThis.crypto.randomUUID() },
      );
      return unwrap(knowledgeVaultSelectIpcResponseSchema.parse(response));
    },
    async syncVault(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeVaultSync, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeVaultSyncInputSchema.parse(input),
      });
      return unwrap(knowledgeVaultMutationIpcResponseSchema.parse(response));
    },
    async answer(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeQuery, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeQueryInputSchema.parse(input),
      });
      return unwrap(knowledgeAnswerIpcResponseSchema.parse(response));
    },
    async getSource(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.knowledgeSourceGet, {
        correlationId: globalThis.crypto.randomUUID(),
        input: knowledgeSourceInputSchema.parse(input),
      });
      return unwrap(knowledgeSourceIpcResponseSchema.parse(response));
    },
  },
  actions: {
    async snapshot(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionSnapshot, {
        correlationId: globalThis.crypto.randomUUID(),
        input: actionSnapshotInputSchema.parse(input),
      });
      return unwrap(actionSnapshotIpcResponseSchema.parse(response));
    },
    async command(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionCommand, {
        correlationId: globalThis.crypto.randomUUID(),
        input: actionCommandInputSchema.parse(input),
      });
      return unwrap(actionCommandIpcResponseSchema.parse(response));
    },
    async approve(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionApprove, {
        correlationId: globalThis.crypto.randomUUID(),
        input: approvalResolveInputSchema.parse(input),
      });
      return unwrap(approvalResolveIpcResponseSchema.parse(response));
    },
    async reject(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionReject, {
        correlationId: globalThis.crypto.randomUUID(),
        input: approvalResolveInputSchema.parse(input),
      });
      return unwrap(approvalRejectIpcResponseSchema.parse(response));
    },
    async updatePolicy(input) {
      const response: unknown = await ipcRenderer.invoke(ipcChannels.actionPolicyUpdate, {
        correlationId: globalThis.crypto.randomUUID(),
        input: permissionPolicyUpdateInputSchema.parse(input),
      });
      return unwrap(permissionPolicyUpdateIpcResponseSchema.parse(response));
    },
  },
};

contextBridge.exposeInMainWorld('zero', api);

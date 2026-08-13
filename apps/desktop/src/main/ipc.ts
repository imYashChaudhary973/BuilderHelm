import type { CoreRuntime } from '@zero/core';
import {
  chatCreateRequestSchema,
  chatGetRequestSchema,
  chatListRequestSchema,
  chatStreamCancelIpcResponseSchema,
  chatStreamCancelRequestSchema,
  chatStreamEnvelopeSchema,
  chatStreamStartIpcResponseSchema,
  chatStreamStartRequestSchema,
  chatThreadIpcResponseSchema,
  chatThreadListIpcResponseSchema,
  chatTranscriptIpcResponseSchema,
  type ChatClientStreamEvent,
} from '@zero/protocol/chat';
import { ipcChannels, systemHealthRequestSchema } from '@zero/protocol/ipc';
import {
  modelListIpcResponseSchema,
  modelListRequestSchema,
  modelListResponseSchema,
  modelCapabilityOverrideListIpcResponseSchema,
  modelCapabilityOverrideListRequestSchema,
  modelCapabilityOverrideUpdateIpcResponseSchema,
  modelCapabilityOverrideUpdateRequestSchema,
  providerCreateRequestSchema,
  providerDeleteRequestSchema,
  providerDiscoverModelsRequestSchema,
  providerListRequestSchema,
  providerTestConnectionIpcResponseSchema,
  providerTestConnectionRequestSchema,
  providerUpdateRequestSchema,
} from '@zero/protocol/providers';
import { normalizeError, ZeroError } from '@zero/shared';
import { ipcMain, type WebContents } from 'electron';
import { ZodError } from 'zod';

function ipcError(error: unknown): {
  readonly code: ReturnType<typeof normalizeError>['code'];
  readonly message: string;
  readonly retryable: boolean;
} {
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      retryable: false,
    };
  }
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

function sendChatEvent(
  sender: WebContents,
  runId: string,
  event: ChatClientStreamEvent,
): void {
  if (sender.isDestroyed()) return;
  sender.send(
    ipcChannels.chatStreamEvent,
    chatStreamEnvelopeSchema.parse({ runId, event }),
  );
}

export function registerIpcHandlers(core: CoreRuntime): () => void {
  const activeStreams = new Map<
    string,
    { readonly controller: AbortController; readonly senderId: number }
  >();
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
  ipcMain.handle(ipcChannels.modelCapabilityOverrideList, (_event, input: unknown) => {
    try {
      const request = modelCapabilityOverrideListRequestSchema.parse(input);
      return modelCapabilityOverrideListIpcResponseSchema.parse({
        ok: true,
        value: core.models.listCapabilityOverrides(request.input.providerId),
      });
    } catch (error) {
      return modelCapabilityOverrideListIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.modelCapabilityOverrideUpdate, (_event, input: unknown) => {
    try {
      const request = modelCapabilityOverrideUpdateRequestSchema.parse(input);
      return modelCapabilityOverrideUpdateIpcResponseSchema.parse({
        ok: true,
        value: core.models.updateCapabilityOverride(
          request.input.modelRef,
          request.input.overrides,
          request.correlationId,
        ),
      });
    } catch (error) {
      return modelCapabilityOverrideUpdateIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.chatList, (_event, input: unknown) => {
    try {
      chatListRequestSchema.parse(input);
      return chatThreadListIpcResponseSchema.parse({
        ok: true,
        value: core.chats.list(),
      });
    } catch (error) {
      return chatThreadListIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.chatCreate, (_event, input: unknown) => {
    try {
      const request = chatCreateRequestSchema.parse(input);
      return chatThreadIpcResponseSchema.parse({
        ok: true,
        value: core.chats.create(request.input, request.correlationId),
      });
    } catch (error) {
      return chatThreadIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.chatGet, (_event, input: unknown) => {
    try {
      const request = chatGetRequestSchema.parse(input);
      return chatTranscriptIpcResponseSchema.parse({
        ok: true,
        value: core.chats.get(request.input.threadId),
      });
    } catch (error) {
      return chatTranscriptIpcResponseSchema.parse({ ok: false, error: ipcError(error) });
    }
  });
  ipcMain.handle(ipcChannels.chatStreamStart, (event, input: unknown) => {
    try {
      const request = chatStreamStartRequestSchema.parse(input);
      if (activeStreams.has(request.runId)) {
        throw new ZeroError('VALIDATION_FAILED', 'Chat stream is already active');
      }
      const controller = new AbortController();
      const sender = event.sender;
      const abort = () => controller.abort();
      activeStreams.set(request.runId, { controller, senderId: sender.id });
      sender.once('destroyed', abort);

      void (async () => {
        try {
          for await (const streamEvent of core.chats.stream(
            request.input,
            request.correlationId,
            controller.signal,
          )) {
            sendChatEvent(sender, request.runId, streamEvent);
          }
        } catch (error) {
          sendChatEvent(sender, request.runId, { type: 'error', error: ipcError(error) });
        } finally {
          activeStreams.delete(request.runId);
          sender.removeListener('destroyed', abort);
        }
      })();

      return chatStreamStartIpcResponseSchema.parse({
        ok: true,
        value: { runId: request.runId },
      });
    } catch (error) {
      return chatStreamStartIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });
  ipcMain.handle(ipcChannels.chatStreamCancel, (event, input: unknown) => {
    try {
      const request = chatStreamCancelRequestSchema.parse(input);
      const active = activeStreams.get(request.input.runId);
      if (active !== undefined && active.senderId !== event.sender.id) {
        throw new ZeroError(
          'PERMISSION_DENIED',
          'Chat stream belongs to another renderer',
        );
      }
      active?.controller.abort();
      return chatStreamCancelIpcResponseSchema.parse({
        ok: true,
        value: { cancelled: active !== undefined },
      });
    } catch (error) {
      return chatStreamCancelIpcResponseSchema.parse({
        ok: false,
        error: ipcError(error),
      });
    }
  });

  return () => {
    for (const active of activeStreams.values()) active.controller.abort();
    activeStreams.clear();
    ipcMain.removeHandler(ipcChannels.systemHealth);
    ipcMain.removeHandler(ipcChannels.providerList);
    ipcMain.removeHandler(ipcChannels.providerCreate);
    ipcMain.removeHandler(ipcChannels.providerUpdate);
    ipcMain.removeHandler(ipcChannels.providerDelete);
    ipcMain.removeHandler(ipcChannels.providerTestConnection);
    ipcMain.removeHandler(ipcChannels.modelDiscover);
    ipcMain.removeHandler(ipcChannels.modelList);
    ipcMain.removeHandler(ipcChannels.modelCapabilityOverrideList);
    ipcMain.removeHandler(ipcChannels.modelCapabilityOverrideUpdate);
    ipcMain.removeHandler(ipcChannels.chatList);
    ipcMain.removeHandler(ipcChannels.chatCreate);
    ipcMain.removeHandler(ipcChannels.chatGet);
    ipcMain.removeHandler(ipcChannels.chatStreamStart);
    ipcMain.removeHandler(ipcChannels.chatStreamCancel);
  };
}

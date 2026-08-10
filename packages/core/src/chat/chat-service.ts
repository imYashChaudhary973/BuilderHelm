import type {
  ChatRepository,
  ChatTurnWrite,
  ChatUsageWrite,
  StoredChatThread,
  StoredChatTurn,
  StoredChatUsage,
} from '@zero/db';
import type { Logger } from '@zero/observability';
import {
  appendChatTurnInputSchema,
  appendedChatTurnSchema,
  chatThreadSchema,
  chatTranscriptSchema,
  chatTurnSchema,
  chatUsageRecordSchema,
  createChatThreadInputSchema,
  type AppendChatTurnInput,
  type AppendedChatTurn,
  type ChatThread,
  type ChatTranscript,
  type CreateChatThreadInput,
} from '@zero/protocol';
import { createId, utcNow, ZeroError, type CorrelationId } from '@zero/shared';

function toThread(thread: StoredChatThread): ChatThread {
  return chatThreadSchema.parse(thread);
}

function toTurn(turn: StoredChatTurn) {
  const content: unknown = JSON.parse(turn.contentJson);
  const providerContinuation: unknown =
    turn.providerContinuationJson === null
      ? null
      : JSON.parse(turn.providerContinuationJson);

  return chatTurnSchema.parse({
    id: turn.id,
    threadId: turn.threadId,
    ordinal: turn.ordinal,
    role: turn.role,
    content,
    modelRef: turn.modelRef,
    finishReason: turn.finishReason,
    providerContinuation,
    createdAt: turn.createdAt,
  });
}

function toUsage(usage: StoredChatUsage) {
  return chatUsageRecordSchema.parse({
    id: usage.id,
    threadId: usage.threadId,
    turnId: usage.turnId,
    providerId: usage.providerId,
    modelRef: usage.modelRef,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.cachedInputTokens === null
        ? {}
        : { cachedInputTokens: usage.cachedInputTokens }),
      ...(usage.reasoningTokens === null
        ? {}
        : { reasoningTokens: usage.reasoningTokens }),
    },
    createdAt: usage.createdAt,
  });
}

export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly logger: Logger,
  ) {}

  list(): ChatThread[] {
    try {
      return this.repository.listThreads().map(toThread);
    } catch (cause) {
      throw new ZeroError('DATABASE_FAILED', 'Failed to list chat threads', { cause });
    }
  }

  create(rawInput: CreateChatThreadInput, correlationId: CorrelationId): ChatThread {
    const input = createChatThreadInputSchema.parse(rawInput);
    const now = utcNow();
    const thread = chatThreadSchema.parse({
      id: createId(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const stored = toThread(this.repository.createThread(thread));
      this.logger.info({
        event: 'chat.thread_created',
        correlationId,
        data: { threadId: stored.id },
      });
      return stored;
    } catch (cause) {
      throw new ZeroError('DATABASE_FAILED', 'Failed to create chat thread', { cause });
    }
  }

  get(threadId: string): ChatTranscript {
    const id = chatThreadSchema.shape.id.parse(threadId);
    try {
      const thread = this.repository.findThreadById(id);
      if (thread === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'Chat thread was not found');
      }
      return chatTranscriptSchema.parse({
        thread: toThread(thread),
        turns: this.repository.listTurns(id).map(toTurn),
        usage: this.repository.listUsage(id).map(toUsage),
      });
    } catch (cause) {
      if (cause instanceof ZeroError) throw cause;
      throw new ZeroError('DATABASE_FAILED', 'Failed to read chat thread', { cause });
    }
  }

  append(rawInput: AppendChatTurnInput, correlationId: CorrelationId): AppendedChatTurn {
    const input = appendChatTurnInputSchema.parse(rawInput);
    let threadExists: boolean;
    try {
      threadExists = this.repository.findThreadById(input.threadId) !== undefined;
    } catch (cause) {
      throw new ZeroError('DATABASE_FAILED', 'Failed to read chat thread', { cause });
    }
    if (!threadExists) {
      throw new ZeroError('VALIDATION_FAILED', 'Chat thread was not found');
    }
    const now = utcNow();
    const turn: ChatTurnWrite = {
      id: createId(),
      threadId: input.threadId,
      role: input.role,
      contentJson: JSON.stringify(input.content),
      modelRef: input.modelRef,
      finishReason: input.finishReason,
      providerContinuationJson:
        input.providerContinuation === null
          ? null
          : JSON.stringify(input.providerContinuation),
      createdAt: now,
    };
    const usage: ChatUsageWrite | null =
      input.usage === null || input.modelRef === null
        ? null
        : {
            id: createId(),
            threadId: input.threadId,
            turnId: turn.id,
            providerId: input.modelRef.slice(0, input.modelRef.indexOf(':')),
            modelRef: input.modelRef,
            inputTokens: input.usage.inputTokens,
            outputTokens: input.usage.outputTokens,
            cachedInputTokens: input.usage.cachedInputTokens ?? null,
            reasoningTokens: input.usage.reasoningTokens ?? null,
            createdAt: now,
          };

    try {
      const stored = this.repository.appendTurn(turn, usage);
      const result = appendedChatTurnSchema.parse({
        turn: toTurn(stored.turn),
        usage: stored.usage === null ? null : toUsage(stored.usage),
      });
      this.logger.info({
        event: 'chat.turn_appended',
        correlationId,
        data: {
          threadId: result.turn.threadId,
          turnId: result.turn.id,
          role: result.turn.role,
          modelRef: result.turn.modelRef,
          usageRecorded: result.usage !== null,
        },
      });
      return result;
    } catch (cause) {
      throw new ZeroError('DATABASE_FAILED', 'Failed to append chat turn', { cause });
    }
  }
}

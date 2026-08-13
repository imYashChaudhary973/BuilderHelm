import type { ZeroDatabase } from './database.js';

export interface ChatThreadWrite {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatTurnWrite {
  readonly id: string;
  readonly threadId: string;
  readonly role: string;
  readonly contentJson: string;
  readonly modelRef: string | null;
  readonly finishReason: string | null;
  readonly providerContinuationJson: string | null;
  readonly createdAt: string;
}

export interface ChatUsageWrite {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly providerId: string;
  readonly modelRef: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly createdAt: string;
}

export interface StoredChatThread extends Record<string, unknown> {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatTurn extends Record<string, unknown> {
  id: string;
  threadId: string;
  ordinal: number;
  role: string;
  contentJson: string;
  modelRef: string | null;
  finishReason: string | null;
  providerContinuationJson: string | null;
  createdAt: string;
}

export interface StoredChatUsage extends Record<string, unknown> {
  id: string;
  threadId: string;
  turnId: string;
  providerId: string;
  modelRef: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  createdAt: string;
}

export interface AppendedChatTurnRows {
  readonly turn: StoredChatTurn;
  readonly usage: StoredChatUsage | null;
}

const threadColumns = `
  id,
  title,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const turnColumns = `
  id,
  thread_id AS threadId,
  ordinal,
  role,
  content_json AS contentJson,
  model_ref AS modelRef,
  finish_reason AS finishReason,
  provider_continuation_json AS providerContinuationJson,
  created_at AS createdAt
`;

const usageColumns = `
  id,
  thread_id AS threadId,
  turn_id AS turnId,
  provider_id AS providerId,
  model_ref AS modelRef,
  input_tokens AS inputTokens,
  output_tokens AS outputTokens,
  cached_input_tokens AS cachedInputTokens,
  reasoning_tokens AS reasoningTokens,
  created_at AS createdAt
`;

export class ChatRepository {
  constructor(private readonly database: ZeroDatabase) {}

  createThread(thread: ChatThreadWrite): StoredChatThread {
    this.database.run(
      `INSERT INTO chat_threads (id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [thread.id, thread.title, thread.createdAt, thread.updatedAt],
    );
    return { ...thread };
  }

  findThreadById(id: string): StoredChatThread | undefined {
    return this.database.queryOne<StoredChatThread>(
      `SELECT ${threadColumns} FROM chat_threads WHERE id = ?`,
      [id],
    );
  }

  listThreads(): StoredChatThread[] {
    return this.database.queryAll<StoredChatThread>(
      `SELECT ${threadColumns}
       FROM chat_threads
       ORDER BY updated_at DESC, id DESC`,
    );
  }

  listTurns(threadId: string): StoredChatTurn[] {
    return this.database.queryAll<StoredChatTurn>(
      `SELECT ${turnColumns}
       FROM chat_turns
       WHERE thread_id = ?
       ORDER BY ordinal`,
      [threadId],
    );
  }

  listUsage(threadId: string): StoredChatUsage[] {
    return this.database.queryAll<StoredChatUsage>(
      `SELECT ${usageColumns}
       FROM chat_usage
       WHERE thread_id = ?
       ORDER BY created_at, id`,
      [threadId],
    );
  }

  appendTurn(turn: ChatTurnWrite, usage: ChatUsageWrite | null): AppendedChatTurnRows {
    if (
      usage !== null &&
      (usage.threadId !== turn.threadId ||
        usage.turnId !== turn.id ||
        usage.modelRef !== turn.modelRef)
    ) {
      throw new TypeError('Usage must describe the appended assistant turn');
    }

    return this.database.transaction(() => {
      if (this.findThreadById(turn.threadId) === undefined) {
        throw new TypeError('Chat thread was not found');
      }

      const next = this.database.queryOne<{ ordinal: number }>(
        `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
         FROM chat_turns
         WHERE thread_id = ?`,
        [turn.threadId],
      );
      const ordinal = next?.ordinal ?? 0;

      this.database.run(
        `INSERT INTO chat_turns (
          id, thread_id, ordinal, role, content_json, model_ref,
          finish_reason, provider_continuation_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          turn.id,
          turn.threadId,
          ordinal,
          turn.role,
          turn.contentJson,
          turn.modelRef,
          turn.finishReason,
          turn.providerContinuationJson,
          turn.createdAt,
        ],
      );

      if (usage !== null) {
        this.database.run(
          `INSERT INTO chat_usage (
            id, thread_id, turn_id, provider_id, model_ref,
            input_tokens, output_tokens, cached_input_tokens,
            reasoning_tokens, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            usage.id,
            usage.threadId,
            usage.turnId,
            usage.providerId,
            usage.modelRef,
            usage.inputTokens,
            usage.outputTokens,
            usage.cachedInputTokens,
            usage.reasoningTokens,
            usage.createdAt,
          ],
        );
      }

      this.database.run('UPDATE chat_threads SET updated_at = ? WHERE id = ?', [
        turn.createdAt,
        turn.threadId,
      ]);

      const storedUsage: StoredChatUsage | null =
        usage === null
          ? null
          : {
              id: usage.id,
              threadId: usage.threadId,
              turnId: usage.turnId,
              providerId: usage.providerId,
              modelRef: usage.modelRef,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              reasoningTokens: usage.reasoningTokens,
              createdAt: usage.createdAt,
            };

      return {
        turn: { ...turn, ordinal },
        usage: storedUsage,
      };
    });
  }
}

import { createId, utcNow } from '@zero/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ChatRepository,
  migrations,
  openDatabase,
  runMigrations,
  type ChatTurnWrite,
  type ChatUsageWrite,
  type ZeroDatabase,
} from '../src/index.js';

const databases: ZeroDatabase[] = [];

function setup() {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const repository = new ChatRepository(database);
  const threadId = createId();
  const createdAt = '2026-08-10T10:00:00.000Z';
  repository.createThread({
    id: threadId,
    title: 'Persistent chat',
    createdAt,
    updatedAt: createdAt,
  });
  return { database, repository, threadId, createdAt };
}

function turn(threadId: string, overrides: Partial<ChatTurnWrite> = {}): ChatTurnWrite {
  return {
    id: createId(),
    threadId,
    role: 'user',
    contentJson: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    modelRef: null,
    finishReason: null,
    providerContinuationJson: null,
    createdAt: utcNow(),
    ...overrides,
  };
}

function usage(
  threadId: string,
  turnId: string,
  providerId: string,
  modelRef: string,
  overrides: Partial<ChatUsageWrite> = {},
): ChatUsageWrite {
  return {
    id: createId(),
    threadId,
    turnId,
    providerId,
    modelRef,
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: null,
    reasoningTokens: null,
    createdAt: utcNow(),
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('chat repository', () => {
  it('persists ordered turns and normalized usage atomically', () => {
    const { repository, threadId } = setup();
    const userTurn = turn(threadId, { createdAt: '2026-08-10T10:01:00.000Z' });
    const providerId = createId();
    const modelRef = `${providerId}:gpt-example`;
    const assistantTurn = turn(threadId, {
      role: 'assistant',
      modelRef,
      finishReason: 'stop',
      providerContinuationJson: JSON.stringify({
        providerId,
        responseId: 'response-123',
      }),
      createdAt: '2026-08-10T10:02:00.000Z',
    });
    const assistantUsage = usage(threadId, assistantTurn.id, providerId, modelRef, {
      cachedInputTokens: 2,
      reasoningTokens: 1,
      createdAt: assistantTurn.createdAt,
    });

    expect(repository.appendTurn(userTurn, null).turn.ordinal).toBe(0);
    expect(repository.appendTurn(assistantTurn, assistantUsage)).toMatchObject({
      turn: { ordinal: 1, modelRef },
      usage: { inputTokens: 10, outputTokens: 5, modelRef },
    });
    expect(repository.listTurns(threadId).map((item) => item.ordinal)).toEqual([0, 1]);
    expect(repository.listUsage(threadId)).toEqual([
      expect.objectContaining({
        turnId: assistantTurn.id,
        cachedInputTokens: 2,
        reasoningTokens: 1,
      }),
    ]);
    expect(repository.findThreadById(threadId)?.updatedAt).toBe(assistantTurn.createdAt);
  });

  it('rolls back an appended turn when usage violates a constraint', () => {
    const { repository, threadId, createdAt } = setup();
    const providerId = createId();
    const modelRef = `${providerId}:gpt-example`;
    const assistantTurn = turn(threadId, {
      role: 'assistant',
      modelRef,
      finishReason: 'stop',
    });

    expect(() =>
      repository.appendTurn(
        assistantTurn,
        usage(threadId, assistantTurn.id, providerId, modelRef, { inputTokens: -1 }),
      ),
    ).toThrow();
    expect(repository.listTurns(threadId)).toEqual([]);
    expect(repository.listUsage(threadId)).toEqual([]);
    expect(repository.findThreadById(threadId)?.updatedAt).toBe(createdAt);
  });

  it('retains canonical history after its provider is deleted', () => {
    const { database, repository, threadId } = setup();
    const providerId = createId();
    const now = utcNow();
    database.run(
      `INSERT INTO providers (
        id, label, protocol, base_url, secret_ref, headers_json,
        allow_personal, allow_sensitive, allow_health, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        providerId,
        'Disposable provider',
        'openai',
        null,
        `zero.provider.${providerId}.api-key`,
        '[]',
        1,
        0,
        0,
        1,
        now,
        now,
      ],
    );
    const modelRef = `${providerId}:retained-model`;
    const assistantTurn = turn(threadId, {
      role: 'assistant',
      modelRef,
      finishReason: 'stop',
    });
    repository.appendTurn(
      assistantTurn,
      usage(threadId, assistantTurn.id, providerId, modelRef),
    );

    database.run('DELETE FROM providers WHERE id = ?', [providerId]);

    expect(repository.listTurns(threadId)).toHaveLength(1);
    expect(repository.listUsage(threadId)).toEqual([
      expect.objectContaining({ providerId, modelRef }),
    ]);
  });
});

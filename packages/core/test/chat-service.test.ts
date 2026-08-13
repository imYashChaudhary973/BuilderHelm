import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCorrelationId, createId } from '@zero/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapCore, MemorySecretStore, type CoreRuntime } from '../src/index.js';

const runtimes: CoreRuntime[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (runtimes.length > 0) runtimes.pop()?.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('chat service', () => {
  it('persists canonical turns and usage across restarts and model switches', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zero-chat-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'zero.sqlite');
    const logs: string[] = [];
    const first = bootstrapCore({
      databasePath,
      secretStore: new MemorySecretStore(),
      logSink: (line) => logs.push(line),
    });
    runtimes.push(first);
    const thread = first.chats.create({ title: 'Model switch' }, createCorrelationId());
    first.chats.append(
      {
        threadId: thread.id,
        role: 'user',
        content: [{ type: 'text', text: 'private-message-sentinel' }],
      },
      createCorrelationId(),
    );

    const firstProviderId = createId();
    const firstModelRef = `${firstProviderId}:model-a`;
    first.chats.append(
      {
        threadId: thread.id,
        role: 'assistant',
        content: [{ type: 'text', text: 'First answer' }],
        modelRef: firstModelRef,
        finishReason: 'stop',
        providerContinuation: {
          providerId: firstProviderId,
          responseId: 'opaque-response-sentinel',
        },
        usage: { inputTokens: 8, outputTokens: 3 },
      },
      createCorrelationId(),
    );

    const secondProviderId = createId();
    const secondModelRef = `${secondProviderId}:model-b`;
    first.chats.append(
      {
        threadId: thread.id,
        role: 'assistant',
        content: [{ type: 'text', text: 'Second answer' }],
        modelRef: secondModelRef,
        finishReason: 'length',
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cachedInputTokens: 4,
          reasoningTokens: 2,
        },
      },
      createCorrelationId(),
    );
    first.close();
    runtimes.pop();

    const reopened = bootstrapCore({
      databasePath,
      secretStore: new MemorySecretStore(),
      logSink: (line) => logs.push(line),
    });
    runtimes.push(reopened);
    const transcript = reopened.chats.get(thread.id);

    expect(reopened.chats.list()).toEqual([
      expect.objectContaining({ id: thread.id, title: 'Model switch' }),
    ]);
    expect(transcript.turns.map((turn) => turn.modelRef)).toEqual([
      null,
      firstModelRef,
      secondModelRef,
    ]);
    expect(transcript.usage).toEqual([
      expect.objectContaining({ modelRef: firstModelRef }),
      expect.objectContaining({
        modelRef: secondModelRef,
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cachedInputTokens: 4,
          reasoningTokens: 2,
        },
      }),
    ]);
    expect(logs.join('\n')).not.toContain('private-message-sentinel');
    expect(logs.join('\n')).not.toContain('opaque-response-sentinel');
  });

  it('validates the complete turn before writing any data', () => {
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
    });
    runtimes.push(runtime);
    const thread = runtime.chats.create({}, createCorrelationId());

    expect(() =>
      runtime.chats.append(
        {
          threadId: thread.id,
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          apiKey: 'must-not-persist',
        } as never,
        createCorrelationId(),
      ),
    ).toThrow();
    expect(runtime.chats.get(thread.id).turns).toEqual([]);
  });
});

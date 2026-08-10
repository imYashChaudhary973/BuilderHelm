import { createId, utcNow } from '@zero/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  migrations,
  ModelRepository,
  openDatabase,
  runMigrations,
  type ModelWrite,
  type ZeroDatabase,
} from '../src/index.js';

const databases: ZeroDatabase[] = [];

function setup(): {
  database: ZeroDatabase;
  repository: ModelRepository;
  providerId: string;
} {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const providerId = createId();
  const now = utcNow();
  database.run(
    `INSERT INTO providers (
      id, label, protocol, base_url, secret_ref, headers_json,
      allow_personal, allow_sensitive, allow_health, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      'OpenAI',
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
  return { database, repository: new ModelRepository(database), providerId };
}

function model(
  providerId: string,
  modelId: string,
  metadataJson = '{"tags":[]}',
): ModelWrite {
  const now = utcNow();
  return {
    id: `${providerId}:${modelId}`,
    providerId,
    modelId,
    label: modelId,
    privacyClass: 'remote',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    capabilities: {
      text: true,
      vision: false,
      audioInput: false,
      toolCalling: false,
      parallelTools: false,
      structuredOutput: false,
      streaming: true,
      reasoningControls: false,
      serverWebSearch: false,
      serverMcp: false,
      contextWindow: null,
      maxOutputTokens: null,
      metadataJson,
    },
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('model repository', () => {
  it('atomically replaces a provider catalog and its capabilities', () => {
    const { repository, providerId } = setup();
    repository.replaceForProvider(providerId, [
      model(providerId, 'gpt-a'),
      model(providerId, 'gpt-b'),
    ]);

    expect(repository.list(providerId).map((item) => item.modelId)).toEqual([
      'gpt-a',
      'gpt-b',
    ]);

    repository.replaceForProvider(providerId, [model(providerId, 'gpt-c')]);
    expect(repository.list(providerId)).toEqual([
      expect.objectContaining({
        id: `${providerId}:gpt-c`,
        modelId: 'gpt-c',
        text: 1,
        streaming: 1,
      }),
    ]);
  });

  it('preserves the previous catalog when a replacement fails', () => {
    const { repository, providerId } = setup();
    repository.replaceForProvider(providerId, [model(providerId, 'stable')]);

    expect(() =>
      repository.replaceForProvider(providerId, [
        model(providerId, 'candidate'),
        model(providerId, 'invalid', 'not-json'),
      ]),
    ).toThrow();
    expect(repository.list(providerId).map((item) => item.modelId)).toEqual(['stable']);
  });

  it('rejects models assigned to a different provider before deleting data', () => {
    const { repository, providerId } = setup();
    repository.replaceForProvider(providerId, [model(providerId, 'stable')]);

    expect(() =>
      repository.replaceForProvider(providerId, [model(createId(), 'wrong')]),
    ).toThrow(/different provider/);
    expect(repository.list(providerId).map((item) => item.modelId)).toEqual(['stable']);
  });
});

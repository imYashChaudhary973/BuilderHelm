import { createId, utcNow } from '@zero/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  KnowledgeRepository,
  migrations,
  openDatabase,
  runMigrations,
  type KnowledgeDocumentWrite,
  type ZeroDatabase,
} from '../src/index.js';

const databases: ZeroDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function document(relativePath: string, text: string): KnowledgeDocumentWrite {
  const now = utcNow();
  return {
    id: createId(),
    relativePath,
    title: 'Architecture Decision',
    contentHash: `hash-${text}`,
    modifiedAtMs: 1,
    sizeBytes: text.length,
    frontmatterJson: '{}',
    tagsJson: '[]',
    createdAt: now,
    updatedAt: now,
    chunks: [
      {
        id: createId(),
        ordinal: 0,
        heading: 'Decision',
        lineStart: 3,
        lineEnd: 4,
        text,
        contentHash: `chunk-${text}`,
      },
    ],
    links: [],
    entities: [],
  };
}

describe('knowledge repository', () => {
  it('indexes, searches, incrementally updates, and removes vault sources', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const repository = new KnowledgeRepository(database);
    const vaultId = createId();
    const now = utcNow();
    repository.createVault({
      id: vaultId,
      rootPath: '/fixture/vault',
      name: 'Fixture',
      createdAt: now,
      updatedAt: now,
    });
    const first = document('Decision.md', 'Architecture B enables offline operation.');
    repository.syncVault(vaultId, [first], now);

    expect(repository.listVaults()).toMatchObject([{ id: vaultId, noteCount: 1 }]);
    expect(repository.search(vaultId, '"architecture"*', 5)).toMatchObject([
      {
        relativePath: 'Decision.md',
        heading: 'Decision',
        lineStart: 3,
        lineEnd: 4,
      },
    ]);
    const stableChunkId = repository.search(vaultId, '"architecture"*', 5)[0]!.chunkId;
    const stableSourceId = repository.listSources(vaultId)[0]!.id;

    repository.syncVault(
      vaultId,
      [document('Decision.md', 'Architecture B enables offline operation.')],
      utcNow(),
    );
    expect(repository.search(vaultId, '"architecture"*', 5)[0]!.chunkId).toBe(
      stableChunkId,
    );

    const changed = document('Decision.md', 'Architecture C replaced the old design.');
    repository.syncVault(vaultId, [changed], utcNow());
    expect(repository.listSources(vaultId)[0]!.id).toBe(stableSourceId);
    expect(repository.search(vaultId, '"offline"*', 5)).toEqual([]);
    expect(repository.search(vaultId, '"replaced"*', 5)).toHaveLength(1);

    repository.syncVault(vaultId, [], utcNow());
    expect(repository.listVaults()[0]!.noteCount).toBe(0);
    expect(repository.search(vaultId, '"architecture"*', 5)).toEqual([]);
  });
});

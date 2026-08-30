import {
  migrations,
  openDatabase,
  PreviewArtifactRepository,
  runMigrations,
} from '@builderhelm/db';
import { afterEach, describe, expect, it } from 'vitest';

import { PreviewArtifactService } from '../src/preview/preview-artifact-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('PreviewArtifactService', () => {
  it('stores a snapshot without extra keys and lists it by revision', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const service = new PreviewArtifactService(new PreviewArtifactRepository(database));
    const recorded = service.record({
      headSha: 'a'.repeat(40),
      kind: 'snapshot',
      url: 'http://127.0.0.1:5173/',
      viewport: 'phone',
      nodes: [{ ref: 'e1', role: 'button', name: 'Sign up' }],
    });
    expect(recorded.nodes).toEqual([{ ref: 'e1', role: 'button', name: 'Sign up' }]);
    expect(recorded.pngBase64).toBeNull();
    const listed = service.list({ headSha: 'a'.repeat(40) });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(recorded.id);
  });

  it('stores a tool receipt as review evidence', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const service = new PreviewArtifactService(new PreviewArtifactRepository(database));
    const recorded = service.record({
      headSha: 'b'.repeat(40),
      kind: 'tool',
      url: 'http://127.0.0.1:5173/store',
      viewport: 'desktop',
      detail: 'add_to_cart 1 in cart',
    });
    expect(recorded.kind).toBe('tool');
    expect(recorded.detail).toBe('add_to_cart 1 in cart');
    expect(recorded.nodes).toBeNull();
    expect(service.list({ headSha: 'b'.repeat(40) })[0]?.detail).toBe(
      'add_to_cart 1 in cart',
    );
  });
});

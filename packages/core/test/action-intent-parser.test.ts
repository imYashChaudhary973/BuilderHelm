import {
  ActionRepository,
  migrations,
  openDatabase,
  runMigrations,
} from '@builderhelm/db';
import { createId, utcNow } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeWorkName,
  parseDeterministicAction,
} from '../src/actions/intent-parser.js';

const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('deterministic action intent parser', () => {
  it('parses the canonical tomorrow task command without invoking a model', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const repository = new ActionRepository(database);
    const projectId = createId();
    const now = utcNow();
    database.run(
      `INSERT INTO projects (
        id, name, normalized_name, description, status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'active', ?, ?)`,
      [projectId, 'Project A', normalizeWorkName('Project A'), now, now],
    );

    const intent = parseDeterministicAction(
      'Add a high-priority task to Project A to benchmark the sync layer tomorrow.',
      repository,
      new Date('2026-08-11T10:00:00+05:30'),
    );

    expect(intent).toMatchObject({
      toolId: 'task.create',
      input: {
        projectId,
        title: 'benchmark the sync layer',
        priority: 'high',
      },
    });
    expect((intent?.input as { dueAt: string }).dueAt.slice(0, 10)).toBe('2026-08-12');
  });
});

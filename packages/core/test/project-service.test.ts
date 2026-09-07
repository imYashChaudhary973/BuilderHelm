import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  ActionRepository,
  migrations,
  openDatabase,
  ProjectRepositoryStore,
  runMigrations,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { createCorrelationId, utcNow } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalGitInspector } from '../src/projects/git-inspector.js';
import { ProjectService } from '../src/projects/project-service.js';

const temporaryDirectories: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'builderhelm-project-git-'));
  temporaryDirectories.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'start fixture'], { cwd: root });
  return root;
}

type TestDatabase = ReturnType<typeof openDatabase>;

function insertProject(database: TestDatabase, name: string): string {
  const projectId = createCorrelationId();
  const now = utcNow();
  database.run(
    `INSERT INTO projects (
      id, name, normalized_name, description, status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 'active', ?, ?)`,
    [projectId, name, name.toLowerCase(), now, now],
  );
  return projectId;
}

function insertTask(
  database: TestDatabase,
  projectId: string,
  title: string,
  description: string | null,
): void {
  const now = utcNow();
  database.run(
    `INSERT INTO tasks (
      id, project_id, title, normalized_title, description, status, priority,
      due_at, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'todo', 'high', NULL, 'manual', ?, ?)`,
    [createCorrelationId(), projectId, title, title.toLowerCase(), description, now, now],
  );
}

function insertDecision(
  database: TestDatabase,
  projectId: string,
  title: string,
  detail: string | null,
): void {
  database.run(
    `INSERT INTO project_decisions (id, project_id, title, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [createCorrelationId(), projectId, title, detail, utcNow()],
  );
}

describe('project continuity', () => {
  it('inspects a repository with fixed Git operations and notices local changes', () => {
    const root = createRepository();
    writeFileSync(join(root, 'README.md'), '# Fixture\nChanged.\n');

    const snapshot = new LocalGitInspector().inspect(root);

    expect(snapshot).toMatchObject({ branch: 'main', dirtyCount: 1 });
    expect(snapshot.commits[0]).toMatchObject({
      subject: 'start fixture',
      authorName: 'Fixture User',
    });
    expect(snapshot.rootPath).toBe(realpathSync.native(root));
  });

  it('combines registered Git activity with project tasks and decisions', () => {
    const root = createRepository();
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const projectId = createCorrelationId();
    const taskId = createCorrelationId();
    const decisionId = createCorrelationId();
    const now = utcNow();
    database.run(
      `INSERT INTO projects (
        id, name, normalized_name, description, status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'active', ?, ?)`,
      [projectId, 'Helm Site', 'helm site', now, now],
    );
    database.run(
      `INSERT INTO tasks (
        id, project_id, title, normalized_title, description, status, priority,
        due_at, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'blocked', 'high', NULL, 'manual', ?, ?)`,
      [taskId, projectId, 'Resolve blocker', 'resolve blocker', now, now],
    );
    database.run(
      `INSERT INTO project_decisions (id, project_id, title, detail, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [decisionId, projectId, 'Keep Git local', now],
    );
    const service = new ProjectService(
      new ActionRepository(database),
      new ProjectRepositoryStore(database),
      logger,
    );

    const result = service.registerRepository(projectId, root, createCorrelationId());

    expect(result.repository).toMatchObject({ branch: 'main', dirtyCount: 0 });
    expect(result.repository?.rootPath).toBe(realpathSync.native(root));
    expect(isAbsolute(result.repository?.rootPath ?? '')).toBe(true);
    expect(result.timeline.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['commit', 'task', 'decision']),
    );
    expect(service.dashboard().projects).toHaveLength(1);
    database.close();
  });

  it('keeps the dashboard readable when sources exceed the response bounds', () => {
    const database = openDatabase(':memory:');
    runMigrations(database, migrations);
    const service = new ProjectService(
      new ActionRepository(database),
      new ProjectRepositoryStore(database),
      logger,
    );
    const healthyId = insertProject(database, 'Healthy');
    const oversizedId = insertProject(database, 'Oversized');
    // Legal everywhere it is written: the column and taskSchema both allow 10k,
    // while the timeline detail is bounded at 1k.
    insertTask(database, oversizedId, 'Long task', 'x'.repeat(5_000));
    insertDecision(database, oversizedId, 'Long decision', 'y'.repeat(5_000));
    for (let index = 0; index < 501; index += 1) {
      insertTask(database, healthyId, `Task ${index}`, null);
    }

    const snapshot = service.dashboard();

    // One project with oversized rows must not take down the other project.
    expect(snapshot.projects).toHaveLength(2);
    const oversized = snapshot.projects.find((entry) => entry.project.id === oversizedId);
    const detail = oversized?.timeline.find((item) => item.kind === 'task')?.detail;
    expect(detail).toHaveLength(1_000);
    expect(detail?.endsWith('…')).toBe(true);
    // Tasks stay within the bound the response schema declares.
    const healthy = snapshot.projects.find((entry) => entry.project.id === healthyId);
    expect(healthy?.tasks).toHaveLength(500);
    database.close();
  });
});

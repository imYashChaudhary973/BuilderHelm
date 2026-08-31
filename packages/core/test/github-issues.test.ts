import {
  migrations,
  openDatabase,
  runMigrations,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardService } from '../src/board/board-service.js';
import {
  GitHubIssuesService,
  parseGitHubIssues,
} from '../src/integrations/github-issues.js';
import type { GhRunner } from '../src/projects/git-review.js';

const databases: BuilderHelmDatabase[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
const issue = {
  id: 'I_kwDOBuilderHelm1',
  number: 41,
  title: 'Ship GitHub issue intake',
  body: 'Import assigned work without duplicating Board cards.',
  url: 'https://github.com/acme/builderhelm/issues/41',
  state: 'open',
  updatedAt: '2026-08-31T12:00:00Z',
  repository: { nameWithOwner: 'acme/builderhelm' },
};

function setup(runGh: GhRunner): {
  database: BuilderHelmDatabase;
  board: BoardService;
  github: GitHubIssuesService;
} {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const board = new BoardService(database, logger);
  return {
    database,
    board,
    github: new GitHubIssuesService(database, board, logger, runGh),
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('GitHub issue parsing', () => {
  it('normalizes the gh search shape', () => {
    expect(parseGitHubIssues(JSON.stringify([issue]))).toEqual([
      {
        ...issue,
        repository: 'acme/builderhelm',
        importedCardId: null,
        importedWorkspaceId: null,
      },
    ]);
  });
});

describe('GitHubIssuesService', () => {
  it('imports one canonical issue and reports the existing Board card', async () => {
    const calls: string[][] = [];
    const runGh: GhRunner = (_cwd, args) => {
      calls.push([...args]);
      if (args[0] === 'search')
        return Promise.resolve({ stdout: JSON.stringify([issue]) });
      return Promise.resolve({ stdout: JSON.stringify(issue) });
    };
    const { board, github } = setup(runGh);
    const project = board.createProject('BuilderHelm', createCorrelationId());

    const first = await github.importIssue(project.id, issue.url, createCorrelationId());
    const second = await github.importIssue(project.id, issue.url, createCorrelationId());
    const assigned = await github.listAssigned();

    expect(second.id).toBe(first.id);
    expect(board.listCards(project.id)).toEqual([first]);
    expect(first).toMatchObject({
      title: issue.title,
      detail: issue.body,
      source: {
        id: issue.id,
        repository: 'acme/builderhelm',
        number: issue.number,
        state: 'open',
      },
    });
    expect(assigned[0]).toMatchObject({
      importedCardId: first.id,
      importedWorkspaceId: project.id,
    });
    expect(calls.filter((args) => args[0] === 'search')).toHaveLength(1);
  });

  it('closes once per request and records an append-only receipt', async () => {
    let closeCalls = 0;
    const runGh: GhRunner = (_cwd, args) => {
      if (args[0] === 'issue' && args[1] === 'close') {
        closeCalls += 1;
        return Promise.resolve({ stdout: issue.url });
      }
      return Promise.resolve({ stdout: JSON.stringify(issue) });
    };
    const { database, board, github } = setup(runGh);
    const project = board.createProject('BuilderHelm', createCorrelationId());
    const card = await github.importIssue(project.id, issue.url, createCorrelationId());
    const input = {
      cardId: card.id,
      state: 'closed' as const,
      requestId: crypto.randomUUID(),
    };

    const first = await github.syncIssue(input, createCorrelationId());
    const replay = await github.syncIssue(input, createCorrelationId());

    expect(closeCalls).toBe(1);
    expect(first.receipt).toMatchObject({ outcome: 'succeeded', changed: true });
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(replay.card).toMatchObject({ column: 'shipped', source: { state: 'closed' } });
    expect(
      database.queryOne<{ count: number }>(
        'SELECT count(*) AS count FROM github_issue_receipts',
      ),
    ).toEqual({ count: 1 });
    expect(() =>
      database.run(`UPDATE github_issue_receipts SET detail = 'changed'`),
    ).toThrow('GitHub issue receipts are append-only');
  });

  it('records an unknown outcome instead of replaying an ambiguous write', async () => {
    let views = 0;
    const runGh: GhRunner = (_cwd, args) => {
      if (args[1] === 'close') return Promise.reject(new Error('connection reset'));
      if (args[1] === 'view') {
        views += 1;
        if (views > 1) return Promise.reject(new Error('connection reset'));
      }
      return Promise.resolve({ stdout: JSON.stringify(issue) });
    };
    const { board, github } = setup(runGh);
    const project = board.createProject('BuilderHelm', createCorrelationId());
    const card = await github.importIssue(project.id, issue.url, createCorrelationId());

    const result = await github.syncIssue(
      { cardId: card.id, state: 'closed', requestId: crypto.randomUUID() },
      createCorrelationId(),
    );

    expect(result.receipt).toMatchObject({ outcome: 'outcome_unknown', changed: false });
    expect(result.card).toMatchObject({ column: 'idea', source: { state: 'open' } });
  });

  it('surfaces revoked GitHub CLI authentication without leaking raw output', async () => {
    const runGh: GhRunner = () =>
      Promise.reject(new Error('HTTP 401: Bad credentials token=secret'));
    const { github } = setup(runGh);

    await expect(github.listAssigned()).rejects.toMatchObject({
      code: 'INTEGRATION_OFFLINE',
      message: 'Run `gh auth login` to let BuilderHelm read GitHub.',
    });
  });
});

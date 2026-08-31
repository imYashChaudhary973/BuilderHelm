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
  LINEAR_SECRET_REF,
  LinearIssuesService,
  parseLinearIssues,
  type LinearTransport,
} from '../src/integrations/linear-issues.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';

const databases: BuilderHelmDatabase[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const issueNode = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  identifier: 'ENG-41',
  title: 'Ship Linear issue intake',
  description: 'Import assigned Linear work without duplicating Board cards.',
  url: 'https://linear.app/acme/issue/ENG-41',
  updatedAt: '2026-08-31T12:00:00.000Z',
  state: { type: 'unstarted' },
  team: {
    states: {
      nodes: [
        { id: 'state-open', type: 'unstarted' },
        { id: 'state-done', type: 'completed' },
      ],
    },
  },
};

const apiKey = 'lin_api_test_key_value_ok';

function setup(transport: LinearTransport): {
  database: BuilderHelmDatabase;
  board: BoardService;
  linear: LinearIssuesService;
  secrets: MemorySecretStore;
} {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const board = new BoardService(database, logger);
  const secrets = new MemorySecretStore();
  return {
    database,
    board,
    secrets,
    linear: new LinearIssuesService(database, board, logger, secrets, transport),
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('Linear issue parsing', () => {
  it('maps Linear GraphQL nodes onto open/closed', () => {
    expect(parseLinearIssues([issueNode])).toEqual([
      {
        id: issueNode.id,
        identifier: 'ENG-41',
        title: issueNode.title,
        body: issueNode.description,
        url: issueNode.url,
        state: 'open',
        updatedAt: '2026-08-31T12:00:00.000Z',
        importedCardId: null,
        importedWorkspaceId: null,
      },
    ]);
  });
});

describe('LinearIssuesService', () => {
  it('refuses to list issues before a key is saved', async () => {
    const { linear } = setup(async () => {
      throw new Error('network should not run');
    });
    await expect(linear.listAssigned()).rejects.toMatchObject({
      code: 'INTEGRATION_OFFLINE',
      message: 'Add a Linear API key to import assigned issues',
    });
  });

  it('imports one canonical issue and reports the existing Board card', async () => {
    const queries: string[] = [];
    const { board, linear, secrets } = setup(async (_key, body) => {
      queries.push(body.query);
      if (body.query.includes('viewer { id }')) {
        return { status: 200, data: { viewer: { id: 'user-1' } }, errors: [] };
      }
      if (body.query.includes('assignedIssues')) {
        return {
          status: 200,
          data: { viewer: { assignedIssues: { nodes: [issueNode] } } },
          errors: [],
        };
      }
      return { status: 200, data: { issue: issueNode }, errors: [] };
    });
    await secrets.set(LINEAR_SECRET_REF, apiKey);
    const project = board.createProject('BuilderHelm', createCorrelationId());

    const first = await linear.importIssue(
      project.id,
      issueNode.url,
      createCorrelationId(),
    );
    const second = await linear.importIssue(
      project.id,
      issueNode.url,
      createCorrelationId(),
    );
    const assigned = await linear.listAssigned();

    expect(second.id).toBe(first.id);
    expect(board.listCards(project.id)).toEqual([first]);
    expect(first).toMatchObject({
      title: issueNode.title,
      detail: issueNode.description,
      source: {
        provider: 'linear',
        id: issueNode.id,
        identifier: 'ENG-41',
        number: 41,
        state: 'open',
      },
    });
    expect(assigned[0]).toMatchObject({
      importedCardId: first.id,
      importedWorkspaceId: project.id,
    });
    expect(queries.some((query) => query.includes('assignedIssues'))).toBe(true);
  });

  it('completes once per request and records an append-only receipt', async () => {
    let updates = 0;
    const { database, board, linear, secrets } = setup(async (_key, body) => {
      if (body.query.includes('issueUpdate')) {
        updates += 1;
        return { status: 200, data: { issueUpdate: { success: true } }, errors: [] };
      }
      return { status: 200, data: { issue: issueNode }, errors: [] };
    });
    await secrets.set(LINEAR_SECRET_REF, apiKey);
    const project = board.createProject('BuilderHelm', createCorrelationId());
    const card = await linear.importIssue(
      project.id,
      issueNode.url,
      createCorrelationId(),
    );
    const input = {
      cardId: card.id,
      state: 'closed' as const,
      requestId: crypto.randomUUID(),
    };

    const first = await linear.syncIssue(input, createCorrelationId());
    const replay = await linear.syncIssue(input, createCorrelationId());

    expect(updates).toBe(1);
    expect(first.receipt).toMatchObject({ outcome: 'succeeded', changed: true });
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(replay.card).toMatchObject({
      column: 'shipped',
      source: { provider: 'linear', state: 'closed' },
    });
    expect(
      database.queryOne<{ count: number }>(
        'SELECT count(*) AS count FROM linear_issue_receipts',
      ),
    ).toEqual({ count: 1 });
    expect(() =>
      database.run(`UPDATE linear_issue_receipts SET detail = 'changed'`),
    ).toThrow('Linear issue receipts are append-only');
  });
  it('records an unknown outcome instead of replaying an ambiguous write', async () => {
    let reads = 0;
    const { board, linear, secrets } = setup(async (_key, body) => {
      if (body.query.includes('issueUpdate')) {
        return { status: 500, data: null, errors: [{ message: 'server error' }] };
      }
      reads += 1;
      if (reads > 2) return Promise.reject(new Error('connection reset'));
      return { status: 200, data: { issue: issueNode }, errors: [] };
    });
    await secrets.set(LINEAR_SECRET_REF, apiKey);
    const project = board.createProject('BuilderHelm', createCorrelationId());
    const card = await linear.importIssue(
      project.id,
      issueNode.url,
      createCorrelationId(),
    );

    const result = await linear.syncIssue(
      { cardId: card.id, state: 'closed', requestId: crypto.randomUUID() },
      createCorrelationId(),
    );

    expect(result.receipt).toMatchObject({ outcome: 'outcome_unknown', changed: false });
    expect(result.card).toMatchObject({ column: 'idea', source: { state: 'open' } });
  });

  it('surfaces a rejected API key without leaking it', async () => {
    const { linear, secrets } = setup(async () => ({
      status: 401,
      data: null,
      errors: [{ message: 'Authentication failed token=secret' }],
    }));
    await secrets.set(LINEAR_SECRET_REF, apiKey);

    await expect(linear.listAssigned()).rejects.toMatchObject({
      code: 'INTEGRATION_OFFLINE',
      message: 'That Linear API key was rejected. Save a new key.',
    });
  });

  it('validates a key before storing it', async () => {
    const { linear, secrets } = setup(async () => ({
      status: 200,
      data: { viewer: { id: 'user-1' } },
      errors: [],
    }));

    await expect(linear.status()).resolves.toEqual({ configured: false });
    await expect(linear.saveKey(apiKey, createCorrelationId())).resolves.toEqual({
      configured: true,
    });
    await expect(secrets.get(LINEAR_SECRET_REF)).resolves.toBe(apiKey);
  });
});

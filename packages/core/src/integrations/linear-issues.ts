import type { BuilderHelmDatabase } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  linearApiKeySchema,
  linearIssueImportInputSchema,
  linearIssueReceiptSchema,
  linearIssueSchema,
  linearIssueSyncInputSchema,
  linearIssueSyncResultSchema,
  linearStatusSchema,
  type LinearIssue,
  type LinearIssueReceipt,
  type LinearIssueSyncInput,
  type LinearIssueSyncResult,
  type LinearStatus,
} from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createId,
  utcNow,
  type CorrelationId,
} from '@builderhelm/shared';

import type { BoardService } from '../board/board-service.js';
import type { SecretStore } from '../secrets/secret-store.js';

export const LINEAR_SECRET_REF = 'builderhelm.linear.api-key';

const linearGraphqlUrl = 'https://api.linear.app/graphql';

interface StoredLinearReceipt extends Record<string, unknown> {
  id: string;
  requestId: string;
  correlationId: string;
  cardId: string;
  issueId: string;
  issueUrl: string;
  requestedState: string;
  outcome: string;
  changed: number;
  detail: string;
  createdAt: string;
}

const receiptColumns = `
  id,
  request_id AS requestId,
  correlation_id AS correlationId,
  card_id AS cardId,
  issue_id AS issueId,
  issue_url AS issueUrl,
  requested_state AS requestedState,
  outcome,
  changed,
  detail,
  created_at AS createdAt
`;

export interface LinearGraphqlBody {
  readonly query: string;
  readonly variables?: Record<string, unknown>;
}

export interface LinearGraphqlResult {
  readonly status: number;
  readonly data: unknown;
  readonly errors: readonly { readonly message: string }[];
}

export type LinearTransport = (
  apiKey: string,
  body: LinearGraphqlBody,
) => Promise<LinearGraphqlResult>;

interface LinearStateNode {
  readonly id: string;
  readonly type: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function linearState(type: unknown): 'open' | 'closed' {
  return type === 'completed' || type === 'canceled' ? 'closed' : 'open';
}

function identifierFromUrl(url: string): string | null {
  try {
    const match = /\/issue\/([A-Z][A-Z0-9]*-\d+)/i.exec(new URL(url).pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function parseIssueNode(value: unknown): LinearIssue {
  const row = asRecord(value);
  if (row === null) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'Linear returned an invalid issue');
  }
  const state = asRecord(row.state);
  const identifier =
    typeof row.identifier === 'string' ? row.identifier.toUpperCase() : '';
  const updatedAt =
    typeof row.updatedAt === 'string' ? new Date(row.updatedAt).toISOString() : '';
  const description = typeof row.description === 'string' ? row.description : '';
  return linearIssueSchema.parse({
    id: typeof row.id === 'string' ? row.id.slice(0, 200) : row.id,
    identifier,
    title: row.title,
    body: description.slice(0, 10_000),
    url: row.url,
    state: linearState(state?.type),
    updatedAt,
    importedCardId: null,
    importedWorkspaceId: null,
  });
}

export function parseLinearIssues(nodes: unknown): LinearIssue[] {
  if (!Array.isArray(nodes)) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'Linear returned an invalid issue list',
    );
  }
  return nodes.map((node) => parseIssueNode(node));
}

function toReceipt(row: StoredLinearReceipt): LinearIssueReceipt {
  return linearIssueReceiptSchema.parse({
    id: row.id,
    requestId: row.requestId,
    correlationId: row.correlationId,
    cardId: row.cardId,
    issueId: row.issueId,
    issueUrl: row.issueUrl,
    requestedState: row.requestedState,
    outcome: row.outcome,
    changed: row.changed === 1,
    detail: row.detail,
    createdAt: row.createdAt,
  });
}

function processDetail(error: unknown): string {
  return (error instanceof Error ? error.message : 'Linear request failed').slice(0, 300);
}

function pickStateId(
  states: readonly LinearStateNode[],
  wanted: 'open' | 'closed',
): string {
  const match =
    wanted === 'closed'
      ? states.find((state) => state.type === 'completed')
      : (states.find((state) => state.type === 'unstarted') ??
        states.find((state) => state.type === 'backlog') ??
        states.find((state) => state.type === 'started'));
  if (match === undefined) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      wanted === 'closed'
        ? 'That Linear team has no completed state'
        : 'That Linear team has no open state',
    );
  }
  return match.id;
}

export async function defaultLinearTransport(
  apiKey: string,
  body: LinearGraphqlBody,
): Promise<LinearGraphqlResult> {
  const response = await fetch(linearGraphqlUrl, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = asRecord(payload);
  const errors = Array.isArray(record?.errors)
    ? record.errors.filter(
        (entry): entry is { message: string } =>
          typeof asRecord(entry)?.message === 'string',
      )
    : [];
  return {
    status: response.status,
    data: record?.data ?? null,
    errors: errors.map((entry) => ({ message: String(asRecord(entry)?.message) })),
  };
}

export class LinearIssuesService {
  constructor(
    private readonly database: BuilderHelmDatabase,
    private readonly board: BoardService,
    private readonly logger: Logger,
    private readonly secrets: SecretStore,
    private readonly transport: LinearTransport = defaultLinearTransport,
  ) {}

  async status(): Promise<LinearStatus> {
    const key = await this.secrets.get(LINEAR_SECRET_REF);
    return linearStatusSchema.parse({ configured: key !== null && key.length > 0 });
  }

  async saveKey(key: string, correlationId: CorrelationId): Promise<LinearStatus> {
    const parsed = linearApiKeySchema.parse(key);
    await this.graphql(parsed, { query: 'query { viewer { id } }' });
    await this.secrets.set(LINEAR_SECRET_REF, parsed);
    this.logger.info({
      event: 'linear.key_saved',
      correlationId,
      data: { configured: true },
    });
    return this.status();
  }

  async deleteKey(correlationId: CorrelationId): Promise<LinearStatus> {
    await this.secrets.delete(LINEAR_SECRET_REF);
    this.logger.info({
      event: 'linear.key_deleted',
      correlationId,
      data: { configured: false },
    });
    return this.status();
  }

  async listAssigned(): Promise<LinearIssue[]> {
    const data = await this.graphql(await this.requireKey(), {
      query: `query AssignedIssues {
        viewer {
          assignedIssues(
            first: 50
            filter: { state: { type: { nin: ["completed", "canceled"] } } }
          ) {
            nodes { id identifier title description url updatedAt state { type } }
          }
        }
      }`,
    });
    const viewer = asRecord(asRecord(data)?.viewer);
    const assigned = asRecord(viewer?.assignedIssues);
    return parseLinearIssues(assigned?.nodes).map((issue) => {
      const card = this.board.findLinearCard(issue.id);
      return {
        ...issue,
        importedCardId: card?.id ?? null,
        importedWorkspaceId: card?.workspace ?? null,
      };
    });
  }

  async importIssue(workspace: string, url: string, correlationId: CorrelationId) {
    const input = linearIssueImportInputSchema.parse({ workspace, url });
    const issue = await this.readIssue(input.url);
    return this.board.importLinearIssue(input.workspace, issue, correlationId);
  }

  async syncIssue(
    inputValue: LinearIssueSyncInput,
    correlationId: CorrelationId,
  ): Promise<LinearIssueSyncResult> {
    const input = linearIssueSyncInputSchema.parse(inputValue);
    const prior = this.findReceipt(input.requestId);
    if (prior !== null) {
      return linearIssueSyncResultSchema.parse({
        card: this.board.getCard(prior.cardId),
        receipt: prior,
      });
    }

    let card = this.board.getCard(input.cardId);
    const source = card.source;
    if (source?.provider !== 'linear') {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That card is not linked to Linear',
      );
    }

    let outcome: LinearIssueReceipt['outcome'] = 'succeeded';
    let changed = false;
    let detail = `Linear issue was already ${input.state}`;
    if (source.state !== input.state) {
      try {
        await this.writeState(source.id, input.state);
        outcome = 'succeeded';
        changed = true;
        detail = `Linear issue ${input.state === 'closed' ? 'completed' : 'reopened'}`;
      } catch (cause) {
        const error =
          cause instanceof BuilderHelmError
            ? cause
            : new BuilderHelmError('TOOL_EXECUTION_FAILED', processDetail(cause), {
                cause,
              });
        if (
          error.code === 'INTEGRATION_OFFLINE' ||
          error.code === 'RATE_LIMITED' ||
          error.code === 'VALIDATION_FAILED'
        ) {
          outcome = 'failed';
          detail = error.message;
        } else {
          try {
            const observed = await this.readIssue(source.url);
            if (observed.state === input.state) {
              outcome = 'succeeded';
              changed = true;
              detail = `Linear issue ${input.state === 'closed' ? 'completed' : 'reopened'}`;
            } else {
              outcome = 'failed';
              detail = `Linear kept the issue ${observed.state}`;
            }
          } catch {
            outcome = 'outcome_unknown';
            detail = 'Linear may have changed the issue; refresh before retrying';
          }
        }
      }
    }

    if (outcome === 'succeeded' && source.state !== input.state) {
      card = this.board.syncLinearIssueState(input.cardId, input.state, correlationId);
    }
    const receipt = this.recordReceipt(
      input,
      source.id,
      source.url,
      outcome,
      changed,
      detail,
      correlationId,
    );
    this.logger.info({
      event: 'linear.issue_sync',
      correlationId,
      data: {
        cardId: input.cardId,
        requestedState: input.state,
        outcome,
        receiptId: receipt.id,
      },
    });
    return linearIssueSyncResultSchema.parse({ card, receipt });
  }

  private async readIssue(url: string): Promise<LinearIssue> {
    const identifier = identifierFromUrl(url);
    if (identifier === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That is not a Linear issue URL');
    }
    const data = await this.graphql(await this.requireKey(), {
      query: `query Issue($id: String!) {
        issue(id: $id) {
          id identifier title description url updatedAt state { type }
        }
      }`,
      variables: { id: identifier },
    });
    const issue = asRecord(data)?.issue;
    if (issue === null || issue === undefined) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That Linear issue no longer exists',
      );
    }
    return parseIssueNode(issue);
  }

  private async writeState(issueId: string, state: 'open' | 'closed'): Promise<void> {
    const data = await this.graphql(await this.requireKey(), {
      query: `query IssueStates($id: String!) {
        issue(id: $id) {
          id
          state { type }
          team { states { nodes { id type } } }
        }
      }`,
      variables: { id: issueId },
    });
    const issue = asRecord(asRecord(data)?.issue);
    if (issue === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That Linear issue no longer exists',
      );
    }
    if (linearState(asRecord(issue.state)?.type) === state) return;
    const team = asRecord(issue.team);
    const states = asRecord(team?.states);
    const nodes = Array.isArray(states?.nodes) ? states.nodes : [];
    const parsed = nodes.flatMap((node) => {
      const row = asRecord(node);
      if (row === null || typeof row.id !== 'string' || typeof row.type !== 'string') {
        return [];
      }
      return [{ id: row.id, type: row.type }];
    });
    const stateId = pickStateId(parsed, state);
    await this.graphql(await this.requireKey(), {
      query: `mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }`,
      variables: { id: issueId, stateId },
    });
  }

  private findReceipt(requestId: string): LinearIssueReceipt | null {
    const row = this.database.queryOne<StoredLinearReceipt>(
      `SELECT ${receiptColumns} FROM linear_issue_receipts WHERE request_id = ?`,
      [requestId],
    );
    return row === undefined ? null : toReceipt(row);
  }

  private recordReceipt(
    input: LinearIssueSyncInput,
    issueId: string,
    issueUrl: string,
    outcome: LinearIssueReceipt['outcome'],
    changed: boolean,
    detail: string,
    correlationId: CorrelationId,
  ): LinearIssueReceipt {
    const receipt = linearIssueReceiptSchema.parse({
      id: createId(),
      requestId: input.requestId,
      correlationId,
      cardId: input.cardId,
      issueId,
      issueUrl,
      requestedState: input.state,
      outcome,
      changed,
      detail: detail.slice(0, 500),
      createdAt: utcNow(),
    });
    this.database.run(
      `INSERT INTO linear_issue_receipts (
         id, request_id, correlation_id, card_id, issue_id, issue_url,
         requested_state, outcome, changed, detail, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.id,
        receipt.requestId,
        receipt.correlationId,
        receipt.cardId,
        receipt.issueId,
        receipt.issueUrl,
        receipt.requestedState,
        receipt.outcome,
        receipt.changed ? 1 : 0,
        receipt.detail,
        receipt.createdAt,
      ],
    );
    return receipt;
  }

  private async requireKey(): Promise<string> {
    const key = await this.secrets.get(LINEAR_SECRET_REF);
    if (key === null || key.length === 0) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Add a Linear API key to import assigned issues',
      );
    }
    return key;
  }

  private async graphql(
    apiKey: string,
    body: LinearGraphqlBody,
  ): Promise<Record<string, unknown>> {
    let result: LinearGraphqlResult;
    try {
      result = await this.transport(apiKey, body);
    } catch (cause) {
      throw new BuilderHelmError('INTEGRATION_OFFLINE', 'Linear could not be reached', {
        cause,
        retryable: true,
      });
    }
    const message = result.errors[0]?.message ?? '';
    if (result.status === 401 || /authenticat|unauthorized|invalid api/i.test(message)) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'That Linear API key was rejected. Save a new key.',
      );
    }
    if (result.status === 429 || /rate limit/i.test(message)) {
      throw new BuilderHelmError('RATE_LIMITED', 'Linear rate limit reached', {
        retryable: true,
      });
    }
    if (result.status >= 400 || message.length > 0) {
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        (message || `Linear request failed (${result.status})`).slice(0, 300),
      );
    }
    const data = asRecord(result.data);
    if (data === null) {
      throw new BuilderHelmError('TOOL_EXECUTION_FAILED', 'Linear returned no data');
    }
    return data;
  }
}

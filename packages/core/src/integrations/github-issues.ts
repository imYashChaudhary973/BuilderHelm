import { homedir } from 'node:os';

import type { BuilderHelmDatabase } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  githubIssueImportInputSchema,
  githubIssueReceiptSchema,
  githubIssueSchema,
  githubIssueSyncInputSchema,
  githubIssueSyncResultSchema,
  type GitHubIssue,
  type GitHubIssueReceipt,
  type GitHubIssueSyncInput,
  type GitHubIssueSyncResult,
} from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createId,
  utcNow,
  type CorrelationId,
} from '@builderhelm/shared';

import type { BoardService } from '../board/board-service.js';
import { defaultGhRunner, type GhRunner } from '../projects/git-review.js';

interface StoredGitHubReceipt extends Record<string, unknown> {
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

function processDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const stderr =
      'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    if (stderr.length > 0) return stderr;
    const stdout =
      'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
    if (stdout.length > 0) return stdout;
  }
  return error instanceof Error ? error.message : 'GitHub CLI failed';
}

function missingExecutable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function repositoryFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2] !== 'issues') return null;
    const repository = `${parts[0]}/${parts[1]}`;
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : null;
  } catch {
    return null;
  }
}

function repositoryFromRow(row: Record<string, unknown>): string | null {
  const repository = row.repository;
  if (
    typeof repository === 'object' &&
    repository !== null &&
    'nameWithOwner' in repository &&
    typeof repository.nameWithOwner === 'string'
  ) {
    return repository.nameWithOwner;
  }
  return repositoryFromUrl(row.url);
}

function parseIssueRow(value: unknown): GitHubIssue {
  if (typeof value !== 'object' || value === null) {
    throw new BuilderHelmError(
      'TOOL_EXECUTION_FAILED',
      'GitHub returned an invalid issue',
    );
  }
  const row = value as Record<string, unknown>;
  const repository = repositoryFromRow(row);
  return githubIssueSchema.parse({
    id: typeof row.id === 'string' ? row.id.slice(0, 200) : row.id,
    repository,
    number: row.number,
    title: typeof row.title === 'string' ? row.title.slice(0, 200) : row.title,
    body: typeof row.body === 'string' ? row.body.slice(0, 10_000) : '',
    url: typeof row.url === 'string' ? row.url.slice(0, 2_048) : row.url,
    state: typeof row.state === 'string' ? row.state.toLowerCase() : row.state,
    updatedAt: row.updatedAt,
    importedCardId: null,
    importedWorkspaceId: null,
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new BuilderHelmError(
      'TOOL_EXECUTION_FAILED',
      'GitHub returned unreadable issue data',
      { cause },
    );
  }
}

export function parseGitHubIssues(raw: string): GitHubIssue[] {
  const parsed = parseJson(raw.length === 0 ? '[]' : raw);
  if (!Array.isArray(parsed)) {
    throw new BuilderHelmError(
      'TOOL_EXECUTION_FAILED',
      'GitHub returned an invalid issue list',
    );
  }
  return parsed.slice(0, 100).map(parseIssueRow);
}

function toReceipt(row: StoredGitHubReceipt): GitHubIssueReceipt {
  return githubIssueReceiptSchema.parse({
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

export class GitHubIssuesService {
  constructor(
    private readonly database: BuilderHelmDatabase,
    private readonly board: BoardService,
    private readonly logger: Logger,
    private readonly runGh: GhRunner = defaultGhRunner,
  ) {}

  async listAssigned(): Promise<GitHubIssue[]> {
    const raw = await this.gh([
      'search',
      'issues',
      '--assignee',
      '@me',
      '--state',
      'open',
      '--sort',
      'updated',
      '--order',
      'desc',
      '--limit',
      '100',
      '--json',
      'id,number,title,url,state,updatedAt,repository',
    ]);
    return parseGitHubIssues(raw).map((issue) => {
      const card = this.board.findGitHubCard(issue.id);
      return {
        ...issue,
        importedCardId: card?.id ?? null,
        importedWorkspaceId: card?.workspace ?? null,
      };
    });
  }

  async importIssue(workspace: string, url: string, correlationId: CorrelationId) {
    const input = githubIssueImportInputSchema.parse({ workspace, url });
    const issue = await this.readIssue(input.url);
    return this.board.importGitHubIssue(input.workspace, issue, correlationId);
  }

  async syncIssue(
    inputValue: GitHubIssueSyncInput,
    correlationId: CorrelationId,
  ): Promise<GitHubIssueSyncResult> {
    const input = githubIssueSyncInputSchema.parse(inputValue);
    const prior = this.findReceipt(input.requestId);
    if (prior !== null) {
      return githubIssueSyncResultSchema.parse({
        card: this.board.getCard(prior.cardId),
        receipt: prior,
      });
    }

    let card = this.board.getCard(input.cardId);
    const source = card.source;
    if (source?.provider !== 'github') {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That card is not linked to GitHub',
      );
    }

    let outcome: GitHubIssueReceipt['outcome'] = 'succeeded';
    let changed = false;
    let detail = `GitHub issue was already ${input.state}`;
    if (source.state !== input.state) {
      try {
        await this.gh([
          'issue',
          input.state === 'closed' ? 'close' : 'reopen',
          source.url,
        ]);
        outcome = 'succeeded';
        changed = true;
        detail = `GitHub issue ${input.state === 'closed' ? 'closed' : 'reopened'}`;
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
              detail = `GitHub issue ${input.state === 'closed' ? 'closed' : 'reopened'}`;
            } else {
              outcome = 'failed';
              detail = `GitHub kept the issue ${observed.state}`;
            }
          } catch {
            outcome = 'outcome_unknown';
            detail = 'GitHub may have changed the issue; refresh before retrying';
          }
        }
      }
    }

    if (outcome === 'succeeded' && source.state !== input.state) {
      card = this.board.syncGitHubIssueState(input.cardId, input.state, correlationId);
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
      event: 'github.issue_sync',
      correlationId,
      data: {
        cardId: input.cardId,
        requestedState: input.state,
        outcome,
        receiptId: receipt.id,
      },
    });
    return githubIssueSyncResultSchema.parse({ card, receipt });
  }

  private async readIssue(url: string): Promise<GitHubIssue> {
    const raw = await this.gh([
      'issue',
      'view',
      url,
      '--json',
      'id,number,title,body,url,state,updatedAt',
    ]);
    return parseIssueRow(parseJson(raw));
  }

  private findReceipt(requestId: string): GitHubIssueReceipt | null {
    const row = this.database.queryOne<StoredGitHubReceipt>(
      `SELECT ${receiptColumns} FROM github_issue_receipts WHERE request_id = ?`,
      [requestId],
    );
    return row === undefined ? null : toReceipt(row);
  }

  private recordReceipt(
    input: GitHubIssueSyncInput,
    issueId: string,
    issueUrl: string,
    outcome: GitHubIssueReceipt['outcome'],
    changed: boolean,
    detail: string,
    correlationId: CorrelationId,
  ): GitHubIssueReceipt {
    const receipt = githubIssueReceiptSchema.parse({
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
      `INSERT INTO github_issue_receipts (
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

  private async gh(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await this.runGh(homedir(), args);
      return stdout;
    } catch (cause) {
      if (missingExecutable(cause)) {
        throw new BuilderHelmError(
          'INTEGRATION_OFFLINE',
          'Install the GitHub CLI (gh) to import assigned issues',
          { cause },
        );
      }
      const detail = processDetail(cause);
      if (
        /not logged into|gh auth login|authentication failed|bad credentials|http 401/i.test(
          detail,
        )
      ) {
        throw new BuilderHelmError(
          'INTEGRATION_OFFLINE',
          'Run `gh auth login` to let BuilderHelm read GitHub.',
          { cause },
        );
      }
      if (/rate limit|http 429/i.test(detail)) {
        throw new BuilderHelmError('RATE_LIMITED', 'GitHub rate limit reached', {
          cause,
          retryable: true,
        });
      }
      if (/could not resolve to an issue|issue not found|http 404/i.test(detail)) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'That GitHub issue no longer exists',
          {
            cause,
          },
        );
      }
      throw new BuilderHelmError('TOOL_EXECUTION_FAILED', detail.slice(0, 300), {
        cause,
        retryable: false,
      });
    }
  }
}

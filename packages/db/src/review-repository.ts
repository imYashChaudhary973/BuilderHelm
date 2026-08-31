import type { BuilderHelmDatabase } from './database.js';

export interface ReviewCommentWrite {
  readonly id: string;
  readonly rootPath: string;
  readonly headSha: string;
  readonly path: string;
  readonly side: 'old' | 'new';
  readonly line: number;
  readonly body: string;
  readonly runId: string | null;
  readonly seatId: string | null;
  readonly createdAt: string;
}

export interface ReviewCheckWrite {
  readonly id: string;
  readonly rootPath: string;
  readonly headSha: string;
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly output: string;
  readonly startedAt: string;
  readonly endedAt: string;
}

interface StoredReviewComment extends Record<string, unknown> {
  id: string;
  root_path: string;
  head_sha: string;
  path: string;
  side: 'old' | 'new';
  line: number;
  body: string;
  run_id: string | null;
  seat_id: string | null;
  created_at: string;
}

interface StoredReviewCheck extends Record<string, unknown> {
  id: string;
  root_path: string;
  head_sha: string;
  command_json: string;
  exit_code: number;
  output: string;
  started_at: string;
  ended_at: string;
}

function toComment(row: StoredReviewComment): ReviewCommentWrite {
  return {
    id: row.id,
    rootPath: row.root_path,
    headSha: row.head_sha,
    path: row.path,
    side: row.side,
    line: row.line,
    body: row.body,
    runId: row.run_id,
    seatId: row.seat_id,
    createdAt: row.created_at,
  };
}

function toCheck(row: StoredReviewCheck): ReviewCheckWrite {
  const parsed: unknown = JSON.parse(row.command_json);
  const command = Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: row.id,
    rootPath: row.root_path,
    headSha: row.head_sha,
    command,
    exitCode: row.exit_code,
    output: row.output,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export class ReviewRepository {
  constructor(private readonly database: BuilderHelmDatabase) {}

  insertComment(comment: ReviewCommentWrite): void {
    this.database.run(
      `INSERT INTO review_comments (
         id, root_path, head_sha, path, side, line, body, run_id, seat_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        comment.id,
        comment.rootPath,
        comment.headSha,
        comment.path,
        comment.side,
        comment.line,
        comment.body,
        comment.runId,
        comment.seatId,
        comment.createdAt,
      ],
    );
  }

  listComments(rootPath: string, path?: string): ReviewCommentWrite[] {
    if (path === undefined) {
      return this.database
        .queryAll<StoredReviewComment>(
          `SELECT * FROM review_comments WHERE root_path = ?
           ORDER BY created_at ASC LIMIT 500`,
          [rootPath],
        )
        .map(toComment);
    }
    return this.database
      .queryAll<StoredReviewComment>(
        `SELECT * FROM review_comments WHERE root_path = ? AND path = ?
         ORDER BY created_at ASC LIMIT 500`,
        [rootPath, path],
      )
      .map(toComment);
  }

  insertCheck(check: ReviewCheckWrite): void {
    this.database.run(
      `INSERT INTO review_checks (
         id, root_path, head_sha, command_json, exit_code, output, started_at, ended_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        check.id,
        check.rootPath,
        check.headSha,
        JSON.stringify(check.command),
        check.exitCode,
        check.output,
        check.startedAt,
        check.endedAt,
      ],
    );
  }

  listChecks(rootPath: string): ReviewCheckWrite[] {
    return this.database
      .queryAll<StoredReviewCheck>(
        `SELECT * FROM review_checks WHERE root_path = ?
         ORDER BY ended_at DESC LIMIT 100`,
        [rootPath],
      )
      .map(toCheck);
  }
}

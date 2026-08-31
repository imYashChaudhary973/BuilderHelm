import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import type { ReviewRepository } from '@builderhelm/db';
import type {
  ReviewCheck,
  ReviewCiCheck,
  ReviewComment,
  ReviewDiffFile,
  ReviewDiffHunk,
  ReviewDiffLine,
  ReviewLandInspect,
  ReviewPr,
} from '@builderhelm/protocol/review';
import { createId, utcNow, BuilderHelmError } from '@builderhelm/shared';

const execFileAsync = promisify(execFile);

const gitOptions = {
  encoding: 'utf8' as const,
  timeout: 20_000,
  maxBuffer: 2_000_000,
  windowsHide: true,
};

export interface ReviewDiffQuery {
  readonly root: string;
  readonly path?: string | undefined;
  readonly base?: string | undefined;
  readonly head?: string | undefined;
}

export interface ReviewCommentDraft {
  readonly root: string;
  readonly path: string;
  readonly side: 'old' | 'new';
  readonly line: number;
  readonly body: string;
  readonly runId?: string | null | undefined;
  readonly seatId?: string | null | undefined;
}
/** Parse `git diff` unified output into file/hunk/line records. */
export function parseUnifiedDiff(raw: string): ReviewDiffFile[] {
  const files: ReviewDiffFile[] = [];
  let current: { path: string; hunks: ReviewDiffHunk[] } | null = null;
  let hunk: ReviewDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flush = (): void => {
    if (current !== null) {
      files.push({ path: current.path, hunks: current.hunks });
    }
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = { path: match?.[2] ?? 'unknown', hunks: [] };
      hunk = null;
      continue;
    }
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch !== null && current !== null) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      hunk = {
        header: line.slice(0, 200),
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk === null || current === null) continue;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      hunk.lines.push(diffLine('add', null, newLine, line.slice(1)));
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      hunk.lines.push(diffLine('del', oldLine, null, line.slice(1)));
      oldLine += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      hunk.lines.push(diffLine('ctx', oldLine, newLine, line.slice(1)));
      oldLine += 1;
      newLine += 1;
    }
  }
  flush();
  return files.slice(0, 200);
}

function diffLine(
  type: ReviewDiffLine['type'],
  oldLine: number | null,
  newLine: number | null,
  text: string,
): ReviewDiffLine {
  return { type, oldLine, newLine, text: text.slice(0, 4_000) };
}

function failedProcessOutput(error: unknown): { exitCode: number; output: string } {
  if (typeof error !== 'object' || error === null) {
    return { exitCode: 1, output: 'Check failed' };
  }
  const exitCode = 'code' in error && typeof error.code === 'number' ? error.code : 1;
  const stdout =
    'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
  const stderr =
    'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  const combined = `${stdout}${stderr}`.trim();
  if (combined.length > 0) return { exitCode, output: combined };
  const message = error instanceof Error ? error.message : 'Check failed';
  return { exitCode, output: message };
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function gitDetail(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.trim().length > 0
  ) {
    return error.stderr.trim();
  }
  return error instanceof Error ? error.message : 'Git failed';
}

function readGhChecks(raw: string): ReviewCiCheck[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.length === 0 ? '[]' : raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const checks: ReviewCiCheck[] = [];
  for (const row of parsed.slice(0, 100)) {
    if (typeof row !== 'object' || row === null || !('name' in row)) continue;
    if (typeof row.name !== 'string' || row.name.length === 0) continue;
    const state =
      'state' in row && typeof row.state === 'string'
        ? row.state.slice(0, 40)
        : 'unknown';
    const url =
      'link' in row && typeof row.link === 'string' ? row.link.slice(0, 2_000) : null;
    checks.push({ name: row.name.slice(0, 200), state, url });
  }
  return checks;
}

export class GitReviewService {
  constructor(private readonly repository: ReviewRepository) {}

  async diff(query: ReviewDiffQuery): Promise<ReviewDiffFile[]> {
    const root = await this.resolveRoot(query.root);
    const args = ['diff', '--no-color', '--no-ext-diff', '--find-renames'];
    if (query.base !== undefined && query.head !== undefined) {
      args.push(`${query.base}...${query.head}`);
    } else {
      args.push('HEAD');
    }
    if (query.path !== undefined) {
      args.push('--', this.relativeToRoot(root, query.path));
    }
    return parseUnifiedDiff(await this.git(root, args, true));
  }

  async addComment(draft: ReviewCommentDraft): Promise<ReviewComment> {
    const root = await this.resolveRoot(draft.root);
    const path = this.relativeToRoot(root, draft.path);
    const headSha = (await this.git(root, ['rev-parse', 'HEAD'])).trim();
    const comment: ReviewComment = {
      id: createId(),
      rootPath: root,
      headSha,
      path,
      side: draft.side,
      line: draft.line,
      body: draft.body.trim(),
      runId: draft.runId ?? null,
      seatId: draft.seatId ?? null,
      createdAt: utcNow(),
    };
    this.repository.insertComment(comment);
    return comment;
  }

  async listComments(root: string, path?: string): Promise<ReviewComment[]> {
    const resolved = await this.resolveRoot(root);
    const relativePath =
      path === undefined ? undefined : this.relativeToRoot(resolved, path);
    return this.repository.listComments(resolved, relativePath);
  }

  async runCheck(root: string, command: readonly string[]): Promise<ReviewCheck> {
    const resolved = await this.resolveRoot(root);
    const headSha = (await this.git(resolved, ['rev-parse', 'HEAD'])).trim();
    const executable = command[0];
    if (executable === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Check command is empty');
    }
    const startedAt = utcNow();
    let exitCode = 0;
    let output = '';
    try {
      const result = await execFileAsync(executable, command.slice(1), {
        cwd: resolved,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1_000_000,
        windowsHide: true,
      });
      output = `${result.stdout}${result.stderr}`;
    } catch (error) {
      const failed = failedProcessOutput(error);
      exitCode = failed.exitCode;
      output = failed.output;
    }
    const check: ReviewCheck = {
      id: createId(),
      rootPath: resolved,
      headSha,
      command: [...command],
      exitCode,
      output: output.slice(0, 32_000),
      startedAt,
      endedAt: utcNow(),
    };
    this.repository.insertCheck(check);
    return check;
  }
  async listChecks(root: string): Promise<ReviewCheck[]> {
    return this.repository.listChecks(await this.resolveRoot(root)).map((check) => ({
      ...check,
      command: [...check.command],
    }));
  }

  async draftPr(
    root: string,
    title: string,
    body: string,
    base?: string,
  ): Promise<ReviewPr> {
    const resolved = await this.resolveRoot(root);
    const head = (await this.git(resolved, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const upstream = (
      await this.git(resolved, ['rev-parse', '--abbrev-ref', 'HEAD@{upstream}'], true)
    )
      .trim()
      .replace(/^[^/]+\//, '');
    const baseBranch = base ?? (upstream.length > 0 ? upstream : 'main');
    const url = await this.gh(
      resolved,
      [
        'pr',
        'create',
        '--draft',
        '--title',
        title,
        '--body',
        body,
        '--base',
        baseBranch,
        '--head',
        head,
      ],
      'Install the GitHub CLI (gh) to draft pull requests',
    );
    const lastLine = url.trim().split('\n').at(-1);
    return {
      title,
      body,
      base: baseBranch,
      head,
      url: lastLine === undefined || lastLine.length === 0 ? null : lastLine,
      draft: true,
    };
  }

  async ci(root: string): Promise<ReviewCiCheck[]> {
    const resolved = await this.resolveRoot(root);
    const raw = await this.gh(
      resolved,
      ['pr', 'checks', '--json', 'name,state,link'],
      'Install the GitHub CLI (gh) to read CI status',
    );
    return readGhChecks(raw);
  }

  async inspectLand(
    root: string,
    branch: string,
    reviewedHead: string,
  ): Promise<ReviewLandInspect> {
    const resolved = await this.resolveRoot(root);
    const base = (await this.git(resolved, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const headSha = (await this.git(resolved, ['rev-parse', branch])).trim();
    const ahead = Number.parseInt(
      (await this.git(resolved, ['rev-list', '--count', `${base}..${branch}`])).trim(),
      10,
    );
    const behind = Number.parseInt(
      (await this.git(resolved, ['rev-list', '--count', `${branch}..${base}`])).trim(),
      10,
    );
    const unmergedRaw = await this.git(
      resolved,
      ['diff', '--name-only', '--diff-filter=U'],
      true,
    );
    const unmerged = unmergedRaw.trim() === '' ? [] : unmergedRaw.trim().split('\n');
    const kind =
      headSha !== reviewedHead
        ? 'headMoved'
        : unmerged.length > 0
          ? 'unmerged'
          : behind > 0
            ? 'diverged'
            : 'clean';
    return {
      branch,
      base,
      headSha,
      reviewedHead,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
      unmerged,
      kind,
    };
  }

  private async resolveRoot(selectedPath: string): Promise<string> {
    let selectedRoot: string;
    try {
      selectedRoot = await realpath(selectedPath);
    } catch (cause) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The selected folder is unavailable',
        { cause },
      );
    }
    const toplevel = (
      await this.git(selectedRoot, ['rev-parse', '--show-toplevel'])
    ).trim();
    return realpath(toplevel);
  }

  private relativeToRoot(root: string, path: string): string {
    const absolute = path.startsWith(root) ? path : resolve(root, path);
    const rel = relative(root, absolute);
    if (rel.startsWith('..') || rel.length === 0) {
      throw new BuilderHelmError('PERMISSION_DENIED', 'Path is outside the workspace');
    }
    return rel.split(sep).join('/');
  }

  private async git(
    cwd: string,
    args: readonly string[],
    allowEmpty = false,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...args], { ...gitOptions, cwd });
      return stdout;
    } catch (cause) {
      if (allowEmpty) return '';
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        gitDetail(cause).slice(0, 300),
        {
          cause,
        },
      );
    }
  }

  private async gh(
    cwd: string,
    args: readonly string[],
    missing: string,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync('gh', [...args], {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1_000_000,
        windowsHide: true,
      });
      return stdout;
    } catch (cause) {
      if (isMissingExecutable(cause)) {
        throw new BuilderHelmError('INTEGRATION_OFFLINE', missing, { cause });
      }
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        gitDetail(cause).slice(0, 300),
        {
          cause,
        },
      );
    }
  }
}

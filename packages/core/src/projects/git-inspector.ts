import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';

import { gitCommitSchema, type GitCommit } from '@builderhelm/protocol/projects';
import { BuilderHelmError } from '@builderhelm/shared';

export interface GitSnapshot {
  readonly rootPath: string;
  readonly directoryName: string;
  readonly branch: string;
  readonly headSha: string;
  readonly detached: boolean;
  readonly upstream: string | null;
  readonly dirtyCount: number;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly commitTotal: number;
  readonly commits: readonly GitCommit[];
  /** Selectable base refs: local branches first, then remote-tracking ones. */
  readonly branches: readonly string[];
}

export interface GitInspector {
  inspect(selectedPath: string, base?: string | null): GitSnapshot;
}

const gitOptions = {
  encoding: 'utf8' as const,
  timeout: 10_000,
  maxBuffer: 2_000_000,
  windowsHide: true,
};

function runGit(rootPath: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { ...gitOptions, cwd: rootPath }).trim();
  } catch (cause) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'The selected folder is not an available Git repository',
      { cause },
    );
  }
}

function bounded(value: string, maximum: number, fallback: string): string {
  const clean = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim();
  return clean.length === 0 ? fallback : clean.slice(0, maximum);
}

const COMMIT_LIMIT = 50;
/** Field and record separators no commit subject can contain. */
const FIELD = '\u001f';
const RECORD = '\u001e';

/**
 * One `git log` for the whole list.
 *
 * This used to run `git log` for the hashes and then a `git show` per commit —
 * 31 processes for 30 commits, on every panel refresh. A single call with
 * explicit separators returns the same fields.
 */
function readCommits(rootPath: string, base: string | null): GitCommit[] {
  const format = `--format=%H${FIELD}%h${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`;
  // With a base, the list is what HEAD adds on top of it. `--` ends option
  // parsing so a ref can never be read as a flag.
  const raw =
    base === null
      ? runGit(rootPath, ['log', '-n', String(COMMIT_LIMIT), format])
      : runGit(rootPath, [
          'log',
          '-n',
          String(COMMIT_LIMIT),
          format,
          `${base}..HEAD`,
          '--',
        ]);
  const commits: GitCommit[] = [];
  for (const record of raw.split(RECORD)) {
    const row = record.trim();
    if (row.length === 0) continue;
    const [sha, shortSha, authorName, authoredAt, subject] = row.split(FIELD);
    if (sha === undefined || !/^[0-9a-f]{40,64}$/.test(sha)) continue;
    const when = new Date(authoredAt ?? '');
    commits.push(
      gitCommitSchema.parse({
        sha,
        shortSha: shortSha ?? sha.slice(0, 7),
        authorName: bounded(authorName ?? '', 200, 'Unknown author'),
        authoredAt: (Number.isNaN(when.getTime()) ? new Date(0) : when).toISOString(),
        subject: bounded(subject ?? '', 500, 'Untitled commit'),
      }),
    );
  }
  return commits;
}

/**
 * Local branches first, then remote-tracking ones, so the base-ref picker opens
 * on the names a reviewer most likely wants. Detached HEAD appears in
 * `git branch` output as `(HEAD detached at …)`, which the ref filter drops.
 */
function readBranches(rootPath: string): string[] {
  const names: string[] = [];
  for (const pattern of ['refs/heads', 'refs/remotes']) {
    try {
      const raw = execFileSync(
        'git',
        ['for-each-ref', '--format=%(refname:short)', '--count=100', pattern],
        { ...gitOptions, cwd: rootPath, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      for (const line of raw.split('\n')) {
        const name = line.trim();
        // Matches gitRefSchema in the protocol, and skips `origin/HEAD`.
        if (!/^[A-Za-z0-9._/-]+$/.test(name)) continue;
        if (name.endsWith('/HEAD') || names.includes(name)) continue;
        names.push(name);
      }
    } catch {
      // A repository with no refs of that kind contributes none.
    }
  }
  return names.slice(0, 200);
}

export class LocalGitInspector implements GitInspector {
  inspect(selectedPath: string, base: string | null = null): GitSnapshot {
    let selectedRoot: string;
    try {
      selectedRoot = realpathSync.native(selectedPath);
    } catch (cause) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The selected folder is unavailable',
        {
          cause,
        },
      );
    }

    const rootPath = realpathSync.native(
      runGit(selectedRoot, ['rev-parse', '--show-toplevel']),
    );
    const headSha = runGit(rootPath, ['rev-parse', 'HEAD']);
    if (!/^[0-9a-f]{40,64}$/.test(headSha)) {
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        'Git returned an invalid HEAD revision',
      );
    }
    const branchValue = runGit(rootPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch =
      branchValue === 'HEAD' ? `detached@${headSha.slice(0, 8)}` : branchValue;
    const status = runGit(rootPath, [
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
    ]);

    let aheadCount = 0;
    let behindCount = 0;
    try {
      const counts = execFileSync(
        'git',
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        { ...gitOptions, cwd: rootPath, stdio: ['ignore', 'pipe', 'ignore'] },
      )
        .trim()
        .split(/\s+/)
        .map(Number);
      behindCount = Number.isSafeInteger(counts[0]) ? counts[0]! : 0;
      aheadCount = Number.isSafeInteger(counts[1]) ? counts[1]! : 0;
    } catch {
      // A local-only branch has no upstream; this is valid and reports zero divergence.
    }
    // Named separately from ahead/behind: the panel prints "→ origin/main", and
    // a branch can track a remote while being exactly level with it.
    let upstream: string | null = null;
    try {
      const value = execFileSync(
        'git',
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        { ...gitOptions, cwd: rootPath, stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      upstream = value.length === 0 ? null : bounded(value, 255, 'unknown');
    } catch {
      // Local-only branch, or detached HEAD. Both report no upstream.
    }

    let commitTotal = 0;
    try {
      const value = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        ...gitOptions,
        cwd: rootPath,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const parsed = Number(value);
      commitTotal = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      // An empty repository has no reachable commits.
    }

    return {
      rootPath,
      directoryName: bounded(basename(rootPath), 255, 'Repository'),
      branch: bounded(branch, 255, 'unknown'),
      headSha,
      detached: branchValue === 'HEAD',
      upstream,
      dirtyCount: status.length === 0 ? 0 : status.split('\n').length,
      aheadCount,
      behindCount,
      commitTotal,
      commits: readCommits(rootPath, base),
      branches: readBranches(rootPath),
    };
  }
}

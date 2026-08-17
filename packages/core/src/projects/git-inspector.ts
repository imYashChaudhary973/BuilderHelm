import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';

import { gitCommitSchema, type GitCommit } from '@zero/protocol/projects';
import { ZeroError } from '@zero/shared';

export interface GitSnapshot {
  readonly rootPath: string;
  readonly directoryName: string;
  readonly branch: string;
  readonly headSha: string;
  readonly dirtyCount: number;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly commits: readonly GitCommit[];
}

export interface GitInspector {
  inspect(selectedPath: string): GitSnapshot;
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
    throw new ZeroError(
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

function readCommits(rootPath: string): GitCommit[] {
  const hashes = runGit(rootPath, ['log', '-n', '30', '--format=%H'])
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-f]{40,64}$/.test(value));

  return hashes.map((hash) => {
    const [sha, shortSha, authorName, authoredAt, ...subjectParts] = runGit(rootPath, [
      'show',
      '-s',
      '--format=%H%n%h%n%an%n%aI%n%s',
      hash,
    ]).split('\n');
    return gitCommitSchema.parse({
      sha,
      shortSha,
      authorName: bounded(authorName ?? '', 200, 'Unknown author'),
      authoredAt: new Date(authoredAt ?? '').toISOString(),
      subject: bounded(subjectParts.join(' '), 500, 'Untitled commit'),
    });
  });
}

export class LocalGitInspector implements GitInspector {
  inspect(selectedPath: string): GitSnapshot {
    let selectedRoot: string;
    try {
      selectedRoot = realpathSync.native(selectedPath);
    } catch (cause) {
      throw new ZeroError('VALIDATION_FAILED', 'The selected folder is unavailable', {
        cause,
      });
    }

    const rootPath = realpathSync.native(
      runGit(selectedRoot, ['rev-parse', '--show-toplevel']),
    );
    const headSha = runGit(rootPath, ['rev-parse', 'HEAD']);
    if (!/^[0-9a-f]{40,64}$/.test(headSha)) {
      throw new ZeroError(
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

    return {
      rootPath,
      directoryName: bounded(basename(rootPath), 255, 'Repository'),
      branch: bounded(branch, 255, 'unknown'),
      headSha,
      dirtyCount: status.length === 0 ? 0 : status.split('\n').length,
      aheadCount,
      behindCount,
      commits: readCommits(rootPath),
    };
  }
}

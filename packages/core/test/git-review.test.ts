import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  migrations,
  openDatabase,
  ReviewRepository,
  runMigrations,
} from '@builderhelm/db';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GitReviewService,
  parseUnifiedDiff,
  type GhRunner,
} from '../src/projects/git-review.js';

const directories: string[] = [];
const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'builderhelm-review-git-'));
  directories.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  writeFileSync(join(root, 'note.md'), 'hello\nworld\n');
  execFileSync('git', ['add', 'note.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'start'], { cwd: root });
  return root;
}

function service(gh?: GhRunner): { review: GitReviewService; repo: string } {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  return {
    review: new GitReviewService(new ReviewRepository(database), gh),
    repo: createRepo(),
  };
}

/** Replays canned `gh` output keyed by the subcommand under test. */
function fakeGh(replies: Record<string, string | Error>): GhRunner {
  return (_cwd, args) => {
    const key = args.slice(0, 2).join(' ');
    const reply = replies[key];
    if (reply === undefined) throw new Error(`unexpected gh call: ${args.join(' ')}`);
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({ stdout: reply });
  };
}

describe('parseUnifiedDiff', () => {
  it('reads added and removed lines with numbers', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/note.md b/note.md',
        '--- a/note.md',
        '+++ b/note.md',
        '@@ -1,2 +1,2 @@',
        ' hello',
        '-world',
        '+there',
        '',
      ].join('\n'),
    );
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('note.md');
    const types = files[0]?.hunks[0]?.lines.map((line) => line.type);
    expect(types).toEqual(['ctx', 'del', 'add']);
    expect(files[0]?.hunks[0]?.lines[1]).toMatchObject({
      type: 'del',
      oldLine: 2,
      newLine: null,
      text: 'world',
    });
    expect(files[0]?.hunks[0]?.lines[2]).toMatchObject({
      type: 'add',
      oldLine: null,
      newLine: 2,
      text: 'there',
    });
  });
});

describe('GitReviewService', () => {
  it('diffs a working tree change against HEAD', async () => {
    const { review, repo } = service();
    writeFileSync(join(repo, 'note.md'), 'hello\nthere\n');
    const files = await review.diff({ root: repo, path: 'note.md' });
    expect(files[0]?.path).toBe('note.md');
    expect(files[0]?.hunks[0]?.lines.some((line) => line.type === 'add')).toBe(true);
  });

  it('stores a line comment against the current HEAD', async () => {
    const { review, repo } = service();
    const comment = await review.addComment({
      root: repo,
      path: 'note.md',
      side: 'new',
      line: 2,
      body: 'rename this',
    });
    expect(comment.path).toBe('note.md');
    expect(comment.body).toBe('rename this');
    expect(comment.headSha).toMatch(/^[0-9a-f]{40}$/);
    const listed = await review.listComments(repo, 'note.md');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(comment.id);
  });

  it('records check command, exit, output, and revision', async () => {
    const { review, repo } = service();
    const passing = await review.runCheck(repo, [
      'git',
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);
    expect(passing.exitCode).toBe(0);
    expect(passing.output.trim()).toBe('main');
    expect(passing.headSha).toMatch(/^[0-9a-f]{40}$/);
    const failing = await review.runCheck(repo, ['git', 'rev-parse', 'does-not-exist']);
    expect(failing.exitCode).not.toBe(0);
    expect(failing.output.length).toBeGreaterThan(0);
    const listed = await review.listChecks(repo);
    expect(listed).toHaveLength(2);
  });

  it('flags land when the reviewed head moved', async () => {
    const { review, repo } = service();
    execFileSync('git', ['checkout', '-b', 'builderhelm/task'], { cwd: repo });
    writeFileSync(join(repo, 'extra.md'), 'more\n');
    execFileSync('git', ['add', 'extra.md'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'more'], { cwd: repo });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['checkout', 'main'], { cwd: repo });
    const inspect = await review.inspectLand(repo, 'builderhelm/task', 'a'.repeat(40));
    expect(inspect.kind).toBe('headMoved');
    expect(inspect.headSha).toBe(head);
    const clean = await review.inspectLand(repo, 'builderhelm/task', head);
    expect(clean.kind).toBe('clean');
    expect(clean.ahead).toBe(1);
  });
});

describe('GitReviewService pull requests and CI', () => {
  const oid = 'b'.repeat(40);

  it('drafts a pull request and returns the URL gh printed', async () => {
    const { review, repo } = service(
      fakeGh({ 'pr create': 'https://github.com/o/r/pull/7\n' }),
    );

    const pr = await review.draftPr(repo, 'Title', 'Body');

    expect(pr.draft).toBe(true);
    expect(pr.url).toBe('https://github.com/o/r/pull/7');
    expect(pr.base).toBe('main');
  });

  it('names the missing pull request instead of leaking gh stderr', async () => {
    const { review, repo } = service(
      fakeGh({
        'pr checks': new Error('no pull requests found for branch "builderhelm/task"'),
      }),
    );

    await expect(review.ci(repo)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('no pull request yet'),
    });
  });

  it('asks for gh auth login when the CLI is not signed in', async () => {
    const { review, repo } = service(
      fakeGh({
        'pr checks': new Error(
          'gh: To get started with GitHub CLI, please run: gh auth login',
        ),
      }),
    );

    await expect(review.ci(repo)).rejects.toMatchObject({
      code: 'INTEGRATION_OFFLINE',
      message: expect.stringContaining('gh auth login'),
    });
  });

  it('reports CI as stale when the pull request head is not the reviewed head', async () => {
    const { review, repo } = service(
      fakeGh({
        'pr checks': JSON.stringify([{ name: 'verify', state: 'SUCCESS', link: 'u' }]),
        'pr view': JSON.stringify({ headRefOid: oid }),
      }),
    );

    const stale = await review.ci(repo, 'c'.repeat(40));
    expect(stale.stale).toBe(true);
    expect(stale.prHead).toBe(oid);
    expect(stale.checks.map((check) => check.name)).toEqual(['verify']);

    const fresh = await review.ci(repo, oid);
    expect(fresh.stale).toBe(false);
  });

  it('does not claim staleness when no head was reviewed', async () => {
    const { review, repo } = service(
      fakeGh({ 'pr checks': '[]', 'pr view': JSON.stringify({ headRefOid: oid }) }),
    );

    const result = await review.ci(repo);

    expect(result.reviewedHead).toBeNull();
    expect(result.stale).toBe(false);
  });
});

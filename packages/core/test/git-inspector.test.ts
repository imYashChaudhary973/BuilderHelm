import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalGitInspector } from '../src/projects/git-inspector.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'builderhelm-inspector-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  return root;
}

function commit(root: string, subject: string): string {
  writeFileSync(join(root, 'notes.md'), `${subject}\n`);
  execFileSync('git', ['add', 'notes.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', subject], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

describe('LocalGitInspector', () => {
  it('reports a branch with no upstream and counts its commits', () => {
    const root = repo();
    commit(root, 'first');
    commit(root, 'second');

    const snap = new LocalGitInspector().inspect(root);

    expect(snap.branch).toBe('main');
    expect(snap.detached).toBe(false);
    expect(snap.upstream).toBeNull();
    expect(snap.commitTotal).toBe(2);
    expect(snap.commits.map((entry) => entry.subject)).toEqual(['second', 'first']);
  });

  it('names the upstream when the branch tracks one', () => {
    const origin = repo();
    commit(origin, 'first');
    const clone = mkdtempSync(join(tmpdir(), 'builderhelm-clone-'));
    roots.push(clone);
    execFileSync('git', ['clone', origin, clone], { stdio: 'ignore' });

    const snap = new LocalGitInspector().inspect(clone);

    expect(snap.upstream).toBe('origin/main');
    expect(snap.detached).toBe(false);
  });

  it('marks a detached HEAD instead of inventing a branch name', () => {
    const root = repo();
    const first = commit(root, 'first');
    commit(root, 'second');
    execFileSync('git', ['checkout', first], { cwd: root, stdio: 'ignore' });

    const snap = new LocalGitInspector().inspect(root);

    expect(snap.detached).toBe(true);
    expect(snap.headSha).toBe(first);
    expect(snap.upstream).toBeNull();
  });

  /**
   * Subjects reach the panel whole. The single `git log` call separates fields
   * with control characters, so a subject containing them cannot split a row.
   */
  it('keeps a commit subject intact', () => {
    const root = repo();
    commit(root, 'feat: add a thing, with punctuation - and dashes');

    const snap = new LocalGitInspector().inspect(root);

    expect(snap.commits[0]?.subject).toBe(
      'feat: add a thing, with punctuation - and dashes',
    );
    expect(snap.commits).toHaveLength(1);
  });
});

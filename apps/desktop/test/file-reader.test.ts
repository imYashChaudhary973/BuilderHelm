import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}));

import { execFileSync } from 'node:child_process';

import { listGitChanges, readEditorFile } from '../src/main/file-reader.js';

describe('readEditorFile', () => {
  it('reads utf-8 text and rejects files over 1 MB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-editor-'));
    try {
      const small = join(dir, 'note.txt');
      writeFileSync(small, 'hello');
      const file = readEditorFile(dir, small);
      expect(file.name).toBe('note.txt');
      expect(file.text).toBe('hello');
      expect(file.path.endsWith('note.txt')).toBe(true);

      const big = join(dir, 'big.txt');
      writeFileSync(big, Buffer.alloc(1_000_001));
      expect(() => readEditorFile(big)).toThrow(/larger than 1 MB/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('git change listing', () => {
  /**
   * Porcelain rows are `XY<space>path`, so an unstaged edit begins with a
   * space. Trimming the whole output shifted the first row left by one, which
   * reported it as staged and dropped the first character of its name.
   */
  it('reports an unstaged first row with its whole path', () => {
    const root = mkdtempSync(join(tmpdir(), 'builderhelm-gitstatus-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {
        cwd: root,
      });
      writeFileSync(join(root, 'notes.md'), 'one\n');
      execFileSync('git', ['add', 'notes.md'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'start'], { cwd: root });
      writeFileSync(join(root, 'notes.md'), 'one\ntwo\n');

      const changes = listGitChanges(root);

      expect(changes).toEqual([
        { path: 'notes.md', code: 'M', staged: false, added: 1, removed: 0 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Staged and unstaged edits to one file are separate rows with separate counts. */
  it('counts staged and unstaged lines separately', () => {
    const root = mkdtempSync(join(tmpdir(), 'builderhelm-numstat-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {
        cwd: root,
      });
      writeFileSync(join(root, 'notes.md'), 'one\n');
      execFileSync('git', ['add', 'notes.md'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'start'], { cwd: root });

      writeFileSync(join(root, 'notes.md'), 'one\ntwo\nthree\n');
      execFileSync('git', ['add', 'notes.md'], { cwd: root });
      writeFileSync(join(root, 'notes.md'), 'one\ntwo\nthree\nfour\n');

      const rows = listGitChanges(root);

      expect(rows).toEqual([
        { path: 'notes.md', code: 'M', staged: true, added: 2, removed: 0 },
        { path: 'notes.md', code: 'M', staged: false, added: 1, removed: 0 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

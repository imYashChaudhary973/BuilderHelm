import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { walkFileNames } from '../src/main/file-walk.js';

describe('walkFileNames', () => {
  it('matches names inside the workspace and skips node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'builderhelm-search-'));
    try {
      writeFileSync(join(root, 'README.md'), 'hi\n');
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'notes.md'), 'x\n');
      mkdirSync(join(root, 'node_modules'));
      writeFileSync(join(root, 'node_modules', 'readme.md'), 'nope\n');

      const hits = walkFileNames(root, 'read');
      expect(hits.map((hit) => hit.name)).toEqual(['README.md']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops when aborted', () => {
    const root = mkdtempSync(join(tmpdir(), 'builderhelm-search-'));
    try {
      writeFileSync(join(root, 'alpha.md'), 'a\n');
      const hits = walkFileNames(root, 'a', { aborted: () => true });
      expect(hits).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses the home directory', () => {
    expect(() => walkFileNames(homedir(), 'x')).toThrow(/project folder/i);
  });
});

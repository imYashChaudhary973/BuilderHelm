import { describe, expect, it } from 'vitest';

import {
  fileKind,
  groupChanges,
  statusLabel,
  type GitChange,
} from '../src/renderer/src/components/git-tree.js';

function change(path: string, staged = false): GitChange {
  return { path, code: 'M', staged, added: 1, removed: 0 };
}

describe('groupChanges', () => {
  it('heads each folder once and counts its files', () => {
    const rows = groupChanges(
      [
        change('src/main/ipc.ts'),
        change('README.md'),
        change('src/main/security.ts'),
        change('docs/STATUS.md'),
      ],
      true,
    );

    expect(rows).toEqual([
      { kind: 'folder', label: 'src/main', count: 2 },
      { kind: 'file', change: change('src/main/ipc.ts'), indent: true },
      { kind: 'file', change: change('src/main/security.ts'), indent: true },
      { kind: 'file', change: change('README.md'), indent: false },
      { kind: 'folder', label: 'docs', count: 1 },
      { kind: 'file', change: change('docs/STATUS.md'), indent: true },
    ]);
  });

  it('emits no folder heading for repository-root files', () => {
    const rows = groupChanges([change('notes.md')], true);

    expect(rows).toEqual([{ kind: 'file', change: change('notes.md'), indent: false }]);
  });

  it('returns a flat list unchanged when tree mode is off', () => {
    const flat = [change('src/a.ts'), change('src/b.ts')];

    expect(groupChanges(flat, false)).toEqual([
      { kind: 'file', change: flat[0], indent: false },
      { kind: 'file', change: flat[1], indent: false },
    ]);
  });
});

describe('fileKind', () => {
  it('classifies by extension and falls back to plain', () => {
    expect(fileKind('src/ipc.ts')).toBe('code');
    expect(fileKind('a/styles.css')).toBe('style');
    expect(fileKind('docs/STATUS.md')).toBe('doc');
    expect(fileKind('package.json')).toBe('data');
    expect(fileKind('logo.svg')).toBe('markup');
    expect(fileKind('shot.png')).toBe('image');
    expect(fileKind('Makefile')).toBe('plain');
    expect(fileKind('.gitignore')).toBe('plain');
  });
});

describe('statusLabel', () => {
  it('names porcelain letters and never returns empty', () => {
    expect(statusLabel('M')).toBe('Modified');
    expect(statusLabel('U')).toBe('Untracked');
    expect(statusLabel('?')).toBe('Changed');
  });
});

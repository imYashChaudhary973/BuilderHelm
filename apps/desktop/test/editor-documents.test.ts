import { expect, it } from 'vitest';
import {
  activePathInWorkspace,
  docsInWorkspace,
  rememberActivePath,
  rememberDocs,
} from '../src/renderer/src/editor-documents.js';

it('restores the selected document and unsaved draft after a tool remount or workspace switch', () => {
  const root = '/fixture/editor-project';
  const sibling = '/fixture/editor-project-other';
  const first = {
    file: { path: `${root}/README.md`, name: 'README.md', text: 'saved' },
    draft: 'unsaved',
  };
  const second = {
    file: { path: `${root}/other.ts`, name: 'other.ts', text: 'second' },
    draft: 'second',
  };
  rememberDocs(root, [first, second]);
  rememberActivePath(root, first.file.path);
  rememberDocs(sibling, [
    {
      file: { path: `${sibling}/note.md`, name: 'note.md', text: 'sibling' },
      draft: 'sibling',
    },
  ]);
  expect(activePathInWorkspace(root)).toBe(first.file.path);
  expect(docsInWorkspace(root)).toEqual([first, second]);
  expect(docsInWorkspace(sibling)).toHaveLength(1);
  rememberActivePath(root, `${sibling}/note.md`);
  expect(activePathInWorkspace(root)).toBe(first.file.path);
  rememberDocs(root, [second]);
  expect(activePathInWorkspace(root)).toBe(second.file.path);
  rememberDocs(root, []);
  expect(activePathInWorkspace(root)).toBeNull();
  rememberDocs(sibling, []);
});

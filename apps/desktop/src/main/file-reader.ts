import { readdirSync, readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

import type { EditorEntry, EditorFile } from '@zero/protocol/editor';
import { ZeroError } from '@zero/shared';
import { dialog } from 'electron';

const maxBytes = 1_000_000;
const maxEntries = 300;
const skipNames = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  'out',
  '.next',
  '.pnpm-store',
]);

function insideWorkspace(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

export function readEditorFile(path: string): EditorFile {
  const resolved = resolve(path);
  let stats: Stats;
  try {
    stats = statSync(resolved);
  } catch (cause) {
    throw new ZeroError('VALIDATION_FAILED', 'The file does not exist', { cause });
  }
  if (!stats.isFile()) {
    throw new ZeroError('VALIDATION_FAILED', 'The path is not a file');
  }
  if (stats.size > maxBytes) {
    throw new ZeroError('VALIDATION_FAILED', 'The file is larger than 1 MB');
  }
  return {
    path: resolved,
    name: basename(resolved),
    text: readFileSync(resolved, 'utf8'),
  };
}

export function listEditorDir(root: string, path = root): EditorEntry[] {
  let resolvedRoot: string;
  let resolved: string;
  try {
    resolvedRoot = realpathSync(resolve(root));
    resolved = realpathSync(resolve(path));
  } catch (cause) {
    throw new ZeroError('VALIDATION_FAILED', 'The folder does not exist', { cause });
  }
  if (!insideWorkspace(resolvedRoot, resolved)) {
    throw new ZeroError('PERMISSION_DENIED', 'Path is outside the workspace');
  }
  let stats: Stats;
  try {
    stats = statSync(resolved);
  } catch (cause) {
    throw new ZeroError('VALIDATION_FAILED', 'The folder does not exist', { cause });
  }
  if (!stats.isDirectory()) {
    throw new ZeroError('VALIDATION_FAILED', 'The path is not a folder');
  }
  return readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => !skipNames.has(entry.name))
    .slice(0, maxEntries)
    .map((entry) => ({
      path: resolve(resolved, entry.name),
      name: entry.name,
      kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),
    }))
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export async function pickEditorFile(): Promise<EditorFile | null> {
  const selected = await dialog.showOpenDialog({
    title: 'Open file',
    properties: ['openFile'],
  });
  const path = selected.filePaths[0];
  if (selected.canceled || path === undefined) return null;
  return readEditorFile(path);
}

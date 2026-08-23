import { readFileSync, statSync, type Stats } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { EditorFile } from '@zero/protocol/editor';
import { ZeroError } from '@zero/shared';
import { dialog } from 'electron';

const maxBytes = 1_000_000;

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

export async function pickEditorFile(): Promise<EditorFile | null> {
  const selected = await dialog.showOpenDialog({
    title: 'Open file',
    properties: ['openFile'],
  });
  const path = selected.filePaths[0];
  if (selected.canceled || path === undefined) return null;
  return readEditorFile(path);
}

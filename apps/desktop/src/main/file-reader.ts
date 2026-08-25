import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
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

function resolveWorkspace(
  root: string,
  path = root,
): { readonly root: string; readonly path: string } {
  let resolvedRoot: string;
  let resolved: string;
  try {
    resolvedRoot = realpathSync(resolve(root));
    resolved = realpathSync(resolve(path));
  } catch (cause) {
    throw new ZeroError('VALIDATION_FAILED', 'The folder does not exist', { cause });
  }
  if (
    resolvedRoot === '/' ||
    resolvedRoot === '/Users' ||
    resolvedRoot === '/System' ||
    resolvedRoot === homedir()
  ) {
    throw new ZeroError(
      'PERMISSION_DENIED',
      'Pick a project folder, not your home directory',
    );
  }
  if (!insideWorkspace(resolvedRoot, resolved)) {
    throw new ZeroError('PERMISSION_DENIED', 'Path is outside the workspace');
  }
  return { root: resolvedRoot, path: resolved };
}

export function readEditorFile(root: string, path: string): EditorFile {
  const resolved = resolveWorkspace(root, path);
  let stats: Stats;
  try {
    stats = statSync(resolved.path);
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
    path: resolved.path,
    name: basename(resolved.path),
    text: readFileSync(resolved.path, 'utf8'),
  };
}

export function writeEditorFile(root: string, path: string, text: string): EditorFile {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new ZeroError('VALIDATION_FAILED', 'The file is larger than 1 MB');
  }
  const resolved = resolveWorkspace(root, path);
  let stats: Stats;
  try {
    stats = statSync(resolved.path);
  } catch (cause) {
    throw new ZeroError('VALIDATION_FAILED', 'The file does not exist', { cause });
  }
  if (!stats.isFile()) {
    throw new ZeroError('VALIDATION_FAILED', 'The path is not a file');
  }
  writeFileSync(resolved.path, text, 'utf8');
  return {
    path: resolved.path,
    name: basename(resolved.path),
    text,
  };
}

export function listEditorDir(root: string, path = root, hidden = false): EditorEntry[] {
  const resolved = resolveWorkspace(root, path);
  let stats: Stats;
  try {
    stats = statSync(resolved.path);
  } catch (cause) {
    throw new ZeroError('VALIDATION_FAILED', 'The folder does not exist', { cause });
  }
  if (!stats.isDirectory()) {
    throw new ZeroError('VALIDATION_FAILED', 'The path is not a folder');
  }
  return readdirSync(resolved.path, { withFileTypes: true })
    .filter((entry) => {
      if (skipNames.has(entry.name)) return false;
      if (!hidden && entry.name.startsWith('.')) return false;
      return true;
    })
    .slice(0, maxEntries)
    .map((entry) => ({
      path: resolve(resolved.path, entry.name),
      name: entry.name,
      kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),
    }))
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export function createEditorEntry(
  root: string,
  path: string,
  kind: 'file' | 'dir',
): EditorEntry {
  const name = basename(path);
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new ZeroError('VALIDATION_FAILED', 'Use a simple file name');
  }
  const parent = resolveWorkspace(root, dirname(resolve(path)));
  const target = resolve(parent.path, name);
  if (!insideWorkspace(parent.root, target)) {
    throw new ZeroError('PERMISSION_DENIED', 'Path is outside the workspace');
  }
  if (existsSync(target)) {
    throw new ZeroError('VALIDATION_FAILED', 'That name already exists');
  }
  if (kind === 'dir') mkdirSync(target);
  else writeFileSync(target, '', 'utf8');
  return { path: target, name, kind };
}

export function searchEditorFiles(
  root: string,
  query: string,
  hidden = false,
): EditorEntry[] {
  const needle = query.trim().toLowerCase();
  const matches: EditorEntry[] = [];
  const queue = [resolveWorkspace(root).path];
  while (queue.length > 0 && matches.length < 80) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = listEditorDir(root, current, hidden);
    for (const entry of entries) {
      if (entry.kind === 'dir') queue.push(entry.path);
      if (entry.name.toLowerCase().includes(needle)) matches.push(entry);
    }
  }
  return matches;
}

export function listGitChanges(root: string): ReadonlyArray<{
  readonly path: string;
  readonly code: string;
  readonly staged: boolean;
}> {
  try {
    const status = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
    }).trim();
    if (status.length === 0) return [];
    const rows: Array<{ path: string; code: string; staged: boolean }> = [];
    for (const line of status.split('\n').slice(0, 80)) {
      const path = line.slice(3).split(' -> ').at(-1) ?? line.slice(3);
      const index = line[0] ?? ' ';
      const work = line[1] ?? ' ';
      if (index !== ' ' && index !== '?') {
        rows.push({ path, code: index, staged: true });
      }
      if (work !== ' ' && work !== '?') {
        rows.push({ path, code: work, staged: false });
      }
      if (index === '?' && work === '?') {
        rows.push({ path, code: 'U', staged: false });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function runGit(root: string, args: readonly string[]): void {
  try {
    execFileSync('git', [...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
  } catch (cause) {
    const detail =
      cause instanceof Error && 'stderr' in cause && typeof cause.stderr === 'string'
        ? cause.stderr.trim()
        : cause instanceof Error
          ? cause.message
          : 'Git failed';
    throw new ZeroError('TOOL_EXECUTION_FAILED', detail.slice(0, 300), { cause });
  }
}

export function stageGitPath(
  root: string,
  path: string | undefined,
  staged: boolean,
): void {
  const workspace = resolveWorkspace(root);
  if (path === undefined) {
    if (staged) runGit(workspace.root, ['add', '-A']);
    else runGit(workspace.root, ['restore', '--staged', '.']);
    return;
  }
  const target = resolveWorkspace(root, path);
  const rel = relative(workspace.root, target.path);
  if (rel.startsWith('..') || rel.length === 0) {
    throw new ZeroError('PERMISSION_DENIED', 'Path is outside the workspace');
  }
  if (staged) runGit(workspace.root, ['add', '--', rel]);
  else runGit(workspace.root, ['restore', '--staged', '--', rel]);
}

export function commitGit(root: string, message: string): void {
  const workspace = resolveWorkspace(root);
  runGit(workspace.root, ['commit', '-m', message]);
}

export async function pickEditorFile(): Promise<EditorFile | null> {
  const selected = await dialog.showOpenDialog({
    title: 'Open file',
    properties: ['openFile'],
  });
  const path = selected.filePaths[0];
  if (selected.canceled || path === undefined) return null;
  return readEditorFile(path, path);
}

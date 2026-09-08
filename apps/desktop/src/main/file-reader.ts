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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { EditorEntry, EditorFile } from '@builderhelm/protocol/editor';
import { BuilderHelmError } from '@builderhelm/shared';
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

export function resolveWorkspace(
  root: string,
  path = root,
): { readonly root: string; readonly path: string } {
  let resolvedRoot: string;
  let resolved: string;
  try {
    resolvedRoot = realpathSync(resolve(root));
    const candidate = isAbsolute(path) ? path : join(resolvedRoot, path);
    resolved = realpathSync(resolve(candidate));
  } catch (cause) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The folder does not exist', {
      cause,
    });
  }
  if (
    resolvedRoot === '/' ||
    resolvedRoot === '/Users' ||
    resolvedRoot === '/System' ||
    resolvedRoot === homedir()
  ) {
    throw new BuilderHelmError(
      'PERMISSION_DENIED',
      'Pick a project folder, not your home directory',
    );
  }
  if (!insideWorkspace(resolvedRoot, resolved)) {
    throw new BuilderHelmError('PERMISSION_DENIED', 'Path is outside the workspace');
  }
  return { root: resolvedRoot, path: resolved };
}

export function readEditorFile(root: string, path: string): EditorFile {
  const resolved = resolveWorkspace(root, path);
  let stats: Stats;
  try {
    stats = statSync(resolved.path);
  } catch (cause) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The file does not exist', { cause });
  }
  if (!stats.isFile()) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The path is not a file');
  }
  if (stats.size > maxBytes) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The file is larger than 1 MB');
  }
  return {
    path: resolved.path,
    name: basename(resolved.path),
    text: readFileSync(resolved.path, 'utf8'),
  };
}

export function writeEditorFile(root: string, path: string, text: string): EditorFile {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The file is larger than 1 MB');
  }
  const resolved = resolveWorkspace(root, path);
  let stats: Stats;
  try {
    stats = statSync(resolved.path);
  } catch (cause) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The file does not exist', { cause });
  }
  if (!stats.isFile()) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The path is not a file');
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
    throw new BuilderHelmError('VALIDATION_FAILED', 'The folder does not exist', {
      cause,
    });
  }
  if (!stats.isDirectory()) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The path is not a folder');
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
    throw new BuilderHelmError('VALIDATION_FAILED', 'Use a simple file name');
  }
  const parentSpec = dirname(path);
  const parent = resolveWorkspace(
    root,
    parentSpec === '.' || parentSpec === '' ? root : parentSpec,
  );
  const target = resolve(parent.path, name);
  if (!insideWorkspace(parent.root, target)) {
    throw new BuilderHelmError('PERMISSION_DENIED', 'Path is outside the workspace');
  }
  if (existsSync(target)) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'That name already exists');
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

/** `added`/`removed` per path, keyed the same way porcelain names them. */
function readNumstat(root: string, staged: boolean): Map<string, [number, number]> {
  const counts = new Map<string, [number, number]>();
  try {
    const raw = execFileSync(
      'git',
      staged
        ? ['diff', '--numstat', '--no-color', '--cached']
        : ['diff', '--numstat', '--no-color'],
      { cwd: root, encoding: 'utf8', timeout: 8_000, windowsHide: true },
    );
    for (const line of raw.split('\n')) {
      const [addedRaw, removedRaw, ...rest] = line.split('\t');
      const path = rest.join('\t').split(' => ').at(-1);
      if (path === undefined || path.length === 0) continue;
      // A binary file reports "-" for both counts.
      const added = Number(addedRaw);
      const removed = Number(removedRaw);
      counts.set(path, [
        Number.isSafeInteger(added) && added >= 0 ? added : 0,
        Number.isSafeInteger(removed) && removed >= 0 ? removed : 0,
      ]);
    }
  } catch {
    // No diff available is not an error; the panel just shows no counts.
  }
  return counts;
}

export function listGitChanges(root: string): ReadonlyArray<{
  readonly path: string;
  readonly code: string;
  readonly staged: boolean;
  readonly added: number;
  readonly removed: number;
}> {
  try {
    // Deliberately not trimmed: porcelain rows are `XY<space>path`, and an
    // unstaged change starts with a space. Trimming the output ate the first
    // row's leading space, so its status shifted left by one — an unstaged
    // edit read as staged and its filename lost its first character.
    const status = execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
    }).replace(/\n+$/, '');
    if (status.length === 0) return [];
    const stagedCounts = readNumstat(root, true);
    const workCounts = readNumstat(root, false);
    const rows: Array<{
      path: string;
      code: string;
      staged: boolean;
      added: number;
      removed: number;
    }> = [];
    const push = (path: string, code: string, isStaged: boolean): void => {
      const [added, removed] = (isStaged ? stagedCounts : workCounts).get(path) ?? [0, 0];
      rows.push({ path, code, staged: isStaged, added, removed });
    };
    for (const line of status.split('\n').slice(0, 80)) {
      if (line.length < 4) continue;
      const path = line.slice(3).split(' -> ').at(-1) ?? line.slice(3);
      const index = line[0] ?? ' ';
      const work = line[1] ?? ' ';
      if (index !== ' ' && index !== '?') push(path, index, true);
      if (work !== ' ' && work !== '?') push(path, work, false);
      if (index === '?' && work === '?') push(path, 'U', false);
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Files in one commit, with their line counts.
 *
 * `--no-commit-id` drops the header so only numstat rows remain, and `-m`
 * makes a merge commit report its files rather than nothing at all.
 */
export function readCommitFiles(
  root: string,
  sha: string,
): ReadonlyArray<{
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}> {
  if (!/^[0-9a-f]{7,64}$/.test(sha)) return [];
  try {
    const raw = execFileSync(
      'git',
      ['show', '--numstat', '--no-color', '--no-commit-id', '-m', '--format=', sha, '--'],
      { cwd: root, encoding: 'utf8', timeout: 8_000, windowsHide: true },
    );
    const files: Array<{ path: string; added: number; removed: number }> = [];
    const seen = new Set<string>();
    for (const line of raw.split('\n').slice(0, 500)) {
      const [addedRaw, removedRaw, ...rest] = line.split('\t');
      const path = rest.join('\t').split(' => ').at(-1);
      if (path === undefined || path.length === 0) continue;
      // `-m` repeats a merge's files once per parent.
      if (seen.has(path)) continue;
      seen.add(path);
      const added = Number(addedRaw);
      const removed = Number(removedRaw);
      files.push({
        path,
        added: Number.isSafeInteger(added) && added >= 0 ? added : 0,
        removed: Number.isSafeInteger(removed) && removed >= 0 ? removed : 0,
      });
    }
    return files;
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
    throw new BuilderHelmError('TOOL_EXECUTION_FAILED', detail.slice(0, 300), { cause });
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
  // Git reports repository-relative paths, including for files it has
  // deleted, so join them textually against the workspace root instead of
  // resolving them against the process working directory.
  const target = resolve(workspace.root, path);
  const rel = relative(workspace.root, target);
  if (rel.startsWith('..') || rel.length === 0) {
    throw new BuilderHelmError('PERMISSION_DENIED', 'Path is outside the workspace');
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

import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

export interface FileHit {
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

const skipNames = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  'out',
  '.next',
  '.pnpm-store',
  '.env',
  '.env.local',
]);

const maxVisited = 4_000;

function insideRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

export function walkFileNames(
  root: string,
  query: string,
  options: { readonly limit?: number; readonly aborted?: () => boolean } = {},
): FileHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 80);
  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(resolve(root));
  } catch {
    throw new Error('The folder does not exist');
  }
  if (
    resolvedRoot === '/' ||
    resolvedRoot === '/Users' ||
    resolvedRoot === '/System' ||
    resolvedRoot === homedir()
  ) {
    throw new Error('Pick a project folder, not your home directory');
  }
  const hits: FileHit[] = [];
  const queue = [resolvedRoot];
  let visited = 0;
  while (queue.length > 0 && hits.length < limit && visited < maxVisited) {
    if (options.aborted?.()) return hits;
    const current = queue.shift();
    if (current === undefined) break;
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      if (skipNames.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      const target = join(current, entry.name);
      if (!insideRoot(resolvedRoot, target)) continue;
      visited += 1;
      const kind = entry.isDirectory() ? ('dir' as const) : ('file' as const);
      if (kind === 'dir') queue.push(target);
      if (
        entry.name.toLowerCase().includes(needle) ||
        basename(target).toLowerCase().includes(needle)
      ) {
        let path = target;
        try {
          path = realpathSync(target);
        } catch {
          continue;
        }
        if (!insideRoot(resolvedRoot, path)) continue;
        hits.push({ path, name: entry.name, kind });
      }
    }
  }
  return hits;
}

export function assertFileInRoot(root: string, path: string): string {
  const resolvedRoot = realpathSync(resolve(root));
  const resolved = realpathSync(resolve(path));
  if (!insideRoot(resolvedRoot, resolved)) {
    throw new Error('Path is outside the workspace');
  }
  statSync(resolved);
  return resolved;
}

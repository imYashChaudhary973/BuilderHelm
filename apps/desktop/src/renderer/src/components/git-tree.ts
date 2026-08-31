import type { EditorGit } from '@builderhelm/protocol/editor';

export type GitChange = EditorGit['changes'][number];

/** A folder heading, or a file beneath one. Flat so the panel can map it directly. */
export type TreeRow =
  | { readonly kind: 'folder'; readonly label: string; readonly count: number }
  | { readonly kind: 'file'; readonly change: GitChange; readonly indent: boolean };

export function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function dirLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

/**
 * Groups changes under their directory, in the order the folders first appear.
 *
 * Repository-root files come first with no heading, because a heading of "" is
 * noise. Passing `tree: false` returns the files unchanged, which is what the
 * "View as list" menu item selects.
 */
export function groupChanges(
  changes: readonly GitChange[],
  tree: boolean,
): readonly TreeRow[] {
  if (!tree) {
    return changes.map((change) => ({ kind: 'file', change, indent: false }) as const);
  }
  const byFolder = new Map<string, GitChange[]>();
  for (const change of changes) {
    const folder = dirLabel(change.path);
    const bucket = byFolder.get(folder);
    if (bucket === undefined) byFolder.set(folder, [change]);
    else bucket.push(change);
  }
  const rows: TreeRow[] = [];
  for (const [folder, bucket] of byFolder) {
    if (folder.length > 0) {
      rows.push({ kind: 'folder', label: folder, count: bucket.length });
    }
    for (const change of bucket) {
      rows.push({ kind: 'file', change, indent: folder.length > 0 });
    }
  }
  return rows;
}

/** Coarse file family, so one small icon set covers every extension. */
export type FileKind = 'code' | 'style' | 'markup' | 'data' | 'doc' | 'image' | 'plain';

const KINDS: readonly (readonly [FileKind, readonly string[]])[] = [
  ['code', ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'sh', 'rb']],
  ['style', ['css', 'scss', 'less']],
  ['markup', ['html', 'htm', 'svg', 'xml']],
  ['data', ['json', 'yml', 'yaml', 'toml', 'lock', 'sql', 'csv']],
  ['doc', ['md', 'mdx', 'txt', 'rst']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'avif']],
];

export function fileKind(path: string): FileKind {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  const extension = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  for (const [kind, extensions] of KINDS) {
    if (extensions.includes(extension)) return kind;
  }
  return 'plain';
}

/** Porcelain letters the panel names in full when a reviewer hovers a badge. */
const STATUS: Readonly<Record<string, string>> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Untracked',
  T: 'Type changed',
};

export function statusLabel(code: string): string {
  return STATUS[code.trim().slice(0, 1).toUpperCase()] ?? 'Changed';
}

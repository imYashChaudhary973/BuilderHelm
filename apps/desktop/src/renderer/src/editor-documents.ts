import type { EditorFile } from '@builderhelm/protocol/editor';

export interface OpenDoc {
  readonly file: EditorFile;
  readonly draft: string;
}

/** Survives tool remounts; durable drafts remain owned by the workspace service. */
const openDocs = new Map<string, OpenDoc>();
const activePaths = new Map<string, string>();

export function docsInWorkspace(root: string | null): OpenDoc[] {
  if (root === null) return [];
  const prefix = `${root.replace(/\/$/, '')}/`;
  return [...openDocs.values()].filter((doc) => doc.file.path.startsWith(prefix));
}

export function activePathInWorkspace(root: string | null): string | null {
  if (root === null) return null;
  const docs = docsInWorkspace(root);
  const path = activePaths.get(root);
  return docs.some((doc) => doc.file.path === path)
    ? path!
    : (docs.at(-1)?.file.path ?? null);
}

export function rememberActivePath(root: string | null, path: string | null): void {
  if (root === null) return;
  if (path === null) activePaths.delete(root);
  else if (path.startsWith(`${root.replace(/\/$/, '')}/`)) activePaths.set(root, path);
}

export function rememberDocs(root: string | null, docs: readonly OpenDoc[]): void {
  if (root === null) return;
  const prefix = `${root.replace(/\/$/, '')}/`;
  for (const doc of docs) {
    if (doc.file.path.startsWith(prefix)) openDocs.set(doc.file.path, doc);
  }
  for (const path of openDocs.keys()) {
    if (path.startsWith(prefix) && !docs.some((doc) => doc.file.path === path))
      openDocs.delete(path);
  }
  if (docs.length === 0) activePaths.delete(root);
}

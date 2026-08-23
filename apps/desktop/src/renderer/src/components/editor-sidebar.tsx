import type { EditorEntry, EditorFile } from '@zero/protocol/editor';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null;
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function DirList({
  root,
  path,
  activePath,
  onOpen,
}: {
  readonly root: string;
  readonly path: string;
  readonly activePath: string | null;
  readonly onOpen: (path: string) => void;
}): React.JSX.Element {
  const [entries, setEntries] = useState<EditorEntry[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.zero.editor
      .list({ root, path })
      .then((next) => {
        if (!alive) return;
        setEntries(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setEntries([]);
        setError(cause instanceof Error ? cause.message : 'Could not list this folder');
      });
    return () => {
      alive = false;
    };
  }, [root, path]);

  if (error !== null && path === root) {
    return <p className="editorBody">{error}</p>;
  }

  return (
    <ul className="editorTree">
      {entries.map((entry) => {
        const expanded = open.has(entry.path);
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={
                entry.path === activePath ? 'editorNode editorNodeOn' : 'editorNode'
              }
              onClick={() => {
                if (entry.kind === 'dir') {
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                  return;
                }
                onOpen(entry.path);
              }}
            >
              {entry.kind === 'dir' ? (expanded ? '▾' : '▸') : ''} {entry.name}
            </button>
            {entry.kind === 'dir' && expanded ? (
              <DirList
                root={root}
                path={entry.path}
                activePath={activePath}
                onOpen={onOpen}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EditorSidebar(): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const [file, setFile] = useState<EditorFile | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = file !== null && draft !== file.text;

  useEffect(() => {
    setFile(null);
    setDraft('');
    setError(null);
  }, [root]);

  async function openFile(path: string): Promise<void> {
    if (root === null) return;
    setError(null);
    try {
      const next = await window.zero.editor.read({ root, path });
      setFile(next);
      setDraft(next.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Open failed');
    }
  }

  async function save(): Promise<void> {
    if (root === null || file === null || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.zero.editor.write({
        root,
        path: file.path,
        text: draft,
      });
      setFile(next);
      setDraft(next.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void save();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <aside className="editorSide" aria-label="Editor">
      <div className="editorBar">
        <span>
          {file !== null
            ? `${file.name}${dirty ? ' ·' : ''}`
            : root === null
              ? 'No workspace'
              : folderName(root)}
        </span>
        <button type="button" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      {root === null ? (
        <p className="editorBody">Open a Space folder to edit its files.</p>
      ) : (
        <>
          <DirList
            root={root}
            path={root}
            activePath={file?.path ?? null}
            onOpen={(path) => void openFile(path)}
          />
          {file === null ? (
            <p className="editorBody">Pick a file in {folderName(root)}.</p>
          ) : (
            <textarea
              className="editorBody"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </>
      )}
    </aside>
  );
}

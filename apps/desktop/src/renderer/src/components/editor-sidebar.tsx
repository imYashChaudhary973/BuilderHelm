import type { EditorEntry, EditorFile } from '@zero/protocol/editor';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';

function workspaceFolder(
  spaces: ReturnType<typeof useSpaces>,
): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null;
}

function DirList({
  root,
  path,
  onOpen,
}: {
  readonly root: string;
  readonly path: string;
  readonly onOpen: (path: string) => void;
}): React.JSX.Element {
  const [entries, setEntries] = useState<EditorEntry[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void window.zero.editor
      .list({ root, path })
      .then((next) => {
        if (alive) setEntries(next);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [root, path]);

  return (
    <ul className="editorTree">
      {entries.map((entry) => {
        const expanded = open.has(entry.path);
        return (
          <li key={entry.path}>
            <button
              type="button"
              className="editorNode"
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
              <DirList root={root} path={entry.path} onOpen={onOpen} />
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFile(null);
    setError(null);
  }, [root]);

  async function openFile(path: string): Promise<void> {
    setError(null);
    try {
      setFile(await window.zero.editor.read(path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Open failed');
    }
  }

  return (
    <aside className="editorSide" aria-label="Editor">
      <div className="editorBar">
        <span>{file?.name ?? (root === null ? 'No workspace' : 'Workspace')}</span>
      </div>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      {root === null ? (
        <p className="editorBody">Open a Space to see its files.</p>
      ) : (
        <>
          <DirList root={root} path={root} onOpen={(path) => void openFile(path)} />
          {file === null ? (
            <p className="editorBody">Pick a file.</p>
          ) : (
            <textarea className="editorBody" readOnly value={file.text} spellCheck={false} />
          )}
        </>
      )}
    </aside>
  );
}

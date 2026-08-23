import type { EditorEntry, EditorFile } from '@zero/protocol/editor';
import { useEffect, useMemo, useState } from 'react';

import { useSpaces } from '../space-store.js';

interface OpenDoc {
  readonly file: EditorFile;
  readonly draft: string;
}

const AUTOSAVE_KEY = 'exeum.editor.autosave';

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null;
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function joinPath(root: string, name: string): string {
  return `${root.replace(/\/$/, '')}/${name}`;
}

function DirList({
  root,
  path,
  hidden,
  refresh,
  activePath,
  onOpen,
}: {
  readonly root: string;
  readonly path: string;
  readonly hidden: boolean;
  readonly refresh: number;
  readonly activePath: string | null;
  readonly onOpen: (path: string) => void;
}): React.JSX.Element {
  const [entries, setEntries] = useState<EditorEntry[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void window.zero.editor
      .list({ root, path, hidden })
      .then((next) => {
        if (alive) setEntries(next);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [root, path, hidden, refresh]);

  return (
    <ul className="editorTree">
      {entries.map((entry) => {
        const expanded = open.has(entry.path);
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={entry.path === activePath ? 'editorNode editorNodeOn' : 'editorNode'}
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
              <span>{entry.kind === 'dir' ? (expanded ? '▾' : '▸') : ''}</span>
              {entry.name}
            </button>
            {entry.kind === 'dir' && expanded ? (
              <DirList
                root={root}
                path={entry.path}
                hidden={hidden}
                refresh={refresh}
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
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<EditorEntry[]>([]);
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null);
  const [newName, setNewName] = useState('');
  const [autosave, setAutosave] = useState(() => localStorage.getItem(AUTOSAVE_KEY) === '1');

  const active = docs.find((doc) => doc.file.path === activePath) ?? null;
  const dirtyCount = docs.filter((doc) => doc.draft !== doc.file.text).length;

  useEffect(() => {
    setDocs([]);
    setActivePath(null);
    setError(null);
    setQuery('');
    setHits([]);
  }, [root]);

  useEffect(() => {
    if (root === null || query.trim().length === 0) {
      setHits([]);
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      void window.zero.editor
        .search({ root, query: query.trim(), hidden })
        .then((next) => {
          if (alive) setHits(next);
        })
        .catch(() => {
          if (alive) setHits([]);
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [root, query, hidden]);

  async function openFile(path: string): Promise<void> {
    if (root === null) return;
    const existing = docs.find((doc) => doc.file.path === path);
    if (existing !== undefined) {
      setActivePath(path);
      return;
    }
    setError(null);
    try {
      const file = await window.zero.editor.read({ root, path });
      setDocs((current) => [...current, { file, draft: file.text }]);
      setActivePath(file.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Open failed');
    }
  }

  async function saveOne(path: string): Promise<void> {
    if (root === null) return;
    const doc = docs.find((item) => item.file.path === path);
    if (doc === undefined || doc.draft === doc.file.text) return;
    const next = await window.zero.editor.write({
      root,
      path: doc.file.path,
      text: doc.draft,
    });
    setDocs((current) =>
      current.map((item) =>
        item.file.path === path ? { file: next, draft: next.text } : item,
      ),
    );
  }

  async function saveActive(): Promise<void> {
    if (activePath === null) return;
    setError(null);
    try {
      await saveOne(activePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed');
    }
  }

  async function saveAll(): Promise<void> {
    setError(null);
    try {
      for (const doc of docs) {
        if (doc.draft !== doc.file.text) await saveOne(doc.file.path);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed');
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (event.shiftKey) void saveAll();
      else void saveActive();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!autosave || active === null || active.draft === active.file.text) return;
    const handle = window.setTimeout(() => {
      void saveOne(active.file.path).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Autosave failed');
      });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [autosave, active?.file.path, active?.draft, active?.file.text]);

  async function createEntry(): Promise<void> {
    if (root === null || creating === null) return;
    const name = newName.trim();
    if (name.length === 0) return;
    setError(null);
    try {
      const created = await window.zero.editor.create({
        root,
        path: joinPath(root, name),
        kind: creating,
      });
      setCreating(null);
      setNewName('');
      setRefresh((current) => current + 1);
      if (created.kind === 'file') await openFile(created.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Create failed');
    }
  }

  const lines = useMemo(
    () => (active === null ? [] : active.draft.split('\n')),
    [active],
  );

  if (root === null) {
    return (
      <aside className="editorSide" aria-label="Editor">
        <p className="editorEmpty">Open a Space folder to edit its files.</p>
      </aside>
    );
  }

  return (
    <aside className="editorSide" aria-label="Editor">
      <div className="editorTreeCol">
        <div className="editorTreeHead">
          <strong>{folderName(root)}</strong>
          <div className="editorTreeActions">
            <button type="button" title="New file" onClick={() => setCreating('file')}>
              +F
            </button>
            <button type="button" title="New folder" onClick={() => setCreating('dir')}>
              +D
            </button>
            <button
              type="button"
              title="Refresh"
              onClick={() => setRefresh((current) => current + 1)}
            >
              ↻
            </button>
            <button
              type="button"
              title={hidden ? 'Hide hidden files' : 'Show hidden files'}
              className={hidden ? 'editorTinyOn' : undefined}
              onClick={() => setHidden((current) => !current)}
            >
              ·
            </button>
          </div>
        </div>
        <input
          className="editorSearch"
          value={query}
          placeholder="Search files…"
          onChange={(event) => setQuery(event.target.value)}
        />
        {creating !== null && (
          <form
            className="editorCreate"
            onSubmit={(event) => {
              event.preventDefault();
              void createEntry();
            }}
          >
            <input
              value={newName}
              autoFocus
              placeholder={creating === 'dir' ? 'folder name' : 'file name'}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setCreating(null);
                  setNewName('');
                }
              }}
            />
          </form>
        )}
        {query.trim().length > 0 ? (
          <ul className="editorTree">
            {hits.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className={
                    entry.path === activePath ? 'editorNode editorNodeOn' : 'editorNode'
                  }
                  onClick={() => {
                    if (entry.kind === 'file') void openFile(entry.path);
                  }}
                >
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <DirList
            root={root}
            path={root}
            hidden={hidden}
            refresh={refresh}
            activePath={activePath}
            onOpen={(path) => void openFile(path)}
          />
        )}
      </div>
      <div className="editorMain">
        <div className="editorTabs" aria-label="Open files">
          {docs.length === 0 ? (
            <span className="editorTabGhost">Pick a file from the tree.</span>
          ) : (
            docs.map((doc) => (
              <button
                key={doc.file.path}
                type="button"
                className={
                  doc.file.path === activePath ? 'editorTab editorTabOn' : 'editorTab'
                }
                onClick={() => setActivePath(doc.file.path)}
              >
                {doc.file.name}
                {doc.draft !== doc.file.text ? ' ·' : ''}
              </button>
            ))
          )}
        </div>
        <div className="editorToolbar">
          <button type="button" disabled={active === null} onClick={() => void saveActive()}>
            Save
          </button>
          <button type="button" disabled={dirtyCount === 0} onClick={() => void saveAll()}>
            Save all
          </button>
          <label className="editorAuto">
            <input
              type="checkbox"
              checked={autosave}
              onChange={(event) => {
                const next = event.target.checked;
                setAutosave(next);
                localStorage.setItem(AUTOSAVE_KEY, next ? '1' : '0');
              }}
            />
            Autosave
          </label>
          <span className="editorStatus">
            {active === null
              ? 'No file'
              : active.draft === active.file.text
                ? 'Saved'
                : 'Unsaved'}
          </span>
        </div>
        {error !== null && (
          <p className="browserError" role="alert">
            {error}
          </p>
        )}
        {active === null ? (
          <p className="editorEmpty">Select a file from the tree to open it here.</p>
        ) : (
          <div className="codePane">
            <pre className="codeGutter" aria-hidden="true">
              {lines.map((_, index) => String(index + 1)).join('\n')}
            </pre>
            <textarea
              className="codeInput"
              value={active.draft}
              spellCheck={false}
              onChange={(event) => {
                const text = event.target.value;
                setDocs((current) =>
                  current.map((doc) =>
                    doc.file.path === active.file.path ? { ...doc, draft: text } : doc,
                  ),
                );
              }}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

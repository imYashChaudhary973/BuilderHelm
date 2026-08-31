import type { EditorEntry, EditorFile } from '@builderhelm/protocol/editor';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSpaces } from '../space-store.js';

interface OpenDoc {
  readonly file: EditorFile;
  readonly draft: string;
}

const AUTOSAVE_KEY = 'exeum.editor.autosave';
const WRAP_KEY = 'exeum.editor.wrap';

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null
  );
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function joinPath(root: string, name: string): string {
  return `${root.replace(/\/$/, '')}/${name}`;
}

function IconPlus(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconFolderPlus(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M2.5 5.5h4l1 1.5h6v6h-11z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8 8.2v3.2M6.4 9.8h3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function IconReset(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M3.5 8a4.5 4.5 0 1 0 1.2-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M3 3.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconInfo(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v4M8 5.2v.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconInfoOff(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 7.2v4M8 5.2v.6M4 12.5 12.5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function IconFolder({ open }: { readonly open: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={
          open
            ? 'M2.5 5.2h3.2l1 1.3H13.5v6H2.5zM2.5 5.2V4.2h3l.7 1'
            : 'M2.5 4.5h4l1 1.4h6v6.6h-11z'
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function IconFile(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4.5 2.5h5l3 3v8h-8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M9.5 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
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
  const [entries, setEntries] = useState<EditorEntry[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setEntries(null);
    void window.builderHelm.editor
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

  if (entries === null) return <></>;
  if (entries.length === 0) {
    return <p className="editorTreeEmpty">This folder is empty.</p>;
  }

  return (
    <ul className="editorTree">
      {entries.map((entry) => {
        const expanded = open.has(entry.path);
        const isDir = entry.kind === 'dir';
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={
                entry.path === activePath ? 'editorNode editorNodeOn' : 'editorNode'
              }
              aria-expanded={isDir ? expanded : undefined}
              onClick={() => {
                if (isDir) {
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
              <span className="editorNodeTwist" aria-hidden="true">
                {isDir ? (expanded ? '▾' : '▸') : ''}
              </span>
              <span className="editorNodeGlyph" aria-hidden="true">
                {isDir ? <IconFolder open={expanded} /> : <IconFile />}
              </span>
              <span className="editorNodeName">{entry.name}</span>
            </button>
            {isDir && expanded ? (
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
  const [autosave, setAutosave] = useState(
    () => localStorage.getItem(AUTOSAVE_KEY) === '1',
  );
  const [wrap, setWrap] = useState(() => localStorage.getItem(WRAP_KEY) === '1');
  const gutterRef = useRef<HTMLPreElement>(null);
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
      void window.builderHelm.editor
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
      const file = await window.builderHelm.editor.read({ root, path });
      setDocs((current) => [...current, { file, draft: file.text }]);
      setActivePath(file.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Open failed');
    }
  }

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (typeof path === 'string') void openFile(path);
    };
    window.addEventListener('builderhelm:open-editor', onOpen);
    return () => window.removeEventListener('builderhelm:open-editor', onOpen);
  });

  async function saveOne(path: string): Promise<void> {
    if (root === null) return;
    const doc = docs.find((item) => item.file.path === path);
    if (doc === undefined || doc.draft === doc.file.text) return;
    const next = await window.builderHelm.editor.write({
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
      const created = await window.builderHelm.editor.create({
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

  const fileOpen = docs.length > 0;
  const sideClass = fileOpen ? 'editorSide editorSideFileOn' : 'editorSide';

  function closeDoc(path: string): void {
    setDocs((current) => {
      const next = current.filter((doc) => doc.file.path !== path);
      if (activePath === path) setActivePath(next.at(-1)?.file.path ?? null);
      return next;
    });
  }

  if (root === null) {
    return (
      <aside className="editorSide" aria-label="Files">
        <p className="editorEmpty">Start or select a Space to browse its folder.</p>
      </aside>
    );
  }
  return (
    <aside className={sideClass} aria-label="Files">
      <div className="editorTreeCol">
        <div className="editorTreeHead">
          <strong>{folderName(root)}</strong>
          <div className="editorTreeActions">
            <button type="button" title="New file" onClick={() => setCreating('file')}>
              <IconPlus />
            </button>
            <button type="button" title="New folder" onClick={() => setCreating('dir')}>
              <IconFolderPlus />
            </button>
            <button
              type="button"
              title="Refresh"
              onClick={() => setRefresh((current) => current + 1)}
            >
              <IconReset />
            </button>
            <button
              type="button"
              title={hidden ? 'Hidden files visible' : 'Hidden files hidden'}
              className={hidden ? 'editorTinyOn' : undefined}
              onClick={() => setHidden((current) => !current)}
            >
              {hidden ? <IconInfo /> : <IconInfoOff />}
            </button>
          </div>
        </div>
        <input
          className="editorSearch"
          value={query}
          placeholder="Find files"
          aria-label="Find files"
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
          hits.length === 0 ? (
            <p className="editorTreeEmpty">No matching files.</p>
          ) : (
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
                    <span className="editorNodeTwist" aria-hidden="true" />
                    <span className="editorNodeGlyph" aria-hidden="true">
                      {entry.kind === 'dir' ? <IconFolder open={false} /> : <IconFile />}
                    </span>
                    <span className="editorNodeName">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
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
      {fileOpen ? (
        <div className="editorMain">
          <div className="editorTabs" aria-label="Open files">
            {docs.map((doc) => (
              <div
                key={doc.file.path}
                className={
                  doc.file.path === activePath ? 'editorTab editorTabOn' : 'editorTab'
                }
              >
                <button type="button" onClick={() => setActivePath(doc.file.path)}>
                  {doc.file.name}
                  {doc.draft !== doc.file.text ? ' ·' : ''}
                </button>
                <button
                  type="button"
                  className="editorTabClose"
                  aria-label={`Close ${doc.file.name}`}
                  onClick={() => closeDoc(doc.file.path)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="editorToolbar">
            <button
              type="button"
              disabled={active === null}
              onClick={() => void saveActive()}
            >
              Save
            </button>
            <button
              type="button"
              disabled={dirtyCount === 0}
              onClick={() => void saveAll()}
            >
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
            <label className="editorAuto">
              <input
                type="checkbox"
                checked={wrap}
                onChange={(event) => {
                  const next = event.target.checked;
                  setWrap(next);
                  localStorage.setItem(WRAP_KEY, next ? '1' : '0');
                }}
              />
              Word wrap
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
              <pre ref={gutterRef} className="codeGutter" aria-hidden="true">
                {lines.map((_, index) => String(index + 1)).join('\n')}
              </pre>
              <textarea
                className={wrap ? 'codeInput codeInputWrap' : 'codeInput'}
                value={active.draft}
                spellCheck={false}
                onScroll={(event) => {
                  const gutter = gutterRef.current;
                  if (gutter !== null) gutter.scrollTop = event.currentTarget.scrollTop;
                }}
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
      ) : null}
    </aside>
  );
}

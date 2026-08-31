import type { PreviewArtifact } from '@builderhelm/protocol/browser';
import type { EditorGit, EditorGitCommitFile } from '@builderhelm/protocol/editor';
import { useCallback, useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';
import {
  dirLabel,
  fileKind,
  fileName,
  groupChanges,
  statusLabel,
  type FileKind,
  type GitChange,
} from './git-tree.js';

/** Rows shown before "View all" appears, so a large change set stays scannable. */
const SECTION_CAP = 10;
const TREE_KEY = 'exeum.git.tree';
const BASE_KEY = 'exeum.git.base';

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null
  );
}

function readBase(root: string | null): string | null {
  if (root === null) return null;
  return localStorage.getItem(`${BASE_KEY}.${root}`);
}

const KIND_GLYPH: Readonly<Record<FileKind, string>> = {
  code: 'M4.2 4.6 1.8 8l2.4 3.4M11.8 4.6 14.2 8l-2.4 3.4M9.4 3.4 6.6 12.6',
  style: 'M3 3.4h10l-.9 9.2L8 13.6l-4.1-1zM5.6 6.4h4.8M5.9 9h4.2',
  markup: 'M6.2 3.6 3.2 8l3 4.4M9.8 3.6 12.8 8l-3 4.4',
  data: 'M3.4 4.6c0-1 2-1.6 4.6-1.6s4.6.6 4.6 1.6v6.8c0 1-2 1.6-4.6 1.6s-4.6-.6-4.6-1.6zM3.4 8c0 1 2 1.6 4.6 1.6S12.6 9 12.6 8',
  doc: 'M4.2 2.8h5.2l2.4 2.4v8H4.2zM9.4 2.8v2.6h2.4M6 8.4h4M6 10.6h4',
  image: 'M2.8 3.8h10.4v8.4H2.8zM2.8 10l3-2.8 2.4 2.2 2-1.8 2.9 2.4M10.4 6.2h.01',
  plain: 'M4.2 2.8h5.2l2.4 2.4v8H4.2zM9.4 2.8v2.6h2.4',
};

function FileIcon({ path }: { readonly path: string }): React.JSX.Element {
  return (
    <svg className="gitFileIcon" viewBox="0 0 16 16" width="13" height="13" aria-hidden>
      <path
        d={KIND_GLYPH[fileKind(path)]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GitSidebar(): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const [git, setGit] = useState<EditorGit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<PreviewArtifact[]>([]);
  const [opened, setOpened] = useState<PreviewArtifact | null>(null);

  const [filter, setFilter] = useState('');
  const [searchOn, setSearchOn] = useState(false);
  const [menuOn, setMenuOn] = useState(false);
  const [tree, setTree] = useState(() => localStorage.getItem(TREE_KEY) !== 'list');
  const [base, setBase] = useState<string | null>(() => readBase(root));
  const [baseOn, setBaseOn] = useState(false);
  const [stageMenuOn, setStageMenuOn] = useState(false);
  const [showAll, setShowAll] = useState({ staged: false, work: false });
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<Record<string, EditorGitCommitFile[]>>(
    {},
  );

  const load = useCallback(
    async (nextBase: string | null): Promise<void> => {
      if (root === null) return;
      try {
        setGit(await window.builderHelm.editor.git(root, nextBase));
        setError(null);
      } catch (cause) {
        setGit(null);
        setError(cause instanceof Error ? cause.message : 'Git failed');
      }
    },
    [root],
  );

  useEffect(() => {
    if (root === null) {
      setGit(null);
      setError(null);
      return;
    }
    const stored = readBase(root);
    setBase(stored);
    let alive = true;
    void window.builderHelm.editor
      .git(root, stored)
      .then((next) => {
        if (!alive) return;
        setGit(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setGit(null);
        setError(cause instanceof Error ? cause.message : 'Git failed');
      });
    return () => {
      alive = false;
    };
  }, [root]);

  useEffect(() => {
    if (root === null || git === null) {
      setEvidence([]);
      return;
    }
    let alive = true;
    void window.builderHelm.browser
      .artifacts({ root })
      .then((next) => {
        if (alive) setEvidence(next);
      })
      .catch(() => {
        if (alive) setEvidence([]);
      });
    return () => {
      alive = false;
    };
  }, [root, git?.headSha]);

  async function stage(path: string | undefined, staged: boolean): Promise<void> {
    if (root === null) return;
    setBusy(true);
    setError(null);
    try {
      await window.builderHelm.editor.gitStage({ root, path, staged });
      await load(base);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stage failed');
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (root === null || message.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await window.builderHelm.editor.gitCommit({ root, message: message.trim() });
      setMessage('');
      await load(base);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commit failed');
    } finally {
      setBusy(false);
    }
  }

  /** Files load once per commit and stay cached; the row only toggles after that. */
  async function toggleCommit(sha: string): Promise<void> {
    if (openSha === sha) {
      setOpenSha(null);
      return;
    }
    setOpenSha(sha);
    if (root === null || commitFiles[sha] !== undefined) return;
    try {
      const files = await window.builderHelm.editor.gitCommitFiles({ root, sha });
      setCommitFiles((current) => ({ ...current, [sha]: files }));
    } catch {
      setCommitFiles((current) => ({ ...current, [sha]: [] }));
    }
  }

  function chooseBase(next: string | null): void {
    setBase(next);
    setBaseOn(false);
    if (root !== null) {
      if (next === null) localStorage.removeItem(`${BASE_KEY}.${root}`);
      else localStorage.setItem(`${BASE_KEY}.${root}`, next);
    }
    void load(next);
  }

  if (root === null) {
    return (
      <aside className="gitSide" aria-label="Git">
        <p className="editorEmpty">Open a Space to see git.</p>
      </aside>
    );
  }
  if (git === null && error !== null) {
    return (
      <aside className="gitSide" aria-label="Git">
        <p className="browserError" role="alert">
          {error}
        </p>
      </aside>
    );
  }
  if (git === null) {
    return (
      <aside className="gitSide" aria-label="Git">
        <p className="editorEmpty">This folder is not a git repository.</p>
      </aside>
    );
  }

  const needle = filter.trim().toLowerCase();
  const matches = (change: GitChange): boolean =>
    needle.length === 0 || change.path.toLowerCase().includes(needle);
  const staged = git.changes.filter((item) => item.staged && matches(item));
  const work = git.changes.filter((item) => !item.staged && matches(item));

  function section(
    id: 'staged' | 'work',
    label: string,
    rows: readonly GitChange[],
    empty: string,
    act: (change: GitChange) => void,
    actLabel: string,
  ): React.JSX.Element {
    const all = showAll[id];
    const visible = all ? rows : rows.slice(0, SECTION_CAP);
    return (
      <section className="gitGroup">
        <header className="gitGroupHead">
          <span className="gitGroupName">{label}</span>
          <strong className="gitGroupCount">{rows.length}</strong>
          {rows.length > SECTION_CAP ? (
            <button
              type="button"
              className="gitViewAll"
              onClick={() => setShowAll((current) => ({ ...current, [id]: !all }))}
            >
              {all ? 'View less' : 'View all'}
            </button>
          ) : null}
        </header>
        {rows.length === 0 ? (
          <p className="gitGroupEmpty">{empty}</p>
        ) : (
          <ul className="gitRows">
            {groupChanges(visible, tree).map((row) =>
              row.kind === 'folder' ? (
                <li key={`d-${id}-${row.label}`} className="gitFolder">
                  <span>{row.label}</span>
                  <strong>{row.count}</strong>
                </li>
              ) : (
                <li
                  key={`${id}-${row.change.path}`}
                  className={row.indent ? 'gitRow gitRowIn' : 'gitRow'}
                >
                  <button
                    type="button"
                    className="gitRowPick"
                    onClick={() => setPicked(row.change.path)}
                  >
                    <FileIcon path={row.change.path} />
                    <span className="gitRowName">{fileName(row.change.path)}</span>
                    {tree ? null : (
                      <small className="gitRowDir">{dirLabel(row.change.path)}</small>
                    )}
                    {row.change.added > 0 ? (
                      <span className="gitAdded">+{row.change.added}</span>
                    ) : null}
                    {row.change.removed > 0 ? (
                      <span className="gitRemoved">−{row.change.removed}</span>
                    ) : null}
                    <em
                      className="gitBadge"
                      title={statusLabel(row.change.code)}
                      aria-label={statusLabel(row.change.code)}
                    >
                      {row.change.code}
                    </em>
                  </button>
                  <button
                    type="button"
                    className="gitAct"
                    disabled={busy}
                    title={actLabel}
                    aria-label={`${actLabel} ${row.change.path}`}
                    onClick={() => act(row.change)}
                  >
                    {actLabel === 'Unstage' ? '−' : '+'}
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    );
  }

  return (
    <aside className="gitSide" aria-label="Git">
      <div className="gitToolbar">
        <button
          type="button"
          className={searchOn ? 'gitToolOn' : undefined}
          aria-label="Filter files by name"
          aria-pressed={searchOn}
          title="Filter files by name"
          onClick={() => {
            setSearchOn(!searchOn);
            if (searchOn) setFilter('');
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <circle
              cx="7"
              cy="7"
              r="4.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="m10.2 10.2 3 3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {searchOn ? (
          <input
            className="gitFilter"
            value={filter}
            autoFocus
            placeholder="Filter files by name"
            aria-label="Filter files by name"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFilter('');
                setSearchOn(false);
              }
            }}
          />
        ) : (
          <span className="gitToolbarGap" />
        )}
        <button
          type="button"
          className={menuOn ? 'gitToolOn' : undefined}
          aria-label="More git actions"
          aria-expanded={menuOn}
          aria-haspopup="menu"
          title="More"
          onClick={() => setMenuOn(!menuOn)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <circle cx="3.6" cy="8" r="1.15" fill="currentColor" />
            <circle cx="8" cy="8" r="1.15" fill="currentColor" />
            <circle cx="12.4" cy="8" r="1.15" fill="currentColor" />
          </svg>
        </button>
        {menuOn ? (
          <div className="gitMenu" role="menu" onMouseLeave={() => setMenuOn(false)}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setTree(!tree);
                localStorage.setItem(TREE_KEY, tree ? 'list' : 'tree');
                setMenuOn(false);
              }}
            >
              {tree ? 'View as list' : 'View as tree'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setBaseOn(true);
                setMenuOn(false);
              }}
            >
              Change Base Ref…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOn(false);
                void load(base);
              }}
            >
              Refresh branch compare
            </button>
          </div>
        ) : null}
      </div>

      <header className="gitHead">
        <span className={git.detached ? 'gitChip gitChipWarn' : 'gitChip'}>
          {git.detached ? `Detached HEAD · ${git.headSha.slice(0, 7)}` : git.branch}
        </span>
        <span className="gitTrack">
          {git.upstream === null ? 'No upstream' : `→ ${git.upstream}`}
          {git.aheadCount > 0 ? <em>↑{git.aheadCount}</em> : null}
          {git.behindCount > 0 ? <em>↓{git.behindCount}</em> : null}
        </span>
        {base !== null ? (
          <span className="gitTrack">
            Base <code>{base}</code>
            <button type="button" className="gitLink" onClick={() => chooseBase(null)}>
              clear
            </button>
          </span>
        ) : null}
      </header>

      {baseOn ? (
        <div className="gitBasePick">
          <label htmlFor="gitBaseRef">Base ref</label>
          <select
            id="gitBaseRef"
            value={base ?? ''}
            onChange={(event) =>
              chooseBase(event.target.value === '' ? null : event.target.value)
            }
          >
            <option value="">HEAD history</option>
            {git.branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button type="button" className="gitLink" onClick={() => setBaseOn(false)}>
            Close
          </button>
        </div>
      ) : null}

      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}

      <form
        className="gitCommit"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <textarea
          className="gitMessage"
          value={message}
          rows={2}
          placeholder="Message"
          disabled={busy || staged.length === 0}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
        />
        <div className="gitCommitRow">
          <div className="gitSplit">
            <button
              type="button"
              disabled={busy || work.length === 0}
              onClick={() => void stage(undefined, true)}
            >
              + Stage All
            </button>
            <button
              type="button"
              className="gitSplitMore"
              aria-label="More staging actions"
              aria-expanded={stageMenuOn}
              aria-haspopup="menu"
              disabled={busy}
              onClick={() => setStageMenuOn(!stageMenuOn)}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
                <path
                  d="m4.4 6.4 3.6 3.4 3.6-3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {stageMenuOn ? (
              <div
                className="gitMenu gitMenuUp"
                role="menu"
                onMouseLeave={() => setStageMenuOn(false)}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={staged.length === 0}
                  onClick={() => {
                    setStageMenuOn(false);
                    void stage(undefined, false);
                  }}
                >
                  Unstage all
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setStageMenuOn(false);
                    void load(base);
                  }}
                >
                  Refresh status
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="submit"
            className="gitCommitGo"
            disabled={busy || staged.length === 0 || message.trim().length === 0}
          >
            Commit
          </button>
        </div>
      </form>

      <div className="gitLists">
        {section(
          'staged',
          'STAGED',
          staged,
          'No staged changes',
          (change) => void stage(change.path, false),
          'Unstage',
        )}
        {section(
          'work',
          'CHANGES',
          work,
          'Working tree clean',
          (change) => void stage(change.path, true),
          'Stage',
        )}

        <section className="gitGroup">
          <header className="gitGroupHead">
            <span className="gitGroupName">COMMITS</span>
            <strong className="gitGroupCount">
              {git.commits.length}
              {git.commitTotal > git.commits.length ? ' +' : ''}
            </strong>
            <button
              type="button"
              className="gitViewAll"
              title={
                base === null
                  ? `${git.commitTotal} commits reachable from HEAD`
                  : `Commits on HEAD that ${base} does not have`
              }
              aria-label="What this list shows"
            >
              ?
            </button>
            <button
              type="button"
              className="gitViewAll"
              title="Refresh commits"
              aria-label="Refresh commits"
              onClick={() => void load(base)}
            >
              ↻
            </button>
          </header>
          {git.commits.length === 0 ? (
            <p className="gitGroupEmpty">
              {base === null ? 'No commits yet' : `Nothing ahead of ${base}`}
            </p>
          ) : (
            <ol className="gitGraph">
              {git.commits.map((entry, index) => {
                const open = openSha === entry.sha;
                const files = commitFiles[entry.sha];
                return (
                  <li key={entry.sha} className={open ? 'gitNode gitNodeOn' : 'gitNode'}>
                    <span className="gitLane" aria-hidden>
                      <i className={index === 0 ? 'gitDot gitDotHead' : 'gitDot'} />
                      {index < git.commits.length - 1 ? <b className="gitWire" /> : null}
                    </span>
                    <button
                      type="button"
                      className="gitNodeRow"
                      aria-expanded={open}
                      onClick={() => void toggleCommit(entry.sha)}
                    >
                      <span className="gitChevron" aria-hidden>
                        {open ? '⌄' : '›'}
                      </span>
                      <span className="gitNodeSubject">{entry.subject}</span>
                      <code className="gitNodeSha">{entry.shortSha}</code>
                    </button>
                    {open ? (
                      <ul className="gitNodeFiles">
                        {files === undefined ? (
                          <li className="gitGroupEmpty">Loading…</li>
                        ) : files.length === 0 ? (
                          <li className="gitGroupEmpty">No file changes</li>
                        ) : (
                          files.map((file) => (
                            <li key={file.path}>
                              <FileIcon path={file.path} />
                              <span className="gitRowName">{fileName(file.path)}</span>
                              {file.added > 0 ? (
                                <span className="gitAdded">+{file.added}</span>
                              ) : null}
                              {file.removed > 0 ? (
                                <span className="gitRemoved">−{file.removed}</span>
                              ) : null}
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {evidence.length > 0 ? (
        <section className="gitLists" aria-label="Preview evidence">
          <header className="gitGroupHead">
            <span className="gitGroupName">EVIDENCE ON {git.headSha.slice(0, 7)}</span>
          </header>
          {evidence.some((item) => item.headSha !== git.headSha) ? (
            <p className="browserError" role="alert">
              Head moved since proof. Land refused until you re-capture.
            </p>
          ) : null}
          <ul className="gitRows">
            {evidence.map((item) => (
              <li key={item.id} className="gitRow">
                <button
                  type="button"
                  className="gitRowPick"
                  onClick={() => setOpened(item)}
                >
                  <span className="gitRowName">
                    {item.kind}
                    {item.detail !== null ? ` · ${item.detail.slice(0, 80)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {opened !== null && opened.pngBase64 !== null ? (
            <img
              className="browserShot"
              src={`data:image/png;base64,${opened.pngBase64}`}
              alt={`${opened.kind} evidence`}
            />
          ) : null}
          {opened !== null && opened.nodes !== null ? (
            <ol className="browserSnapshot" aria-label="Snapshot evidence">
              {opened.nodes.map((node) => (
                <li key={node.ref}>
                  <code>{node.ref}</code> {node.role} {node.name}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      <div className="gitFooter">
        {picked === null ? 'Select a file to inspect it.' : fileName(picked)}
      </div>
    </aside>
  );
}

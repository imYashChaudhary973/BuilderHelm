import type { PreviewArtifact } from '@builderhelm/protocol/browser';
import type { EditorGit } from '@builderhelm/protocol/editor';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';
import { ReviewPane } from './review-pane.js';
function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null
  );
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function dirLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

export function GitSidebar(): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const [git, setGit] = useState<EditorGit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'changes' | 'history' | 'review'>('changes');
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<PreviewArtifact[]>([]);
  const [opened, setOpened] = useState<PreviewArtifact | null>(null);

  useEffect(() => {
    if (root === null) {
      setGit(null);
      setError(null);
      return;
    }
    let alive = true;
    void window.builderHelm.editor
      .git(root)
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
      setGit(await window.builderHelm.editor.gitStage({ root, path, staged }));
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
      setGit(
        await window.builderHelm.editor.gitCommit({ root, message: message.trim() }),
      );
      setMessage('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commit failed');
    } finally {
      setBusy(false);
    }
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

  const staged = git.changes.filter((item) => item.staged);
  const work = git.changes.filter((item) => !item.staged);

  return (
    <aside className="gitSide" aria-label="Git">
      <div className="gitTop">
        <div className="gitBranch">
          <span>{git.branch}</span>
          {git.aheadCount > 0 ? <em>↑{git.aheadCount}</em> : null}
          {git.behindCount > 0 ? <em>↓{git.behindCount}</em> : null}
        </div>
      </div>
      <div className="gitViews">
        <button
          type="button"
          className={view === 'changes' ? 'gitViewOn' : undefined}
          onClick={() => setView('changes')}
        >
          Changes <strong>{git.changes.length}</strong>
        </button>
        <button
          type="button"
          className={view === 'history' ? 'gitViewOn' : undefined}
          onClick={() => setView('history')}
        >
          History
        </button>
        <button
          type="button"
          className={view === 'review' ? 'gitViewOn' : undefined}
          onClick={() => setView('review')}
        >
          Review
        </button>
      </div>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      {view === 'changes' ? (
        <div className="gitLists">
          <section>
            <header>
              Staged <strong>{staged.length}</strong>
            </header>
            {staged.length === 0 ? (
              <p>No staged changes</p>
            ) : (
              <ul className="gitChanges">
                {staged.map((change) => (
                  <li key={`s-${change.path}`}>
                    <button type="button" onClick={() => setPicked(change.path)}>
                      <em>{change.code}</em>
                      <span>{fileName(change.path)}</span>
                      <small>{dirLabel(change.path)}</small>
                    </button>
                    <button
                      type="button"
                      className="gitAct"
                      disabled={busy}
                      onClick={() => void stage(change.path, false)}
                    >
                      −
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <header>
              Changes <strong>{work.length}</strong>
              {work.length > 0 ? (
                <button
                  type="button"
                  className="gitAct"
                  disabled={busy}
                  onClick={() => void stage(undefined, true)}
                >
                  Stage all
                </button>
              ) : null}
            </header>
            {work.length === 0 ? (
              <p>Working tree clean</p>
            ) : (
              <ul className="gitChanges">
                {work.map((change) => (
                  <li key={`w-${change.path}`}>
                    <button type="button" onClick={() => setPicked(change.path)}>
                      <em>{change.code}</em>
                      <span>{fileName(change.path)}</span>
                      <small>{dirLabel(change.path)}</small>
                    </button>
                    <button
                      type="button"
                      className="gitAct"
                      disabled={busy}
                      onClick={() => void stage(change.path, true)}
                    >
                      +
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : view === 'review' ? (
        <ReviewPane />
      ) : (
        <ol className="gitLog">
          {git.commits.map((commit) => (
            <li key={commit.sha}>
              <code>{commit.shortSha}</code>
              <span>{commit.subject}</span>
            </li>
          ))}
        </ol>
      )}
      <form
        className="gitCommit"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <input
          value={message}
          placeholder="Commit message"
          disabled={busy || staged.length === 0}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          type="submit"
          disabled={busy || staged.length === 0 || message.trim().length === 0}
        >
          Commit
        </button>
      </form>
      {evidence.length > 0 ? (
        <section className="gitLists" aria-label="Preview evidence">
          <header>Evidence on {git.headSha.slice(0, 7)}</header>
          {evidence.some((item) => item.headSha !== git.headSha) ? (
            <p className="browserError" role="alert">
              Head moved since proof. Land refused until you re-capture.
            </p>
          ) : null}
          <ul className="gitChanges">
            {evidence.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setOpened(item)}>
                  {item.kind}
                  {item.detail !== null ? ` · ${item.detail.slice(0, 80)}` : ''}
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
          {opened !== null && opened.detail !== null ? (
            <p className="browserHint">{opened.detail}</p>
          ) : null}
        </section>
      ) : (
        <p className="browserHint">No preview proof on this revision.</p>
      )}
      <div className="gitFooter">
        {picked === null ? 'Select a file to inspect it.' : fileName(picked)}
      </div>
    </aside>
  );
}

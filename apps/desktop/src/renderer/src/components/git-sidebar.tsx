import type { EditorGit } from '@zero/protocol/editor';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null;
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function GitSidebar(): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const [git, setGit] = useState<EditorGit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'changes' | 'history'>('changes');

  useEffect(() => {
    if (root === null) {
      setGit(null);
      setError(null);
      return;
    }
    let alive = true;
    void window.zero.editor
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

  if (root === null) {
    return (
      <aside className="gitSide" aria-label="Git">
        <p className="editorEmpty">Open a Space to see git.</p>
      </aside>
    );
  }
  if (error !== null) {
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

  return (
    <aside className="gitSide" aria-label="Git">
      <div className="gitBranch">
        <span>{git.branch}</span>
        {git.aheadCount > 0 ? <em>↑{git.aheadCount}</em> : null}
        {git.behindCount > 0 ? <em>↓{git.behindCount}</em> : null}
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
      </div>
      {view === 'changes' ? (
        git.changes.length === 0 ? (
          <p className="editorEmpty">Working tree clean.</p>
        ) : (
          <ul className="gitChanges">
            {git.changes.map((change) => (
              <li key={change.path}>
                <em>{change.code}</em>
                <span>{fileName(change.path)}</span>
              </li>
            ))}
          </ul>
        )
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
    </aside>
  );
}

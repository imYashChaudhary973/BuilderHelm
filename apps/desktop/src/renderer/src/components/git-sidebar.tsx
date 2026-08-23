import type { EditorGit } from '@zero/protocol/editor';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';

function workspaceFolder(
  spaces: ReturnType<typeof useSpaces>,
): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null;
}

export function GitSidebar(): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const [git, setGit] = useState<EditorGit | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <aside className="gitSide" aria-label="Git">
      {root === null ? (
        <p className="editorBody">Open a Space to see git.</p>
      ) : error !== null ? (
        <p className="browserError" role="alert">
          {error}
        </p>
      ) : git === null ? (
        <p className="editorBody">This folder is not a git repository.</p>
      ) : (
        <>
          <div className="gitHead">
            <strong>{git.directoryName}</strong>
            <span>{git.branch}</span>
          </div>
          <p className="gitMeta">
            {git.dirtyCount === 0 ? 'Clean' : `${String(git.dirtyCount)} changed`}
            {git.aheadCount > 0 ? ` · +${String(git.aheadCount)}` : ''}
            {git.behindCount > 0 ? ` · −${String(git.behindCount)}` : ''}
          </p>
          <ol className="gitLog">
            {git.commits.map((commit) => (
              <li key={commit.sha}>
                <code>{commit.shortSha}</code>
                <span>{commit.subject}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

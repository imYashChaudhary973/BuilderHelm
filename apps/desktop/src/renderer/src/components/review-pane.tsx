import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CorrelationId } from '@builderhelm/shared';
import type { ReviewDiffLine } from '@builderhelm/protocol/review';
import { useMemo, useState } from 'react';

import { useSpaces } from '../space-store.js';

function workspaceFolder(spaces: ReturnType<typeof useSpaces>): string | null {
  if (spaces.draft || spaces.activeId === null) return null;
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ?? null
  );
}

function lineClass(type: ReviewDiffLine['type']): string {
  if (type === 'add') return 'reviewLineAdd';
  if (type === 'del') return 'reviewLineDel';
  return 'reviewLineCtx';
}

export function ReviewPane(): React.JSX.Element {
  const spaces = useSpaces();
  const root = workspaceFolder(spaces);
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkCommand, setCheckCommand] = useState('pnpm test');
  const [pendingLand, setPendingLand] = useState<{
    readonly taskId: string;
    readonly headSha: string;
  } | null>(null);

  const git = useQuery({
    queryKey: ['review-git', root],
    queryFn: () => window.builderHelm.editor.git(root!),
    enabled: root !== null,
  });
  const diff = useQuery({
    queryKey: ['review-diff', root, picked],
    queryFn: () =>
      window.builderHelm.review.diff({
        root: root!,
        ...(picked === null ? {} : { path: picked }),
      }),
    enabled: root !== null,
  });
  const comments = useQuery({
    queryKey: ['review-comments', root, picked],
    queryFn: () =>
      window.builderHelm.review.comments({
        root: root!,
        ...(picked === null ? {} : { path: picked }),
      }),
    enabled: root !== null,
  });
  const checks = useQuery({
    queryKey: ['review-checks', root],
    queryFn: () => window.builderHelm.review.checks({ root: root! }),
    enabled: root !== null,
  });
  const swarm = useQuery({
    queryKey: ['review-swarm'],
    queryFn: () =>
      window.builderHelm.swarm.latest({
        correlationId: crypto.randomUUID() as CorrelationId,
      }),
  });
  const swarmState = useQuery({
    queryKey: ['review-swarm-state', swarm.data?.id],
    queryFn: () =>
      window.builderHelm.swarm.state({
        correlationId: crypto.randomUUID() as CorrelationId,
        runId: swarm.data!.id,
      }),
    enabled: swarm.data !== null && swarm.data !== undefined,
  });
  const ci = useQuery({
    queryKey: ['review-ci', root],
    queryFn: () => window.builderHelm.review.ci({ root: root! }),
    enabled: false,
  });

  const files = useMemo(() => {
    const changes = git.data?.changes ?? [];
    const unique = [...new Set(changes.map((item) => item.path))];
    return unique;
  }, [git.data]);
  const reviewTasks = (swarmState.data?.tasks ?? []).filter(
    (task) => task.status === 'review',
  );
  const activePath = picked ?? files[0] ?? null;
  const activeDiff =
    (diff.data ?? []).find((file) => file.path === activePath) ??
    (diff.data ?? [])[0] ??
    null;

  const addComment = useMutation({
    mutationFn: (body: string) => {
      if (root === null || activePath === null) throw new Error('Pick a file');
      const line =
        activeDiff?.hunks[0]?.lines.find((item) => item.newLine !== null)?.newLine ?? 1;
      return window.builderHelm.review.comment({
        root,
        path: activePath,
        side: 'new',
        line,
        body,
      });
    },
    onSuccess: async () => {
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['review-comments'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const runCheck = useMutation({
    mutationFn: () => {
      if (root === null) throw new Error('Open a Space first');
      const command = checkCommand
        .trim()
        .split(/\s+/)
        .filter((part) => part.length > 0);
      return window.builderHelm.review.check({ root, command });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['review-checks'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const draftPr = useMutation({
    mutationFn: () => {
      if (root === null) throw new Error('Open a Space first');
      return window.builderHelm.review.prDraft({
        root,
        title: prTitle.trim(),
        body: prBody,
      });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  /**
   * Landing is two steps on purpose. The first inspects the branch and shows
   * the exact SHA to be landed; the second lands that SHA. A single click that
   * read the tip and immediately landed it would certify nothing — the human
   * would be approving whatever the agent pushed a moment ago. Between the
   * confirmation and the merge, `landBranch` re-reads the tip and fails closed.
   */
  const landTask = useMutation({
    mutationFn: async (taskId: string) => {
      const run = swarm.data;
      const state = swarmState.data;
      if (run === null || run === undefined || state === undefined) {
        throw new Error('No swarm run');
      }
      const task = state.tasks.find((item) => item.id === taskId);
      const seat = state.seats.find((item) => item.id === task?.seatId);
      if (root === null || seat?.branch === null || seat === undefined) {
        throw new Error('Task has no branch');
      }
      const confirmed = pendingLand;
      if (confirmed === null || confirmed.taskId !== taskId) {
        const found = await window.builderHelm.review.inspectLand({
          root,
          branch: seat.branch,
          reviewedHead: git.data?.headSha ?? '0'.repeat(40),
        });
        if (found.unmerged.length > 0) {
          throw new Error(`Unmerged files: ${found.unmerged.join(', ')}`);
        }
        setPendingLand({ taskId, headSha: found.headSha });
        throw new Error(
          `Review ${found.headSha.slice(0, 7)} on ${found.branch}, then press Land again to merge that commit.`,
        );
      }
      return window.builderHelm.swarm.landTask({
        correlationId: crypto.randomUUID() as CorrelationId,
        input: { runId: run.id, taskId, reviewedHead: confirmed.headSha },
      });
    },
    onSuccess: async () => {
      setPendingLand(null);
      await queryClient.invalidateQueries({ queryKey: ['review-swarm-state'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  if (root === null) {
    return (
      <section className="reviewPage" aria-labelledby="review-title">
        <p className="reviewEmpty">Open a Space to review its Git changes.</p>
      </section>
    );
  }

  return (
    <section className="reviewPage" aria-labelledby="review-title">
      <header className="reviewHeader">
        <div>
          <h1 id="review-title">Review</h1>
          <p>
            {git.data?.branch ?? '…'} · {git.data?.headSha.slice(0, 7) ?? ''}
          </p>
        </div>
      </header>
      {error !== null ? (
        <p className="browserError" role="alert">
          {error}
        </p>
      ) : null}
      <div className="reviewWorkspace">
        <aside className="reviewFiles" aria-label="Changed files">
          <span className="memorySectionLabel">Files</span>
          {files.length === 0 ? (
            <p>Working tree clean</p>
          ) : (
            <ul>
              {files.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className={path === activePath ? 'reviewFileOn' : undefined}
                    onClick={() => setPicked(path)}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="reviewDiff" aria-label="Unified diff">
          {activeDiff === null ? (
            <p>Select a file to inspect the diff.</p>
          ) : (
            <>
              <h2>{activeDiff.path}</h2>
              {activeDiff.hunks.map((hunk) => (
                <pre key={hunk.header} className="reviewHunk">
                  <code>
                    {hunk.lines.map((line, index) => (
                      <span
                        key={`${hunk.header}-${String(index)}`}
                        className={lineClass(line.type)}
                      >
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                        {line.text}
                        {'\n'}
                      </span>
                    ))}
                  </code>
                </pre>
              ))}
              <form
                className="reviewComment"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (comment.trim().length > 0) addComment.mutate(comment.trim());
                }}
              >
                <input
                  value={comment}
                  placeholder="Line comment for the owning agent"
                  onChange={(event) => setComment(event.target.value)}
                />
                <button type="submit" disabled={addComment.isPending}>
                  Send
                </button>
              </form>
              <ul className="reviewComments">
                {(comments.data ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>
                      {item.path}:{item.line}
                    </strong>
                    <span>{item.body}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <aside className="reviewShip" aria-label="Checks and land">
          <section>
            <span className="memorySectionLabel">Checks</span>
            <form
              className="reviewComment"
              onSubmit={(event) => {
                event.preventDefault();
                runCheck.mutate();
              }}
            >
              <input
                value={checkCommand}
                onChange={(event) => setCheckCommand(event.target.value)}
                aria-label="Check command"
              />
              <button type="submit" disabled={runCheck.isPending}>
                Run
              </button>
            </form>
            <ul className="reviewChecks">
              {(checks.data ?? []).map((item) => (
                <li key={item.id}>
                  <code>{item.command.join(' ')}</code>
                  <em>
                    {item.exitCode === 0 ? 'pass' : `exit ${String(item.exitCode)}`}
                  </em>
                  <small>{item.headSha.slice(0, 7)}</small>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <span className="memorySectionLabel">Pull request</span>
            <input
              value={prTitle}
              placeholder="Title"
              onChange={(event) => setPrTitle(event.target.value)}
            />
            <textarea
              value={prBody}
              placeholder="Description"
              onChange={(event) => setPrBody(event.target.value)}
            />
            <button
              type="button"
              disabled={draftPr.isPending || prTitle.trim().length === 0}
              onClick={() => draftPr.mutate()}
            >
              Draft PR
            </button>
            {draftPr.data?.url !== undefined && draftPr.data.url !== null ? (
              <a href={draftPr.data.url}>{draftPr.data.url}</a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void ci.refetch();
              }}
            >
              Refresh CI
            </button>
            {ci.data?.stale === true && (
              <p className="reviewStale" role="status">
                These checks ran against {ci.data.prHead?.slice(0, 7)}, not the reviewed{' '}
                {ci.data.reviewedHead?.slice(0, 7)}.
              </p>
            )}
            <ul className="reviewChecks">
              {(ci.data?.checks ?? []).map((item) => (
                <li key={item.name}>
                  <span>{item.name}</span>
                  <em>{item.state}</em>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <span className="memorySectionLabel">Land</span>
            {reviewTasks.length === 0 ? (
              <p>No swarm tasks waiting for review.</p>
            ) : (
              <ul className="reviewChecks">
                {reviewTasks.map((task) => (
                  <li key={task.id}>
                    <span>{task.title}</span>
                    <button
                      type="button"
                      disabled={landTask.isPending}
                      onClick={() => landTask.mutate(task.id)}
                    >
                      Land
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type {
  KanbanCard,
  KanbanCardSource,
  KanbanColumn,
  KanbanProject,
} from '@builderhelm/protocol/kanban';
import type { GitHubIssue, LinearIssue } from '@builderhelm/protocol/integrations';
import { useEffect, useState } from 'react';

import { useBoards } from '../board-store.js';
import { queueSwarmHandoff } from '../swarm-persist.js';

const COLUMNS: readonly { id: KanbanColumn; label: string }[] = [
  { id: 'idea', label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'review', label: 'In Review' },
  { id: 'shipped', label: 'Complete' },
  { id: 'cancelled', label: 'Cancelled' },
];

function sourceLabel(source: KanbanCardSource): string {
  return source.provider === 'github'
    ? `${source.repository} #${source.number}`
    : source.identifier;
}

function neighbor(id: KanbanColumn, delta: -1 | 1): KanbanColumn | undefined {
  return COLUMNS[COLUMNS.findIndex((column) => column.id === id) + delta]?.id;
}

function BoardGlyph({ size = 18 }: { readonly size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect
        x="4.5"
        y="5.5"
        width="4"
        height="13"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="10"
        y="5.5"
        width="4"
        height="8.5"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect
        x="15.5"
        y="5.5"
        width="4"
        height="11"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ProjectChooser({
  projects,
  loading,
  name,
  busy,
  error,
  onNameChange,
  onCreate,
  onOpen,
}: {
  readonly projects: readonly KanbanProject[];
  readonly loading: boolean;
  readonly name: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onNameChange: (name: string) => void;
  readonly onCreate: () => void;
  readonly onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <section
      className="boardChooser"
      aria-labelledby="board-chooser-title"
      data-core-status="ready"
    >
      <header className="boardChooserHeader">
        <span className="kanbanMark">
          <BoardGlyph />
        </span>
        <div>
          <h1 id="board-chooser-title">BuilderHelm Board</h1>
          <p>Continue a project board or create a clean one for new work.</p>
        </div>
      </header>

      {error !== null ? (
        <p className="wizardError" role="alert">
          {error}
        </p>
      ) : null}

      <div className="boardChooserGrid">
        <form
          className="boardProjectCreate"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0) onCreate();
          }}
        >
          <span className="boardChooserStep">New project board</span>
          <h2>What are you working on?</h2>
          <p>Each project keeps its own tasks and stage history.</p>
          <label>
            <span>Project name</span>
            <input
              value={name}
              maxLength={120}
              placeholder="ZenVoice"
              disabled={busy}
              autoFocus={projects.length === 0}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <button
            className="primaryButton"
            type="submit"
            disabled={busy || name.trim().length === 0}
          >
            {busy ? 'Creating…' : 'Create project board'}
          </button>
        </form>

        <section className="boardProjectLibrary" aria-labelledby="board-library-title">
          <div>
            <span className="boardChooserStep">Previous boards</span>
            <h2 id="board-library-title">Continue where you stopped</h2>
          </div>
          {loading ? (
            <p className="boardChooserEmpty">Loading project boards…</p>
          ) : projects.length === 0 ? (
            <p className="boardChooserEmpty">
              No previous boards yet. Create the first one.
            </p>
          ) : (
            <ul>
              {projects.map((project) => (
                <li key={project.id}>
                  <button type="button" onClick={() => onOpen(project.id)}>
                    <span className="boardProjectIcon">
                      <BoardGlyph size={16} />
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        {project.taskCount} {project.taskCount === 1 ? 'task' : 'tasks'}
                      </small>
                    </span>
                    <span>Continue →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
function GitHubIntakePanel({
  issues,
  loading,
  refreshing,
  busy,
  error,
  currentWorkspace,
  onRefresh,
  onClose,
  onImport,
  onOpen,
}: {
  readonly issues: readonly GitHubIssue[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly currentWorkspace: string;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
  readonly onImport: (issue: GitHubIssue) => void;
  readonly onOpen: (url: string) => void;
}): React.JSX.Element {
  return (
    <section className="githubIntake" aria-labelledby="github-intake-title">
      <header>
        <div>
          <h2 id="github-intake-title">Assigned GitHub issues</h2>
          <p>Import work explicitly. BuilderHelm never starts an agent from this list.</p>
        </div>
        <div>
          <button type="button" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" aria-label="Close GitHub issue list" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {error !== null ? (
        <p className="githubIntakeError" role="alert">
          {error}
        </p>
      ) : loading ? (
        <ul aria-label="Loading assigned GitHub issues">
          {[0, 1, 2].map((row) => (
            <li className="githubIssueSkeleton" key={row} aria-hidden="true">
              <span />
              <span />
            </li>
          ))}
        </ul>
      ) : issues.length === 0 ? (
        <p className="githubIntakeEmpty">
          No open issues are assigned to the active GitHub CLI account.
        </p>
      ) : (
        <ul>
          {issues.map((issue) => {
            const imported = issue.importedCardId !== null;
            const importedHere = issue.importedWorkspaceId === currentWorkspace;
            return (
              <li key={issue.id}>
                <button
                  className="githubIssueIdentity"
                  type="button"
                  title={`Open ${issue.repository} issue ${issue.number}`}
                  onClick={() => onOpen(issue.url)}
                >
                  <span>
                    {issue.repository} #{issue.number}
                  </span>
                  <strong>{issue.title}</strong>
                </button>
                <button
                  className="githubIssueImport"
                  type="button"
                  disabled={busy || imported}
                  onClick={() => onImport(issue)}
                >
                  {imported ? (importedHere ? 'Added' : 'On another board') : 'Import'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LinearIntakePanel({
  issues,
  loading,
  refreshing,
  busy,
  configured,
  error,
  currentWorkspace,
  keyDraft,
  onKeyDraft,
  onSaveKey,
  onDisconnect,
  onRefresh,
  onClose,
  onImport,
  onOpen,
}: {
  readonly issues: readonly LinearIssue[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly busy: boolean;
  readonly configured: boolean;
  readonly error: string | null;
  readonly currentWorkspace: string;
  readonly keyDraft: string;
  readonly onKeyDraft: (value: string) => void;
  readonly onSaveKey: () => void;
  readonly onDisconnect: () => void;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
  readonly onImport: (issue: LinearIssue) => void;
  readonly onOpen: (url: string) => void;
}): React.JSX.Element {
  return (
    <section className="githubIntake" aria-labelledby="linear-intake-title">
      <header>
        <div>
          <h2 id="linear-intake-title">Assigned Linear issues</h2>
          <p>Import work explicitly. BuilderHelm never starts an agent from this list.</p>
        </div>
        <div>
          {configured ? (
            <button type="button" disabled={busy} onClick={onDisconnect}>
              Disconnect
            </button>
          ) : null}
          <button type="button" disabled={refreshing || !configured} onClick={onRefresh}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" aria-label="Close Linear issue list" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {configured ? null : (
        <form
          className="kanbanAdd"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveKey();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            aria-label="Linear API key"
            placeholder="Linear API key"
            value={keyDraft}
            disabled={busy}
            onChange={(event) => onKeyDraft(event.target.value)}
          />
          <button type="submit" disabled={busy || keyDraft.trim().length < 20}>
            Save key
          </button>
        </form>
      )}
      {error !== null ? (
        <p className="githubIntakeError" role="alert">
          {error}
        </p>
      ) : null}
      {configured && loading ? (
        <ul aria-label="Loading assigned Linear issues">
          {[0, 1, 2].map((row) => (
            <li className="githubIssueSkeleton" key={row} aria-hidden="true">
              <span />
              <span />
            </li>
          ))}
        </ul>
      ) : null}
      {configured && !loading && issues.length === 0 && error === null ? (
        <p className="githubIntakeEmpty">
          No open issues are assigned to the Linear account for this key.
        </p>
      ) : null}
      {configured && issues.length > 0 ? (
        <ul>
          {issues.map((issue) => {
            const imported = issue.importedCardId !== null;
            const importedHere = issue.importedWorkspaceId === currentWorkspace;
            return (
              <li key={issue.id}>
                <button
                  className="githubIssueIdentity"
                  type="button"
                  title={`Open ${issue.identifier}`}
                  onClick={() => onOpen(issue.url)}
                >
                  <span>{issue.identifier}</span>
                  <strong>{issue.title}</strong>
                </button>
                <button
                  className="githubIssueImport"
                  type="button"
                  disabled={busy || imported}
                  onClick={() => onImport(issue)}
                >
                  {imported ? (importedHere ? 'Added' : 'On another board') : 'Import'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
export function KanbanBoard(): React.JSX.Element {
  const boards = useBoards();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: ['kanban-projects'],
    queryFn: () => window.builderHelm.board.listProjects({}),
  });
  const selectedProject = projects.data?.find(
    (project) => project.id === boards.activeId,
  );
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [projectName, setProjectName] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<KanbanColumn | null>(null);
  const [compose, setCompose] = useState<KanbanColumn | null>(null);
  const [composeTitle, setComposeTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [githubOpen, setGithubOpen] = useState(false);
  const [linearOpen, setLinearOpen] = useState(false);
  const [linearKey, setLinearKey] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const githubIssues = useQuery({
    queryKey: ['github-assigned-issues'],
    enabled: githubOpen,
    queryFn: () => window.builderHelm.integrations.listGitHubIssues({}),
  });
  const linearStatus = useQuery({
    queryKey: ['linear-status'],
    enabled: linearOpen,
    queryFn: () => window.builderHelm.integrations.linearStatus(),
  });
  const linearConfigured = linearStatus.data?.configured === true;
  const linearIssues = useQuery({
    queryKey: ['linear-assigned-issues'],
    enabled: linearOpen && linearConfigured,
    queryFn: () => window.builderHelm.integrations.listLinearIssues({}),
  });

  useEffect(() => {
    if (projects.isSuccess && boards.activeId !== null && selectedProject === undefined) {
      boards.choose();
    }
  }, [boards, projects.isSuccess, selectedProject]);

  useEffect(() => {
    if (boards.activeId === null) {
      setCards([]);
      return;
    }
    let alive = true;
    void window.builderHelm.board
      .listCards({ workspace: boards.activeId })
      .then((next) => {
        if (!alive) return;
        setCards(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setCards([]);
        setError(cause instanceof Error ? cause.message : 'Board failed');
      });
    return () => {
      alive = false;
    };
  }, [boards.activeId]);

  const createProject = useMutation({
    mutationFn: (name: string) => window.builderHelm.board.createProject({ name }),
    onMutate: () => setError(null),
    onSuccess: async (project) => {
      setProjectName('');
      boards.open(project.id);
      await queryClient.invalidateQueries({ queryKey: ['kanban-projects'] });
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : 'Could not create that project board',
      ),
  });

  async function refreshProjects(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['kanban-projects'] });
  }

  async function addCard(
    nextTitle: string,
    column: KanbanColumn = 'idea',
  ): Promise<void> {
    const trimmed = nextTitle.trim();
    if (trimmed.length === 0 || selectedProject === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const card = await window.builderHelm.board.createCard({
        workspace: selectedProject.id,
        title: trimmed,
        column,
      });
      setCards((current) => [...current, card]);
      setTitle('');
      setComposeTitle('');
      setCompose(null);
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the card');
    } finally {
      setBusy(false);
    }
  }

  async function rename(card: KanbanCard, nextTitle: string): Promise<void> {
    const trimmed = nextTitle.trim();
    setEditingId(null);
    if (trimmed.length === 0 || trimmed === card.title) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.builderHelm.board.updateCard({
        id: card.id,
        title: trimmed,
      });
      setCards((current) => current.map((item) => (item.id === next.id ? next : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename the card');
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: KanbanCard): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.builderHelm.board.deleteCard({ id: card.id });
      setCards((current) => current.filter((item) => item.id !== card.id));
      if (editingId === card.id) setEditingId(null);
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the card');
    } finally {
      setBusy(false);
    }
  }

  async function move(card: KanbanCard, column: KanbanColumn): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await window.builderHelm.board.moveCard({ id: card.id, column });
      setCards((current) => current.map((item) => (item.id === next.id ? next : item)));
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not move the card');
    } finally {
      setBusy(false);
    }
  }

  async function dropCard(id: string, column: KanbanColumn): Promise<void> {
    setDraggedId(null);
    setDropColumn(null);
    const card = cards.find((item) => item.id === id);
    if (card === undefined || card.column === column) return;
    await move(card, column);
  }
  async function importGitHubIssue(issue: GitHubIssue): Promise<void> {
    if (selectedProject === undefined) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const card = await window.builderHelm.integrations.importGitHubIssue({
        workspace: selectedProject.id,
        url: issue.url,
      });
      if (card.workspace === selectedProject.id) {
        setCards((current) => {
          const exists = current.some((item) => item.id === card.id);
          return exists
            ? current.map((item) => (item.id === card.id ? card : item))
            : [...current, card];
        });
        setNotice(
          issue.importedCardId === null
            ? `Imported ${issue.repository} #${issue.number}`
            : 'That issue is already on this Board.',
        );
      } else {
        setNotice('That issue is already on another Board.');
      }
      await Promise.all([refreshProjects(), githubIssues.refetch()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import that issue');
    } finally {
      setBusy(false);
    }
  }

  async function importLinearIssue(issue: LinearIssue): Promise<void> {
    if (selectedProject === undefined) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const card = await window.builderHelm.integrations.importLinearIssue({
        workspace: selectedProject.id,
        url: issue.url,
      });
      if (card.workspace === selectedProject.id) {
        setCards((current) => {
          const exists = current.some((item) => item.id === card.id);
          return exists
            ? current.map((item) => (item.id === card.id ? card : item))
            : [...current, card];
        });
        setNotice(
          issue.importedCardId === null
            ? `Imported ${issue.identifier}`
            : 'That issue is already on this Board.',
        );
      } else {
        setNotice('That issue is already on another Board.');
      }
      await Promise.all([refreshProjects(), linearIssues.refetch()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import that issue');
    } finally {
      setBusy(false);
    }
  }

  async function saveLinearKey(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.builderHelm.integrations.saveLinearKey({ key: linearKey });
      setLinearKey('');
      await linearStatus.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that Linear key');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectLinear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.builderHelm.integrations.deleteLinearKey();
      await linearStatus.refetch();
      await queryClient.removeQueries({ queryKey: ['linear-assigned-issues'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect Linear');
    } finally {
      setBusy(false);
    }
  }

  async function syncLinkedIssue(card: KanbanCard): Promise<void> {
    const source = card.source;
    if (source === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nextState = source.state === 'open' ? 'closed' : 'open';
      const requestId = crypto.randomUUID();
      const result =
        source.provider === 'linear'
          ? await window.builderHelm.integrations.syncLinearIssue({
              cardId: card.id,
              state: nextState,
              requestId,
            })
          : await window.builderHelm.integrations.syncGitHubIssue({
              cardId: card.id,
              state: nextState,
              requestId,
            });
      setCards((current) =>
        current.map((item) => (item.id === result.card.id ? result.card : item)),
      );
      if (result.receipt.outcome === 'succeeded') {
        setNotice(`${result.receipt.detail} · Receipt ${result.receipt.id.slice(0, 8)}`);
        await Promise.all([
          refreshProjects(),
          source.provider === 'linear' ? linearIssues.refetch() : githubIssues.refetch(),
        ]);
      } else {
        setError(result.receipt.detail);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sync that issue');
    } finally {
      setBusy(false);
    }
  }

  function startGitHubIssue(card: KanbanCard): void {
    const source = card.source;
    if (source === null) return;
    const mission = [card.title, card.detail?.trim(), `Source: ${source.url}`]
      .filter((line): line is string => line !== undefined && line.length > 0)
      .join('\n\n')
      .slice(0, 10_000);
    if (!queueSwarmHandoff({ cardId: card.id, mission })) {
      setError('Swarm could not receive this issue. Session storage is unavailable.');
      return;
    }
    void navigate({ to: '/swarm' });
  }

  function openGitHubIssue(url: string): void {
    void window.builderHelm.browser
      .command({ action: 'external', url })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not open GitHub'),
      );
  }

  if (boards.activeId === null || (projects.isSuccess && selectedProject === undefined)) {
    return (
      <ProjectChooser
        projects={projects.data ?? []}
        loading={projects.isLoading}
        name={projectName}
        busy={createProject.isPending}
        error={error ?? (projects.isError ? 'Could not load project boards' : null)}
        onNameChange={setProjectName}
        onCreate={() => createProject.mutate(projectName.trim())}
        onOpen={boards.open}
      />
    );
  }

  if (selectedProject === undefined) {
    return <div className="boardChooserEmpty">Opening project board…</div>;
  }

  return (
    <section
      className="kanbanPage"
      aria-labelledby="kanban-title"
      data-core-status="ready"
    >
      <header className="kanbanHead">
        <div className="kanbanIdentity">
          <span className="kanbanMark" aria-hidden="true">
            <BoardGlyph />
          </span>
          <div>
            <h1 id="kanban-title">{selectedProject.name}</h1>
            <p>
              BuilderHelm Board · {cards.length} {cards.length === 1 ? 'task' : 'tasks'} ·
              Drag tasks between stages
            </p>
          </div>
        </div>
        <div className="kanbanHeadActions">
          <button className="secondaryButton" type="button" onClick={boards.choose}>
            All boards
          </button>
          <button
            className="secondaryButton"
            type="button"
            aria-expanded={githubOpen}
            onClick={() => {
              setGithubOpen((current) => !current);
              setLinearOpen(false);
              setError(null);
              setNotice(null);
            }}
          >
            GitHub issues
          </button>
          <button
            className="secondaryButton"
            type="button"
            aria-expanded={linearOpen}
            onClick={() => {
              setLinearOpen((current) => !current);
              setGithubOpen(false);
              setError(null);
              setNotice(null);
            }}
          >
            Linear issues
          </button>
          <form
            className="kanbanAdd"
            onSubmit={(event) => {
              event.preventDefault();
              void addCard(title);
            }}
          >
            <input
              aria-label="Task title"
              value={title}
              placeholder="New task"
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit" disabled={busy || title.trim().length === 0}>
              + New task
            </button>
          </form>
        </div>
      </header>
      {error !== null && (
        <p className="wizardError" role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="kanbanNotice" role="status">
          {notice}
        </p>
      )}
      {githubOpen ? (
        <GitHubIntakePanel
          issues={githubIssues.data ?? []}
          loading={githubIssues.isLoading}
          refreshing={githubIssues.isFetching}
          busy={busy}
          error={githubIssues.error instanceof Error ? githubIssues.error.message : null}
          currentWorkspace={selectedProject.id}
          onRefresh={() => void githubIssues.refetch()}
          onClose={() => setGithubOpen(false)}
          onImport={(issue) => void importGitHubIssue(issue)}
          onOpen={openGitHubIssue}
        />
      ) : null}
      {linearOpen ? (
        <LinearIntakePanel
          issues={linearIssues.data ?? []}
          loading={linearIssues.isLoading}
          refreshing={linearIssues.isFetching}
          busy={busy}
          configured={linearConfigured}
          error={
            linearIssues.error instanceof Error
              ? linearIssues.error.message
              : linearStatus.error instanceof Error
                ? linearStatus.error.message
                : null
          }
          currentWorkspace={selectedProject.id}
          keyDraft={linearKey}
          onKeyDraft={setLinearKey}
          onSaveKey={() => void saveLinearKey()}
          onDisconnect={() => void disconnectLinear()}
          onRefresh={() => void linearIssues.refetch()}
          onClose={() => setLinearOpen(false)}
          onImport={(issue) => void importLinearIssue(issue)}
          onOpen={openGitHubIssue}
        />
      ) : null}
      <div className="kanbanGrid">
        {COLUMNS.map((column) => {
          const items = cards.filter((card) => card.column === column.id);
          return (
            <section
              key={column.id}
              className={
                dropColumn === column.id ? 'kanbanCol kanbanDropTarget' : 'kanbanCol'
              }
              data-column={column.id}
              onDragEnter={(event) => {
                event.preventDefault();
                setDropColumn(column.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropColumn(column.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropColumn((current) => (current === column.id ? null : current));
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/plain') || draggedId;
                if (id !== null) void dropCard(id, column.id);
              }}
            >
              <header>
                <span>{column.label}</span>
                <span className="kanbanColMeta">
                  <strong>{items.length}</strong>
                  <button
                    type="button"
                    aria-label={`Add task to ${column.label}`}
                    disabled={busy}
                    onClick={() => {
                      setCompose(column.id);
                      setComposeTitle('');
                    }}
                  >
                    +
                  </button>
                </span>
              </header>
              <ul>
                {items.length === 0 && compose !== column.id ? (
                  <li className="kanbanEmpty">No tasks</li>
                ) : null}
                {items.map((card) => (
                  <li
                    key={card.id}
                    className={
                      draggedId === card.id ? 'kanbanCard kanbanDragging' : 'kanbanCard'
                    }
                    draggable={!busy && editingId !== card.id}
                    aria-grabbed={draggedId === card.id}
                    onDragStart={(event) => {
                      if (editingId === card.id) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', card.id);
                      setDraggedId(card.id);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDropColumn(null);
                    }}
                  >
                    <div className="kanbanCardMain">
                      {editingId === card.id ? (
                        <input
                          className="kanbanCardEdit"
                          aria-label={`Rename ${card.title}`}
                          value={editTitle}
                          autoFocus
                          disabled={busy}
                          onChange={(event) => setEditTitle(event.target.value)}
                          onBlur={() => void rename(card, editTitle)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void rename(card, editTitle);
                            }
                            if (event.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="kanbanCardTitle"
                          onClick={() => {
                            setEditingId(card.id);
                            setEditTitle(card.title);
                          }}
                        >
                          {card.title}
                        </button>
                      )}
                      <div className="kanbanCardMoves">
                        {neighbor(column.id, -1) !== undefined ? (
                          <button
                            type="button"
                            aria-label={`Move ${card.title} back`}
                            disabled={busy}
                            onClick={() => {
                              const previous = neighbor(column.id, -1);
                              if (previous !== undefined) void move(card, previous);
                            }}
                          >
                            ←
                          </button>
                        ) : null}
                        {neighbor(column.id, 1) !== undefined ? (
                          <button
                            type="button"
                            aria-label={`Move ${card.title} forward`}
                            disabled={busy}
                            onClick={() => {
                              const next = neighbor(column.id, 1);
                              if (next !== undefined) void move(card, next);
                            }}
                          >
                            →
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Delete ${card.title}`}
                          disabled={busy}
                          onClick={() => void remove(card)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {card.source !== null ? (
                      <div className="kanbanCardSource">
                        <button
                          className="kanbanSourceLink"
                          type="button"
                          onClick={() => {
                            const source = card.source;
                            if (source !== null) openGitHubIssue(source.url);
                          }}
                        >
                          {sourceLabel(card.source)}
                        </button>
                        <span data-state={card.source.state}>{card.source.state}</span>
                        {card.linkedRunId !== null ? <span>Swarm linked</span> : null}
                        <div className="kanbanSourceActions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startGitHubIssue(card)}
                          >
                            Start Swarm
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void syncLinkedIssue(card)}
                          >
                            {card.source.state === 'open'
                              ? 'Close issue'
                              : 'Reopen issue'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
                {compose === column.id ? (
                  <li className="kanbanCompose">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void addCard(composeTitle, column.id);
                      }}
                    >
                      <input
                        aria-label={`New ${column.label} task`}
                        value={composeTitle}
                        placeholder="Task title"
                        autoFocus
                        disabled={busy}
                        onChange={(event) => setComposeTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setCompose(null);
                        }}
                        onBlur={() => {
                          if (composeTitle.trim().length === 0) setCompose(null);
                        }}
                      />
                    </form>
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

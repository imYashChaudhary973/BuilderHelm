import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KanbanCard,
  KanbanColumn,
  KanbanProject,
} from '@builderhelm/protocol/kanban';
import { useEffect, useState } from 'react';

import { useBoards } from '../board-store.js';

const COLUMNS: readonly { id: KanbanColumn; label: string }[] = [
  { id: 'idea', label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'review', label: 'In Review' },
  { id: 'shipped', label: 'Complete' },
  { id: 'cancelled', label: 'Cancelled' },
];

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

export function KanbanBoard(): React.JSX.Element {
  const boards = useBoards();
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
                    <div>
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

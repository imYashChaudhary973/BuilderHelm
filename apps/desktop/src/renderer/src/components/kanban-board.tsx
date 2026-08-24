import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KanbanCard, KanbanColumn, KanbanProject } from '@zero/protocol/kanban';
import { useEffect, useState } from 'react';

import { useBoards } from '../board-store.js';

const COLUMNS: readonly { id: KanbanColumn; label: string }[] = [
  { id: 'idea', label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'shipped', label: 'Complete' },
];

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
    queryFn: () => window.zero.board.listProjects({}),
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
    void window.zero.board
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
    mutationFn: (name: string) => window.zero.board.createProject({ name }),
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

  async function addCard(): Promise<void> {
    const nextTitle = title.trim();
    if (nextTitle.length === 0 || selectedProject === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const card = await window.zero.board.createCard({
        workspace: selectedProject.id,
        title: nextTitle,
      });
      setCards((current) => [...current, card]);
      setTitle('');
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the card');
    } finally {
      setBusy(false);
    }
  }

  async function move(card: KanbanCard, column: KanbanColumn): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await window.zero.board.moveCard({ id: card.id, column });
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
              void addCard();
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
                <strong>{items.length}</strong>
              </header>
              <ul>
                {items.length === 0 ? <li className="kanbanEmpty">No tasks</li> : null}
                {items.map((card) => (
                  <li
                    key={card.id}
                    className={
                      draggedId === card.id ? 'kanbanCard kanbanDragging' : 'kanbanCard'
                    }
                    draggable={!busy}
                    aria-grabbed={draggedId === card.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', card.id);
                      setDraggedId(card.id);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDropColumn(null);
                    }}
                  >
                    <p>{card.title}</p>
                    <div>
                      {column.id !== 'idea' ? (
                        <button
                          type="button"
                          aria-label={`Move ${card.title} back`}
                          disabled={busy}
                          onClick={() =>
                            void move(card, column.id === 'doing' ? 'idea' : 'doing')
                          }
                        >
                          ←
                        </button>
                      ) : null}
                      {column.id !== 'shipped' ? (
                        <button
                          type="button"
                          aria-label={`Move ${card.title} forward`}
                          disabled={busy}
                          onClick={() =>
                            void move(card, column.id === 'idea' ? 'doing' : 'shipped')
                          }
                        >
                          →
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

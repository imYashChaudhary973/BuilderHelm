import type { KanbanCard, KanbanColumn } from '@zero/protocol/kanban';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';

const COLUMNS: readonly { id: KanbanColumn; label: string }[] = [
  { id: 'idea', label: 'To Do' },
  { id: 'doing', label: 'In Progress' },
  { id: 'shipped', label: 'Complete' },
];

function workspaceOf(spaces: ReturnType<typeof useSpaces>): string {
  if (spaces.draft || spaces.activeId === null) return 'global';
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ??
    'global'
  );
}

export function KanbanBoard(): React.JSX.Element {
  const spaces = useSpaces();
  const workspace = workspaceOf(spaces);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<KanbanColumn | null>(null);
  const workspaceName =
    workspace === 'global'
      ? 'All spaces'
      : (workspace.split('/').filter(Boolean).at(-1) ?? 'Workspace');

  useEffect(() => {
    let alive = true;
    void window.zero.board
      .listCards({ workspace })
      .then((next) => {
        if (!alive) return;
        setCards(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : 'Board failed');
      });
    return () => {
      alive = false;
    };
  }, [workspace]);

  async function addCard(): Promise<void> {
    const nextTitle = title.trim();
    if (nextTitle.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const card = await window.zero.board.createCard({ workspace, title: nextTitle });
      setCards((current) => [...current, card]);
      setTitle('');
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

  return (
    <section
      className="kanbanPage"
      aria-labelledby="kanban-title"
      data-core-status="ready"
    >
      <header className="kanbanHead">
        <div className="kanbanIdentity">
          <span className="kanbanMark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
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
          </span>
          <div>
            <h1 id="kanban-title">BuilderHelm Board</h1>
            <p>
              {workspaceName} · {cards.length} {cards.length === 1 ? 'task' : 'tasks'} ·
              Drag tasks between stages
            </p>
          </div>
        </div>
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

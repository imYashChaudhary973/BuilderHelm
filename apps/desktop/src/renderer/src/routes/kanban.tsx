import type { KanbanCard, KanbanColumn } from '@zero/protocol/kanban';
import { useEffect, useState } from 'react';

import { useSpaces } from '../space-store.js';

const COLUMNS: readonly { id: KanbanColumn; label: string }[] = [
  { id: 'idea', label: 'Idea' },
  { id: 'doing', label: 'Doing' },
  { id: 'shipped', label: 'Shipped' },
];

function workspaceOf(spaces: ReturnType<typeof useSpaces>): string {
  if (spaces.draft || spaces.activeId === null) return 'global';
  return (
    spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ??
    'global'
  );
}

export function KanbanPage(): React.JSX.Element {
  const spaces = useSpaces();
  const workspace = workspaceOf(spaces);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section
      className="kanbanPage"
      aria-labelledby="kanban-title"
      data-core-status="ready"
    >
      <header className="kanbanHead">
        <div>
          <p className="eyebrow">Board</p>
          <h1 id="kanban-title">Plan the work</h1>
        </div>
        <form
          className="kanbanAdd"
          onSubmit={(event) => {
            event.preventDefault();
            void addCard();
          }}
        >
          <input
            value={title}
            placeholder="New idea"
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" disabled={busy || title.trim().length === 0}>
            Add
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
            <section key={column.id} className="kanbanCol">
              <header>
                {column.label} <strong>{items.length}</strong>
              </header>
              <ul>
                {items.map((card) => (
                  <li key={card.id}>
                    <p>{card.title}</p>
                    <div>
                      {column.id !== 'idea' ? (
                        <button
                          type="button"
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

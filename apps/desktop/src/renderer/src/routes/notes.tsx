import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Note } from '@builderhelm/protocol/notes';
import { useEffect, useState } from 'react';

import { useBoards } from '../board-store.js';
import { queueSwarmHandoff } from '../swarm-persist.js';

export function NotesPage(): React.JSX.Element {
  const boards = useBoards();
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ['kanban-projects'],
    queryFn: () => window.builderHelm.board.listProjects({}),
  });
  const workspace = boards.activeId ?? projects.data?.[0]?.id ?? null;
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const active = notes.find((note) => note.id === activeId) ?? null;

  useEffect(() => {
    if (workspace === null) {
      setNotes([]);
      return;
    }
    let alive = true;
    void window.builderHelm.notes
      .list({ workspace })
      .then((next) => {
        if (!alive) return;
        setNotes(next);
        setActiveId((current) => current ?? next[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : 'Notes failed');
      });
    return () => {
      alive = false;
    };
  }, [workspace]);

  useEffect(() => {
    if (active === null) {
      setTitle('');
      setBody('');
      return;
    }
    setTitle(active.title);
    setBody(active.body);
  }, [active?.id]);

  useEffect(() => {
    if (active === null) return;
    if (title === active.title && body === active.body) return;
    const handle = window.setTimeout(() => {
      void window.builderHelm.notes
        .save({ id: active.id, title: title.trim() || 'Untitled note', body })
        .then((saved) => {
          setNotes((current) =>
            current.map((note) => (note.id === saved.id ? saved : note)),
          );
        })
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : 'Save failed'),
        );
    }, 400);
    return () => window.clearTimeout(handle);
  }, [active, title, body]);

  async function create(): Promise<void> {
    if (workspace === null) return;
    const note = await window.builderHelm.notes.create({ workspace });
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
  }

  async function applySlash(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): Promise<void> {
    if (event.key !== 'Enter' || workspace === null) return;
    const textarea = event.currentTarget;
    const until = body.slice(0, textarea.selectionStart);
    const line = until.split('\n').at(-1) ?? '';
    if (line.startsWith('/task ')) {
      event.preventDefault();
      const task = line.slice(6).trim();
      if (task.length === 0) return;
      await window.builderHelm.board.createCard({ workspace, title: task });
      setBody(
        `${body.slice(0, until.length - line.length)}Task: ${task}${body.slice(until.length)}`,
      );
    } else if (line.startsWith('/log')) {
      event.preventDefault();
      const rest = line.slice(4).trim();
      setBody(
        `${body.slice(0, until.length - line.length)}${new Date().toISOString()} ${rest}${body.slice(until.length)}`,
      );
    } else if (line.startsWith('/link ')) {
      event.preventDefault();
      const target = line.slice(6).trim();
      setBody(
        `${body.slice(0, until.length - line.length)}[${target}](${target})${body.slice(until.length)}`,
      );
    } else if (line.startsWith('/swarm')) {
      event.preventDefault();
      const mission = [title, body].filter((part) => part.trim().length > 0).join('\n\n');
      if (!queueSwarmHandoff({ cardId: active?.id ?? crypto.randomUUID(), mission })) {
        setError('Swarm could not receive this note.');
        return;
      }
      void navigate({ to: '/swarm' });
    }
  }

  if (workspace === null) {
    return (
      <section className="notesPage" aria-labelledby="notes-title">
        <h1 id="notes-title">Notes</h1>
        <p>Create a Board project first. Notes stay beside that project, not in git.</p>
      </section>
    );
  }

  return (
    <section className="notesPage" aria-labelledby="notes-title">
      <header className="notesHead">
        <h1 id="notes-title">Notes</h1>
        <button type="button" onClick={() => void create()}>
          New note
        </button>
      </header>
      {error !== null ? (
        <p className="wizardError" role="alert">
          {error}
        </p>
      ) : null}
      <div className="notesSplit">
        <ul className="notesList" aria-label="Notes">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={note.id === activeId ? 'notesListOn' : undefined}
                onClick={() => setActiveId(note.id)}
              >
                {note.title}
              </button>
            </li>
          ))}
        </ul>
        {active === null ? (
          <p className="notesEmpty">No note selected.</p>
        ) : (
          <div className="notesEditor">
            <input
              aria-label="Note title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <textarea
              aria-label="Note body"
              value={body}
              placeholder="Markdown. Slash: /task /log /link /swarm"
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => void applySlash(event)}
            />
            <p>
              Autosaves. Secrets in /log and save are redacted. Deleting a task does not
              delete this note.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

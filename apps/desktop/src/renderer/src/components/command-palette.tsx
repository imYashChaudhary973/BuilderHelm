import { useNavigate } from '@tanstack/react-router';
import {
  SEARCH_COMMANDS,
  type SearchCardHit,
  type SearchCommand,
  type SearchFileHit,
  type SearchMemoryHit,
} from '@builderhelm/protocol/search';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useBoards } from '../board-store.js';
import { usePreview } from '../preview-store.js';
import { useSpaces } from '../space-store.js';

type PaletteRow =
  | { readonly kind: 'command'; readonly command: SearchCommand }
  | { readonly kind: 'file'; readonly file: SearchFileHit }
  | { readonly kind: 'card'; readonly card: SearchCardHit }
  | { readonly kind: 'memory'; readonly memory: SearchMemoryHit }
  | { readonly kind: 'space'; readonly sessionId: string; readonly label: string };

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export function CommandPalette(): React.JSX.Element | null {
  const navigate = useNavigate();
  const boards = useBoards();
  const preview = usePreview();
  const spaces = useSpaces();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [files, setFiles] = useState<SearchFileHit[]>([]);
  const [cards, setCards] = useState<SearchCardHit[]>([]);
  const [memory, setMemory] = useState<SearchMemoryHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const root =
    spaces.draft || spaces.activeId === null
      ? null
      : (spaces.spaces.find((item) => item.sessionId === spaces.activeId)?.folderPath ??
        null);

  const needle = query.trim().toLowerCase();
  const commands = useMemo(
    () =>
      SEARCH_COMMANDS.filter(
        (command) =>
          needle.length === 0 ||
          matches(command.title, needle) ||
          matches(command.hint, needle),
      ),
    [needle],
  );
  const spaceHits = useMemo(
    () =>
      spaces.spaces
        .filter(
          (session) => needle.length > 0 && matches(spaces.meta(session).label, needle),
        )
        .map((session) => ({
          kind: 'space' as const,
          sessionId: session.sessionId,
          label: spaces.meta(session).label,
        })),
    [needle, spaces],
  );

  const rows: PaletteRow[] = useMemo(() => {
    const next: PaletteRow[] = commands.map((command) => ({ kind: 'command', command }));
    for (const file of files) next.push({ kind: 'file', file });
    for (const card of cards) next.push({ kind: 'card', card });
    for (const hit of memory) next.push({ kind: 'memory', memory: hit });
    next.push(...spaceHits);
    return next;
  }, [commands, files, cards, memory, spaceHits]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    setFiles([]);
    setCards([]);
    setMemory([]);
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (needle.length === 0) {
      setFiles([]);
      setCards([]);
      setMemory([]);
      void window.builderHelm.search.cancel().catch(() => undefined);
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      void window.builderHelm.search
        .query({ query: needle, root, limit: 24 })
        .then((result) => {
          if (!alive) return;
          setFiles(result.files);
          setCards(result.cards);
          setMemory(result.memory);
        })
        .catch(() => {
          if (!alive) return;
          setFiles([]);
          setCards([]);
          setMemory([]);
        });
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(handle);
      void window.builderHelm.search.cancel().catch(() => undefined);
    };
  }, [open, needle, root]);

  useEffect(() => {
    setCursor(0);
  }, [rows.length, needle]);

  function close(): void {
    setOpen(false);
    void window.builderHelm.search.cancel().catch(() => undefined);
  }

  function run(row: PaletteRow): void {
    if (row.kind === 'command') {
      if (row.command.to === 'tools') preview.setTab('editor');
      else void navigate({ to: row.command.to });
    } else if (row.kind === 'file') {
      preview.setTab('editor');
      window.dispatchEvent(
        new CustomEvent('builderhelm:open-editor', { detail: { path: row.file.path } }),
      );
    } else if (row.kind === 'card') {
      boards.open(row.card.workspace);
      void navigate({ to: '/board' });
    } else if (row.kind === 'memory') {
      void navigate({ to: '/memory' });
    } else {
      spaces.activate(row.sessionId);
      void navigate({ to: '/' });
    }
    close();
  }

  if (!open) return null;
  const active = rows[cursor];

  return (
    <div className="commandPaletteScrim" onMouseDown={close}>
      <div
        className="commandPalette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Search files, tasks, memory, commands"
          aria-label="Search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((current) => Math.min(current + 1, Math.max(rows.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter' && active !== undefined) {
              event.preventDefault();
              run(active);
            }
          }}
        />
        {rows.length === 0 ? (
          <p className="commandPaletteEmpty">No matches</p>
        ) : (
          <ul>
            {rows.map((row, index) => (
              <li key={rowKey(row)}>
                <button
                  type="button"
                  className={index === cursor ? 'commandPaletteRowOn' : undefined}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => run(row)}
                >
                  <span>{rowKind(row)}</span>
                  <strong>{rowTitle(row)}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function rowKey(row: PaletteRow): string {
  if (row.kind === 'command') return `c-${row.command.id}`;
  if (row.kind === 'file') return `f-${row.file.path}`;
  if (row.kind === 'card') return `t-${row.card.id}`;
  if (row.kind === 'memory') return `m-${row.memory.vaultId}-${row.memory.path}`;
  return `s-${row.sessionId}`;
}

function rowKind(row: PaletteRow): string {
  if (row.kind === 'command') return 'Command';
  if (row.kind === 'file') return row.file.kind === 'dir' ? 'Folder' : 'File';
  if (row.kind === 'card') return 'Task';
  if (row.kind === 'memory') return 'Memory';
  return 'Space';
}

function rowTitle(row: PaletteRow): string {
  if (row.kind === 'command') return row.command.title;
  if (row.kind === 'file') return row.file.name;
  if (row.kind === 'card') return `${row.card.projectName} · ${row.card.title}`;
  if (row.kind === 'memory') return `${row.memory.vaultName} · ${row.memory.title}`;
  return row.label;
}

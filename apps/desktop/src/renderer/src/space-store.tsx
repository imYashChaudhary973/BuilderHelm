import type { BoardSessionSummary } from '@builderhelm/protocol/board';
import type { CorrelationId } from '@builderhelm/shared';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export const SPACE_COLORS = [
  '#b6d475',
  '#7ec8e3',
  '#f2c94c',
  '#ff8f73',
  '#c4b5fd',
  '#f9a8d4',
  '#86efac',
  '#93c5fd',
] as const;

export interface SpaceMeta {
  readonly label: string;
  readonly color: string;
}

export interface SpaceStore {
  readonly spaces: readonly BoardSessionSummary[];
  readonly activeId: string | null;
  readonly draft: boolean;
  readonly draftSeq: number;
  readonly wantSetup: boolean;
  meta(session: BoardSessionSummary): SpaceMeta;
  activate(id: string): void;
  startDraft(): void;
  hideSetup(): void;
  upsert(session: BoardSessionSummary): void;
  drop(id: string): void;
  rename(session: BoardSessionSummary, label: string): void;
  setColor(session: BoardSessionSummary, color: string): void;
  close(id: string): Promise<void>;
}

const META_KEY = 'exeum.space.meta';

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function loadMeta(): Record<string, SpaceMeta> {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, SpaceMeta>)
      : {};
  } catch {
    return {};
  }
}

function saveMeta(meta: Record<string, SpaceMeta>): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

const SpaceContext = createContext<SpaceStore | null>(null);

export function SpaceProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [spaces, setSpaces] = useState<BoardSessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState(true);
  const [draftSeq, setDraftSeq] = useState(0);
  const [wantSetup, setWantSetup] = useState(false);
  const [metaByPath, setMetaByPath] = useState<Record<string, SpaceMeta>>(loadMeta);

  function writeMeta(
    path: string,
    patch: Partial<SpaceMeta>,
    fallbackLabel: string,
  ): void {
    setMetaByPath((current) => {
      const previous = current[path] ?? {
        label: fallbackLabel,
        color:
          SPACE_COLORS[Object.keys(current).length % SPACE_COLORS.length] ??
          SPACE_COLORS[0],
      };
      const next = { ...current, [path]: { ...previous, ...patch } };
      saveMeta(next);
      return next;
    });
  }

  const value = useMemo<SpaceStore>(
    () => ({
      spaces,
      activeId,
      draft,
      draftSeq,
      wantSetup,
      meta(session) {
        return (
          metaByPath[session.folderPath] ?? {
            label: folderName(session.folderPath),
            color: SPACE_COLORS[0],
          }
        );
      },
      activate(id) {
        setActiveId(id);
        setDraft(false);
        setWantSetup(false);
      },
      startDraft() {
        setActiveId(null);
        setDraft(true);
        setWantSetup(true);
        setDraftSeq((current) => current + 1);
      },
      hideSetup() {
        setWantSetup(false);
      },
      upsert(session) {
        setSpaces((current) => {
          const index = current.findIndex((item) => item.sessionId === session.sessionId);
          if (index === -1) {
            writeMeta(session.folderPath, {}, folderName(session.folderPath));
            return [...current, session];
          }
          const next = current.slice();
          next[index] = session;
          return next;
        });
        setActiveId(session.sessionId);
        setDraft(false);
        setWantSetup(false);
      },
      drop(id) {
        setSpaces((current) => {
          const next = current.filter((item) => item.sessionId !== id);
          // Closing a background Space must not yank focus from the active
          // one; only the closed Space's selection falls back.
          if (id === activeId) {
            const fallback = next.at(-1)?.sessionId ?? null;
            setActiveId(fallback);
            setDraft(fallback === null);
          }
          return next;
        });
      },
      rename(session, label) {
        const trimmed = label.trim();
        if (trimmed.length === 0) return;
        writeMeta(session.folderPath, { label: trimmed }, folderName(session.folderPath));
      },
      setColor(session, color) {
        writeMeta(session.folderPath, { color }, folderName(session.folderPath));
      },
      async close(id) {
        const session = spaces.find((item) => item.sessionId === id);
        if (session === undefined) return;
        for (const pane of session.panes) {
          try {
            await window.builderHelm.board.closePane({
              correlationId: crypto.randomUUID() as CorrelationId,
              sessionId: session.sessionId,
              paneId: pane.paneId,
            });
          } catch {
            // pane already gone
          }
        }
        setSpaces((current) => {
          const next = current.filter((item) => item.sessionId !== id);
          if (id === activeId) {
            const fallback = next.at(-1)?.sessionId ?? null;
            setActiveId(fallback);
            setDraft(fallback === null);
          }
          return next;
        });
      },
    }),
    [spaces, activeId, draft, draftSeq, wantSetup, metaByPath],
  );

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

export function useSpaces(): SpaceStore {
  const store = useContext(SpaceContext);
  if (store === null) throw new Error('useSpaces requires SpaceProvider');
  return store;
}

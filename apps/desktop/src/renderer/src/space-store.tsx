import type { BoardSessionSummary } from '@zero/protocol/board';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface SpaceStore {
  readonly spaces: readonly BoardSessionSummary[];
  readonly activeId: string | null;
  readonly draft: boolean;
  readonly draftSeq: number;
  activate(id: string): void;
  startDraft(): void;
  upsert(session: BoardSessionSummary): void;
  drop(id: string): void;
}

const SpaceContext = createContext<SpaceStore | null>(null);

export function SpaceProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [spaces, setSpaces] = useState<BoardSessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState(true);
  const [draftSeq, setDraftSeq] = useState(0);

  const value = useMemo<SpaceStore>(
    () => ({
      spaces,
      activeId,
      draft,
      draftSeq,
      activate(id) {
        setActiveId(id);
        setDraft(false);
      },
      startDraft() {
        setActiveId(null);
        setDraft(true);
        setDraftSeq((current) => current + 1);
      },
      upsert(session) {
        setSpaces((current) => {
          const index = current.findIndex((item) => item.sessionId === session.sessionId);
          if (index === -1) return [...current, session];
          const next = current.slice();
          next[index] = session;
          return next;
        });
        setActiveId(session.sessionId);
        setDraft(false);
      },
      drop(id) {
        setSpaces((current) => {
          const next = current.filter((item) => item.sessionId !== id);
          const fallback = next.at(-1)?.sessionId ?? null;
          setActiveId(fallback);
          setDraft(fallback === null);
          return next;
        });
      },
    }),
    [spaces, activeId, draft, draftSeq],
  );

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

export function useSpaces(): SpaceStore {
  const store = useContext(SpaceContext);
  if (store === null) throw new Error('useSpaces requires SpaceProvider');
  return store;
}

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const ACTIVE_BOARD_KEY = 'builderhelm.board.active';

interface BoardStore {
  readonly activeId: string | null;
  choose(): void;
  open(id: string): void;
}

const BoardContext = createContext<BoardStore | null>(null);

function readActiveBoard(): string | null {
  try {
    return localStorage.getItem(ACTIVE_BOARD_KEY);
  } catch {
    return null;
  }
}

export function BoardProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [activeId, setActiveId] = useState<string | null>(readActiveBoard);
  const value = useMemo<BoardStore>(
    () => ({
      activeId,
      choose() {
        setActiveId(null);
      },
      open(id) {
        setActiveId(id);
        try {
          localStorage.setItem(ACTIVE_BOARD_KEY, id);
        } catch {
          // Active navigation can stay session-only when storage is unavailable.
        }
      },
    }),
    [activeId],
  );
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoards(): BoardStore {
  const store = useContext(BoardContext);
  if (store === null) throw new Error('useBoards requires BoardProvider');
  return store;
}

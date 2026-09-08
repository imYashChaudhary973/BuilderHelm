import type { BoardSessionSummary } from '@builderhelm/protocol/board';
import type { WorkspaceRecord, WorkspaceMeta } from '@builderhelm/protocol/workspaces';
import type { CorrelationId } from '@builderhelm/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export const SPACE_COLORS = [
  '#e3e3dc',
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
  readonly records: readonly WorkspaceRecord[];
  readonly recentRoots: readonly string[];
  readonly activeId: string | null;
  readonly workingDirectory: string | null;
  readonly draft: boolean;
  readonly draftSeq: number;
  readonly wantSetup: boolean;
  readonly ready: boolean;
  readonly error: string | null;
  meta(session: BoardSessionSummary): SpaceMeta;
  activate(id: string): void;
  focusPane(sessionId: string, paneId: string): void;
  startDraft(): void;
  hideSetup(): void;
  upsert(session: BoardSessionSummary): void;
  drop(id: string): void;
  rename(session: BoardSessionSummary, label: string): void;
  setColor(session: BoardSessionSummary, color: string): void;
  close(id: string): Promise<void>;
  restart(id: string): Promise<void>;
}
const SpaceContext = createContext<SpaceStore | null>(null);
const folderName = (root: string) => root.split('/').filter(Boolean).at(-1) ?? root;

/** Import only metadata visible to this renderer origin; retain the old storage. */
function legacyMetadata(): WorkspaceMeta[] {
  try {
    const metadata: unknown = JSON.parse(
      localStorage.getItem('builderhelm.space.meta') ?? '{}',
    );
    const recents: unknown = JSON.parse(
      localStorage.getItem('builderhelm.space.recents') ?? '[]',
    );
    const result = new Map<string, WorkspaceMeta>();
    if (Array.isArray(recents))
      for (const root of recents)
        if (typeof root === 'string' && root.startsWith('/'))
          result.set(root, { root, label: folderName(root), color: SPACE_COLORS[0] });
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
      for (const [root, raw] of Object.entries(metadata)) {
        if (!root.startsWith('/') || !raw || typeof raw !== 'object') continue;
        const item = raw as { label?: unknown; color?: unknown };
        if (
          typeof item.label === 'string' &&
          item.label.length > 0 &&
          item.label.length <= 160 &&
          typeof item.color === 'string' &&
          /^#[0-9a-f]{6}$/i.test(item.color)
        )
          result.set(root, { root, label: item.label, color: item.color });
      }
    return [...result.values()].slice(0, 128);
  } catch {
    return [];
  }
}

export function SpaceProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [spaces, setSpaces] = useState<BoardSessionSummary[]>([]);
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [metadata, setMetadata] = useState<WorkspaceMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [paneId, setPaneId] = useState<string | null>(null);
  const [draft, setDraft] = useState(true);
  const [draftSeq, setDraftSeq] = useState(0);
  const [wantSetup, setWantSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (cause: unknown) =>
    setError(
      cause instanceof Error ? cause.message : 'Workspace state could not be saved.',
    );
  async function refresh(): Promise<void> {
    const snapshot = await window.builderHelm.workspaces.snapshot();
    setRecords(snapshot.records);
    setMetadata(snapshot.metadata);
    setSpaces(
      snapshot.records.flatMap((record) =>
        record.summary !== null && record.state !== 'closed' ? [record.summary] : [],
      ),
    );
    setActiveId(snapshot.activeId);
    setPaneId(snapshot.activePaneId);
    setDraft(snapshot.activeId === null);
    setReady(true);
  }
  useEffect(() => {
    let active = true;
    void window.builderHelm.workspaces
      .importLegacy(legacyMetadata())
      .then(() => (active ? refresh() : undefined))
      .catch(fail);
    return () => {
      active = false;
    };
  }, []);
  function activate(id: string): void {
    setActiveId(id);
    setPaneId(null);
    setDraft(false);
    setWantSetup(false);
    void window.builderHelm.workspaces.select(id).catch(fail);
  }
  function meta(session: BoardSessionSummary): SpaceMeta {
    return (
      metadata.find((item) => item.root === session.folderPath) ?? {
        label: folderName(session.folderPath),
        color: SPACE_COLORS[0],
      }
    );
  }
  function updateMeta(session: BoardSessionSummary, patch: Partial<SpaceMeta>): void {
    const next = { ...meta(session), ...patch, root: session.folderPath };
    void window.builderHelm.workspaces
      .metadata(next)
      .then(() =>
        setMetadata((current) => [
          ...current.filter((item) => item.root !== next.root),
          next,
        ]),
      )
      .catch(fail);
  }
  const selected = spaces.find((space) => space.sessionId === activeId);
  const workingDirectory = draft
    ? null
    : (selected?.panes.find((p) => p.paneId === paneId)?.cwd ??
      selected?.panes[0]?.cwd ??
      selected?.folderPath ??
      null);
  const value: SpaceStore = {
    spaces,
    records,
    recentRoots: metadata.map((item) => item.root),
    activeId,
    workingDirectory,
    draft,
    draftSeq,
    wantSetup,
    ready,
    error,
    meta,
    activate,
    focusPane(id, pane) {
      if (id === activeId) {
        setPaneId(pane);
        void window.builderHelm.workspaces.select(id, pane).catch(fail);
      }
    },
    startDraft() {
      setActiveId(null);
      setDraft(true);
      setWantSetup(true);
      setDraftSeq((n) => n + 1);
      void window.builderHelm.workspaces.select(null).catch(fail);
    },
    hideSetup() {
      setWantSetup(false);
    },
    upsert(session) {
      setSpaces((current) => [
        ...current.filter((item) => item.sessionId !== session.sessionId),
        session,
      ]);
      setRecords((current) => current.filter((item) => item.id !== session.sessionId));
      activate(session.sessionId);
      void window.builderHelm.workspaces
        .order(
          session.sessionId,
          session.panes.map((p) => p.paneId),
        )
        .catch(fail);
    },
    drop(id) {
      setSpaces((current) => current.filter((item) => item.sessionId !== id));
      if (activeId === id) {
        setActiveId(null);
        setDraft(true);
        void window.builderHelm.workspaces.select(null).catch(fail);
      }
    },
    rename(session, label) {
      if (label.trim()) updateMeta(session, { label: label.trim() });
    },
    setColor(session, color) {
      updateMeta(session, { color });
    },
    async close(id) {
      const session = spaces.find((item) => item.sessionId === id);
      if (!session) return;
      try {
        for (const pane of session.panes)
          await window.builderHelm.board.closePane({
            correlationId: crypto.randomUUID() as CorrelationId,
            sessionId: id,
            paneId: pane.paneId,
          });
        value.drop(id);
      } catch (cause) {
        fail(cause);
        throw cause;
      }
    },
    async restart(id) {
      try {
        await window.builderHelm.workspaces.restart(id);
        await refresh();
      } catch (cause) {
        fail(cause);
      }
    },
  };
  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}
export function useSpaces(): SpaceStore {
  const store = useContext(SpaceContext);
  if (store === null) throw new Error('useSpaces requires SpaceProvider');
  return store;
}

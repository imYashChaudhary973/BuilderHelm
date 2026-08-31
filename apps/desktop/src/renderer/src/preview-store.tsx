import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type SideTab = 'browser' | 'editor' | 'git' | 'review';

export interface PreviewStore {
  readonly open: boolean;
  readonly tab: SideTab;
  readonly url: string | null;
  toggle(): void;
  setTab(tab: SideTab): void;
  hide(): void;
  preview(url: string): void;
}

const PreviewContext = createContext<PreviewStore | null>(null);

export function PreviewProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SideTab>('browser');
  const [url, setUrl] = useState<string | null>(null);

  const value = useMemo<PreviewStore>(
    () => ({
      open,
      tab,
      url,
      toggle() {
        setOpen((current) => !current);
      },
      setTab(next) {
        setTab(next);
        setOpen(true);
      },
      hide() {
        setOpen(false);
      },
      preview(next) {
        setUrl(next);
        setTab('browser');
        setOpen(true);
      },
    }),
    [open, tab, url],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewStore {
  const store = useContext(PreviewContext);
  if (store === null) throw new Error('usePreview requires PreviewProvider');
  return store;
}

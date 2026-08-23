import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface PreviewStore {
  readonly panel: null | 'browser' | 'editor';
  readonly url: string | null;
  openBrowser(): void;
  openEditor(): void;
  hide(): void;
  toggle(panel: 'browser' | 'editor'): void;
  preview(url: string): void;
}

const PreviewContext = createContext<PreviewStore | null>(null);

export function PreviewProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [panel, setPanel] = useState<null | 'browser' | 'editor'>(null);
  const [url, setUrl] = useState<string | null>(null);

  const value = useMemo<PreviewStore>(
    () => ({
      panel,
      url,
      openBrowser() {
        setPanel('browser');
      },
      openEditor() {
        setPanel('editor');
      },
      hide() {
        setPanel(null);
      },
      toggle(next) {
        setPanel((current) => (current === next ? null : next));
      },
      preview(next) {
        setUrl(next);
        setPanel('browser');
      },
    }),
    [panel, url],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewStore {
  const store = useContext(PreviewContext);
  if (store === null) throw new Error('usePreview requires PreviewProvider');
  return store;
}

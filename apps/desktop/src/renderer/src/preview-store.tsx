import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface PreviewStore {
  readonly open: boolean;
  readonly url: string | null;
  show(): void;
  hide(): void;
  toggle(): void;
  preview(url: string): void;
}

const PreviewContext = createContext<PreviewStore | null>(null);

export function PreviewProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const value = useMemo<PreviewStore>(
    () => ({
      open,
      url,
      show() {
        setOpen(true);
      },
      hide() {
        setOpen(false);
      },
      toggle() {
        setOpen((current) => !current);
      },
      preview(next) {
        setUrl(next);
        setOpen(true);
      },
    }),
    [open, url],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): PreviewStore {
  const store = useContext(PreviewContext);
  if (store === null) throw new Error('usePreview requires PreviewProvider');
  return store;
}

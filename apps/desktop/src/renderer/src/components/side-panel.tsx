import { useEffect, useState } from 'react';

import { usePreview, type SideTab } from '../preview-store.js';
import { BrowserSidebar } from './browser-sidebar.js';
import { EditorSidebar } from './editor-sidebar.js';
import { KanbanSidebar } from './kanban-sidebar.js';
import { GitSidebar } from './git-sidebar.js';

const TABS: readonly { id: SideTab | 'skills'; label: string; live: boolean }[] = [
  { id: 'browser', label: 'Browser', live: true },
  { id: 'editor', label: 'Editor', live: true },
  { id: 'board', label: 'BuilderHelm Board', live: true },
  { id: 'git', label: 'Git', live: true },
  { id: 'skills', label: 'Skills', live: false },
];

const WIDTH_KEY = 'exeum.panel.ratio';
const minRatio = 0.18;
const maxRatio = 0.6;

function readRatio(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(raw) || raw > 1) return minRatio;
  return Math.min(maxRatio, Math.max(minRatio, raw));
}

function TabIcon({ id }: { readonly id: string }): React.JSX.Element {
  if (id === 'browser') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 8h11M8 2.5c1.8 1.8 1.8 9.2 0 11M8 2.5c-1.8 1.8-1.8 9.2 0 11" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (id === 'editor') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 3.5h8v9H4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 6h4M6 8.5h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (id === 'board') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <rect x="4.5" y="5.5" width="4" height="13" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <rect x="10" y="5.5" width="4" height="8.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <rect x="15.5" y="5.5" width="4" height="11" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (id === 'git') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="5" cy="12" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="5" cy="4" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="11.5" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 5.6v4.8M6.4 4.6 10 7.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 3.2 9.2 6h3.1l-2.5 1.9.9 2.9L8 9.2 5.3 10.8l.9-2.9L3.7 6h3.1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function SidePanel(): React.JSX.Element {
  const preview = usePreview();
  const [ratio, setRatio] = useState(readRatio);

  useEffect(() => {
    document.documentElement.style.setProperty('--panel-w', `${String(ratio * 100)}%`);
  }, [ratio]);

  function startResize(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const origin = event.clientX;
    const start = ratio;
    const page = window.innerWidth;
    function move(next: PointerEvent): void {
      const nextRatio = Math.min(
        maxRatio,
        Math.max(minRatio, start + (origin - next.clientX) / page),
      );
      setRatio(nextRatio);
    }
    function up(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRatio((current) => {
        localStorage.setItem(WIDTH_KEY, String(current));
        return current;
      });
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <aside className="sidePanel" aria-label="Tools">
      <button
        type="button"
        className="sideResize"
        aria-label="Resize tools panel"
        onPointerDown={startResize}
      />
      <div className="sideTabs" role="tablist">
        {TABS.map((item) => {
          const on = preview.tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={on ? 'sideTab sideTabOn' : 'sideTab'}
              aria-selected={on}
              disabled={!item.live}
              title={item.live ? item.label : 'Coming later'}
              onClick={() => {
                if (item.live) preview.setTab(item.id as SideTab);
              }}
            >
              <TabIcon id={item.id} />
              {on ? item.label : null}
            </button>
          );
        })}
      </div>
      <div className="sideBody">
        {preview.tab === 'browser' ? <BrowserSidebar startUrl={preview.url} /> : null}
        {preview.tab === 'editor' ? <EditorSidebar /> : null}
        {preview.tab === 'git' ? <GitSidebar /> : null}
        {preview.tab === 'board' ? <KanbanSidebar /> : null}
      </div>
    </aside>
  );
}

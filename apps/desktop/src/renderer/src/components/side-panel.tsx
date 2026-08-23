import { useEffect, useState } from 'react';

import { usePreview, type SideTab } from '../preview-store.js';
import { BrowserSidebar } from './browser-sidebar.js';
import { EditorSidebar } from './editor-sidebar.js';
import { GitSidebar } from './git-sidebar.js';

const TABS: readonly { id: SideTab | 'skills'; label: string; live: boolean }[] = [
  { id: 'browser', label: 'Browser', live: true },
  { id: 'editor', label: 'Editor', live: true },
  { id: 'git', label: 'Git', live: true },
  { id: 'skills', label: 'Skills', live: false },
];

const WIDTH_KEY = 'exeum.panel.width';
const minWidth = 280;
const maxWidth = 720;

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw >= minWidth && raw <= maxWidth ? raw : 360;
}

export function SidePanel(): React.JSX.Element {
  const preview = usePreview();
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    document.documentElement.style.setProperty('--panel-w', `${String(width)}px`);
  }, [width]);

  function startResize(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const origin = event.clientX;
    const start = width;
    function move(next: PointerEvent): void {
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, start + (origin - next.clientX)));
      setWidth(nextWidth);
    }
    function up(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWidth((current) => {
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
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={preview.tab === item.id ? 'sideTab sideTabOn' : 'sideTab'}
            aria-selected={preview.tab === item.id}
            disabled={!item.live}
            title={item.live ? item.label : 'Coming later'}
            onClick={() => {
              if (item.live) preview.setTab(item.id as SideTab);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="sideBody">
        {preview.tab === 'browser' ? <BrowserSidebar startUrl={preview.url} /> : null}
        {preview.tab === 'editor' ? <EditorSidebar /> : null}
        {preview.tab === 'git' ? <GitSidebar /> : null}
      </div>
    </aside>
  );
}

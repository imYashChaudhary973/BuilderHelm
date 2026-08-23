import { BrowserSidebar } from './browser-sidebar.js';
import { EditorSidebar } from './editor-sidebar.js';
import { usePreview, type SideTab } from '../preview-store.js';

const TABS: readonly { id: SideTab | 'git' | 'skills'; label: string; live: boolean }[] = [
  { id: 'browser', label: 'Browser', live: true },
  { id: 'editor', label: 'Editor', live: true },
  { id: 'git', label: 'Git', live: false },
  { id: 'skills', label: 'Skills', live: false },
];

export function SidePanel(): React.JSX.Element {
  const preview = usePreview();

  return (
    <aside className="sidePanel" aria-label="Tools">
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
      </div>
    </aside>
  );
}

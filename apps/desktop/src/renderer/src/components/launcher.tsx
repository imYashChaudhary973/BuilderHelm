import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildLauncherActions,
  filterLauncherActions,
  LAUNCHER_GROUP_LABEL,
  LAUNCHER_GROUPS,
  type LauncherAction,
} from '../launcher-actions.js';
import { usePreview } from '../preview-store.js';
import { useSpaces } from '../space-store.js';

export function Launcher({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const navigate = useNavigate();
  const spaces = useSpaces();
  const preview = usePreview();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const agents = useQuery({
    queryKey: ['launcher-agents'],
    queryFn: () => window.builderHelm.board.detectAgents(),
    enabled: open,
  });

  const actions = useMemo(
    () =>
      buildLauncherActions({
        navigate: (to) => void navigate({ to }),
        activateSpace: (sessionId) => spaces.activate(sessionId),
        spaces: spaces.spaces,
        agents: agents.data ?? [],
        openBrowser: () => preview.setTab('browser'),
        openEditor: () => preview.setTab('editor'),
      }),
    [agents.data, navigate, preview, spaces],
  );

  const filtered = useMemo(() => filterLauncherActions(actions, query), [actions, query]);

  useEffect(() => {
    setQuery('');
    setSelected(0);
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((current) => Math.min(filtered.length - 1, current + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const action = filtered[selected];
        if (action !== undefined) run(action);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, onClose, open, selected]);

  if (!open) return null;

  function run(action: LauncherAction): void {
    onClose();
    action.run();
  }

  return (
    <div className="launcherScrim" onMouseDown={onClose}>
      <div
        className="launcher"
        role="dialog"
        aria-modal="true"
        aria-label="Search tabs, files, actions, and agents"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="launcherInput"
          value={query}
          placeholder="Search tabs, files, actions, and agents…"
          aria-label="Search tabs, files, actions, and agents"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="launcherList" role="listbox">
          {LAUNCHER_GROUPS.map((group) => {
            const rows = filtered.filter((action) => action.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} className="launcherGroup">
                <h2>{LAUNCHER_GROUP_LABEL[group]}</h2>
                {rows.map((action) => {
                  const index = filtered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="option"
                      aria-selected={index === selected}
                      className={
                        index === selected ? 'launcherRow launcherRowOn' : 'launcherRow'
                      }
                      onMouseEnter={() => setSelected(index)}
                      onClick={() => run(action)}
                    >
                      <span>{action.label}</span>
                      <small>{action.detail}</small>
                    </button>
                  );
                })}
              </section>
            );
          })}
          {filtered.length === 0 && <p className="launcherEmpty">Nothing matches.</p>}
        </div>
      </div>
    </div>
  );
}

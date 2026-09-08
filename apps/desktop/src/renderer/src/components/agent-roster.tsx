import type { AgentProfile, AgentThread } from '@builderhelm/protocol';

import { compactTokens, recentProfiles } from '../routes/chat-status.js';

const SHAPES = {
  square: 'M12 5H28Q35 5 35 12V28Q35 35 28 35H12Q5 35 5 28V12Q5 5 12 5Z',
  circle: 'M20 4a16 16 0 1 0 0 32a16 16 0 1 0 0-32',
  diamond: 'M20 3 37 20 20 37 3 20Z',
  triangle: 'M20 4 37 35H3Z',
  hexagon: 'M12 4h16l9 16-9 16H12L3 20Z',
  star: 'M20 3 25 13 37 15 29 24 31 36 20 30 9 36 11 24 3 15 15 13Z',
  wave: 'M5 13Q10 0 21 6Q39 3 35 20Q39 36 23 34Q4 39 5 24Z',
  bolt: 'M22 3 6 23h12l-1 14 17-22H22Z',
} as const;

export function BotMark({
  mark,
}: {
  readonly mark: AgentProfile['mark'];
}): React.JSX.Element {
  return (
    <svg
      className="botMark"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={SHAPES[mark]} />
      <ellipse cx="15.5" cy={mark === 'triangle' ? 25 : 18} rx="1.8" ry="3.6" />
      <ellipse cx="24.5" cy={mark === 'triangle' ? 25 : 18} rx="1.8" ry="3.6" />
    </svg>
  );
}

export function ProfileMark({
  profile,
  size,
}: {
  readonly profile: AgentProfile;
  readonly size: 'tile' | 'row' | 'head';
}): React.JSX.Element {
  return (
    <span className={`profileMark profileMark-${size}`}>
      <BotMark mark={profile.mark} />
    </span>
  );
}

/**
 * The Agents-mode sidebar: quick-access tiles, the full roster with live
 * dots, and the usage footer. Selection lives in the route; this renders.
 */
export function AgentRoster({
  profiles,
  threads,
  liveThreadIds,
  activeId,
  tokens,
  modelLabel,
  disabled = false,
  onSelect,
  onAdd,
}: {
  readonly profiles: readonly AgentProfile[];
  readonly threads: readonly AgentThread[];
  readonly liveThreadIds: ReadonlySet<string>;
  readonly activeId: string | null;
  readonly tokens: number | null;
  readonly modelLabel: string | null;
  /** While a turn runs, switching agents would orphan the live session view. */
  readonly disabled?: boolean;
  readonly onSelect: (profileId: string) => void;
  readonly onAdd: () => void;
}): React.JSX.Element {
  const liveProfileIds = new Set(
    threads
      .filter((thread) => liveThreadIds.has(thread.id))
      .map((thread) => thread.profileId)
      .filter((id): id is string => id !== null),
  );
  const ordered = [...profiles].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="threadPanel rosterPanel" aria-label="Agent roster">
      <div className="threadPanelHeader">
        <h1>Agents</h1>
        <button
          className="newThreadButton"
          type="button"
          disabled={disabled}
          aria-label="Create an agent profile"
          title="New agent"
          onClick={onAdd}
        >
          +
        </button>
      </div>

      {profiles.length > 0 && (
        <div className="rosterTiles">
          {recentProfiles(profiles, 4).map((profile) => (
            <button
              key={profile.id}
              type="button"
              disabled={disabled}
              className={`rosterTile ${profile.id === activeId ? 'rosterTileActive' : ''}`}
              aria-label={`Open ${profile.name}`}
              title={profile.name}
              onClick={() => onSelect(profile.id)}
            >
              <ProfileMark profile={profile} size="tile" />
            </button>
          ))}
        </div>
      )}

      <div className="threadList">
        {ordered.length === 0 && (
          <p className="threadEmpty">
            No agents yet. Create one to give an installed CLI a name, a mark, and a
            project.
          </p>
        )}
        {ordered.map((profile) => (
          <button
            key={profile.id}
            type="button"
            disabled={disabled}
            className={`threadItem rosterRow ${profile.id === activeId ? 'threadItemActive' : ''}`}
            aria-label={`Open ${profile.name}`}
            onClick={() => onSelect(profile.id)}
          >
            <ProfileMark profile={profile} size="row" />
            <span className="rosterRowName">{profile.name}</span>
            <span
              className={`rosterDot ${liveProfileIds.has(profile.id) ? 'rosterDotLive' : ''}`}
              role="img"
              aria-label={liveProfileIds.has(profile.id) ? 'Running' : 'Idle'}
              title={liveProfileIds.has(profile.id) ? 'Running' : 'Idle'}
            />
          </button>
        ))}
      </div>

      <p className="rosterFooter">
        <span className="rosterFooterModel">{modelLabel ?? 'auto'}</span>
        <span className="rosterFooterTokens">
          {tokens === null ? '—' : `${compactTokens(tokens)} tokens`}
        </span>
      </p>
    </aside>
  );
}

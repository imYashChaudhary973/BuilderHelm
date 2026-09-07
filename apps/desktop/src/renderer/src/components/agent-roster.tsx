import type { AgentProfile, AgentThread } from '@builderhelm/protocol';

import { compactTokens, recentProfiles } from '../routes/chat-status.js';

/** The agent's roster tile: a CSS shape holding the profile's initial. */
export function ProfileMark({
  profile,
  size,
}: {
  readonly profile: AgentProfile;
  readonly size: 'tile' | 'row' | 'head';
}): React.JSX.Element {
  return (
    <span className={`markTile mark-${size} mark-${profile.mark}`} aria-hidden="true">
      {profile.name.slice(0, 1).toUpperCase()}
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
        <div>
          <p className="eyebrow">Your agents</p>
          <h1>Agents</h1>
        </div>
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

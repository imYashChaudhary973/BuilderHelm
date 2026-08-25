import type { BoardPaneStatus, BoardPaneSummary } from '@zero/protocol/board';
import {
  swarmGraphHub,
  swarmGraphPoints,
  swarmSeatLabel,
  type SwarmAssignment,
  type SwarmMemberStatus,
  type SwarmRunStatus,
} from '@zero/protocol/swarm';
import { useMemo, useState, type ReactNode } from 'react';

export interface SwarmLiveMember {
  readonly pane: BoardPaneSummary;
  readonly assignment: SwarmAssignment | undefined;
  readonly status: SwarmMemberStatus;
}

export function SwarmLive({
  name,
  job,
  folder,
  isolation,
  status,
  remainLabel,
  members,
  stopped,
  children,
  onStopAll,
  onStopSeat,
  onDirect,
}: {
  readonly name: string;
  readonly job: string;
  readonly folder: string;
  readonly isolation: 'worktree' | 'shared';
  readonly status: SwarmRunStatus;
  readonly remainLabel: string;
  readonly members: readonly SwarmLiveMember[];
  readonly stopped: boolean;
  readonly children: ReactNode;
  readonly onStopAll: () => void;
  readonly onStopSeat: (paneId: string) => void;
  readonly onDirect: (paneIds: readonly string[], text: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<'graph' | 'terminals'>('graph');
  const [target, setTarget] = useState('all');
  const [draft, setDraft] = useState('');
  const roles = members.map((item) => item.assignment?.role ?? 'builder');
  const points = useMemo(() => swarmGraphPoints(roles), [roles]);
  const hub = swarmGraphHub(roles);

  function send(): void {
    const text = draft.trim();
    if (text.length === 0) return;
    const paneIds =
      target === 'all'
        ? members.map((item) => item.pane.paneId)
        : members
            .filter((item) => item.pane.paneId === target)
            .map((item) => item.pane.paneId);
    onDirect(paneIds, text);
    setDraft('');
  }

  return (
    <section className="swarmLive" aria-labelledby="swarm-title" data-core-status="ready">
      <header className="swarmLiveHead">
        <div>
          <p className="eyebrow">BuilderHelm Swarm</p>
          <h1 id="swarm-title">{name}</h1>
          <p>
            {folder} · {isolation === 'worktree' ? 'worktrees' : 'shared folder'} ·{' '}
            {status} · {remainLabel}
          </p>
        </div>
        <div className="swarmLiveActions">
          <button
            className={
              view === 'graph' ? 'secondaryButton swarmViewOn' : 'secondaryButton'
            }
            type="button"
            onClick={() => setView('graph')}
          >
            Graph
          </button>
          <button
            className={
              view === 'terminals' ? 'secondaryButton swarmViewOn' : 'secondaryButton'
            }
            type="button"
            onClick={() => setView('terminals')}
          >
            Terminals
          </button>
          <button
            className="stopButton"
            type="button"
            onClick={onStopAll}
            disabled={stopped}
          >
            Stop swarm
          </button>
        </div>
      </header>
      <p className="swarmJobLine">{job.trim()}</p>
      <div className="swarmLiveStage">
        {view === 'graph' ? (
          <div className="swarmGraph" role="img" aria-label="Swarm roster graph">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {points.map((point, index) =>
                index === hub ? null : (
                  <line
                    key={members[index]?.pane.paneId ?? index}
                    x1={points[hub]?.x ?? 50}
                    y1={points[hub]?.y ?? 72}
                    x2={point.x}
                    y2={point.y}
                  />
                ),
              )}
            </svg>
            {members.map((member, index) => {
              const point = points[index] ?? { x: 50, y: 50 };
              const on = target === member.pane.paneId;
              return (
                <button
                  key={member.pane.paneId}
                  type="button"
                  className={on ? 'swarmNode swarmNodeOn' : 'swarmNode'}
                  data-role={member.assignment?.role ?? 'builder'}
                  data-status={member.status}
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  onClick={() => setTarget(member.pane.paneId)}
                >
                  <i />
                  <strong>{swarmSeatLabel(roles, index)}</strong>
                  <span>{member.assignment?.agentId ?? member.pane.agentId}</span>
                  <em>{statusLabel(member.status)}</em>
                </button>
              );
            })}
          </div>
        ) : (
          children
        )}
        <aside className="swarmRosterRail" aria-label="Roster">
          <header>
            <strong>Roster</strong>
            <span>{members.length} seats</span>
          </header>
          <ul>
            {members.map((member, index) => (
              <li key={member.pane.paneId}>
                <div>
                  <strong>{swarmSeatLabel(roles, index)}</strong>
                  <em data-status={member.status}>{statusLabel(member.status)}</em>
                </div>
                <p>
                  {member.assignment?.role ?? 'builder'} ·{' '}
                  {member.assignment?.agentId ?? member.pane.agentId}
                  {member.assignment?.auto ? ' · auto' : ''}
                </p>
                <button
                  type="button"
                  disabled={
                    stopped || member.status === 'exited' || member.status === 'failed'
                  }
                  onClick={() => onStopSeat(member.pane.paneId)}
                >
                  Stop
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <form
        className="swarmDirect"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="all">@all</option>
          {members.map((member, index) => (
            <option key={member.pane.paneId} value={member.pane.paneId}>
              @{swarmSeatLabel(roles, index)}
            </option>
          ))}
        </select>
        <input
          value={draft}
          placeholder="Direct the swarm…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="primaryButton"
          type="submit"
          disabled={draft.trim().length === 0 || stopped}
        >
          Send
        </button>
      </form>
    </section>
  );
}

function statusLabel(status: SwarmMemberStatus | BoardPaneStatus): string {
  return status;
}

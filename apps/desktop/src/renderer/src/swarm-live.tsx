import {
  swarmGraphHub,
  swarmGraphPoints,
  swarmSeatLabel,
  type SwarmRole,
  type SwarmRunRecordStatus,
  type SwarmSeatStatus,
  type SwarmState,
} from '@builderhelm/protocol/swarm';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

export interface SwarmLiveSeat {
  readonly seatId: string;
  readonly paneId: string | null;
  readonly role: SwarmRole;
  readonly agentId: string;
  readonly status: SwarmSeatStatus;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly branch: string | null;
}

type InspectorTab = 'agent' | 'plan' | 'chat' | 'activity' | 'roster';

const TABS: readonly { readonly id: InspectorTab; readonly label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'plan', label: 'Plan' },
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'roster', label: 'Roster' },
];

function money(value: number): string {
  return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function clockOf(iso: string): string {
  return iso.slice(11, 19);
}

function elapsedLabel(iso: string, now: number): string {
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return '';
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function activeTaskFor(
  tasks: SwarmState['tasks'],
  seatId: string,
): SwarmState['tasks'][number] | undefined {
  return tasks.find(
    (task) =>
      task.seatId === seatId &&
      (task.status === 'in_progress' || task.status === 'review'),
  );
}

export function SwarmLive({
  name,
  job,
  folder,
  isolation,
  status,
  remainLabel,
  seats,
  state,
  previews,
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
  readonly status: SwarmRunRecordStatus | 'coordinating';
  readonly remainLabel: string;
  readonly seats: readonly SwarmLiveSeat[];
  readonly state: SwarmState | null;
  readonly previews: Readonly<Record<string, string>>;
  readonly stopped: boolean;
  readonly children: ReactNode;
  readonly onStopAll: () => void;
  readonly onStopSeat: (seatId: string) => void;
  readonly onDirect: (seatIds: readonly string[], text: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<'graph' | 'terminals'>('graph');
  const [tab, setTab] = useState<InspectorTab>('roster');
  const [target, setTarget] = useState('all');
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const roles = seats.map((seat) => seat.role);
  const points = useMemo(() => swarmGraphPoints(roles), [roles]);
  const hub = swarmGraphHub(roles);
  const tasks = state?.tasks ?? [];
  const landed = tasks.filter((task) => task.status === 'landed').length;
  const builderCount = seats.filter((seat) => seat.role === 'builder').length;
  const selected = seats.find((seat) => seat.seatId === target);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const spend = seats.reduce((total, seat) => total + seat.costUsd, 0);
  const tokens = seats.reduce((total, seat) => total + seat.tokensUsed, 0);
  const failedTasks = tasks.filter((task) => task.status === 'failed').length;

  function send(): void {
    const text = draft.trim();
    if (text.length === 0) return;
    const ids =
      target === 'all' ? seats.map((seat) => seat.seatId) : [target].filter(Boolean);
    onDirect(ids, text);
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
            {tasks.length > 0 ? ` · ${landed}/${tasks.length} tasks landed` : ''}
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
      {status === 'coordinating' ? (
        <div className="swarmCoordinating" role="status">
          <span className="swarmCoordinatingBar" aria-hidden="true" />
          <p>
            The coordinator is reading the repository and splitting the mission into
            tasks. Seats warm up in parallel — the swarm starts the moment the plan lands.
          </p>
        </div>
      ) : null}
      {status === 'done' || status === 'failed' ? (
        <div className="swarmSummary" data-status={status} role="status">
          <strong>
            {status === 'done' ? 'Swarm finished' : 'Swarm stopped with failures'}
          </strong>
          <p>
            {landed} landed
            {failedTasks > 0 ? ` · ${failedTasks} failed` : ''}
            {tasks.length > 0 ? ` of ${tasks.length}` : ''}
            {tokens > 0 ? ` · ${tokens} tok · ${money(spend)}` : ''}
          </p>
        </div>
      ) : null}
      <div className="swarmLiveStage">
        {view === 'graph' ? (
          <div
            className="swarmGraph"
            role="img"
            aria-label="Swarm roster graph"
            data-phase={status}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {points.map((point, index) =>
                index === hub ? null : (
                  <line
                    key={seats[index]?.seatId ?? index}
                    className={
                      status === 'coordinating' ||
                      seats[index]?.status === 'working' ||
                      seats[index]?.status === 'booting'
                        ? 'swarmEdgeLive'
                        : undefined
                    }
                    x1={points[hub]?.x ?? 50}
                    y1={points[hub]?.y ?? 72}
                    x2={point.x}
                    y2={point.y}
                  />
                ),
              )}
            </svg>
            {seats.map((seat, index) => {
              const point = points[index] ?? { x: 50, y: 50 };
              const on = target === seat.seatId;
              const preview = seat.paneId === null ? '' : (previews[seat.paneId] ?? '');
              const active = activeTaskFor(tasks, seat.seatId);
              const elapsed =
                active === undefined ? '' : elapsedLabel(active.updatedAt, now);
              return (
                <button
                  key={seat.seatId}
                  type="button"
                  className={on ? 'swarmNode swarmNodeOn' : 'swarmNode'}
                  data-role={seat.role}
                  data-status={seat.status}
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  onClick={() => setTarget(seat.seatId)}
                >
                  <i />
                  <strong>{swarmSeatLabel(roles, index)}</strong>
                  <span>{seat.agentId}</span>
                  <em>{seat.status}</em>
                  {active !== undefined ? (
                    <span className="swarmNodeNow">
                      {active.title}
                      {elapsed.length > 0 ? ` · ${elapsed}` : ''}
                    </span>
                  ) : null}
                  {preview.length > 0 ? (
                    <span className="swarmNodePreview">{preview.slice(-160)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          children
        )}
        <aside className="swarmRosterRail" aria-label="Swarm inspector">
          <nav className="swarmTabs" aria-label="Inspector tabs">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={tab === entry.id ? 'swarmTab swarmTabOn' : 'swarmTab'}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          {tab === 'roster' ? (
            <ul className="swarmRosterList">
              {seats.map((seat, index) => (
                <li key={seat.seatId}>
                  <div>
                    <strong>{swarmSeatLabel(roles, index)}</strong>
                    <em data-status={seat.status}>{seat.status}</em>
                  </div>
                  <p>
                    {seat.role} · {seat.agentId}
                    {seat.tokensUsed > 0
                      ? ` · ${seat.tokensUsed} tok · ${money(seat.costUsd)}`
                      : ''}
                  </p>
                  <button
                    type="button"
                    disabled={stopped || seat.status === 'exited'}
                    onClick={() => onStopSeat(seat.seatId)}
                  >
                    Stop
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {tab === 'agent' ? (
            <div className="swarmInspectorBody">
              {selected === undefined ? (
                <p>Select a seat in the graph to inspect it.</p>
              ) : (
                <dl>
                  <dt>Role</dt>
                  <dd>{selected.role}</dd>
                  <dt>CLI</dt>
                  <dd>{selected.agentId}</dd>
                  <dt>Status</dt>
                  <dd>{selected.status}</dd>
                  <dt>Branch</dt>
                  <dd>{selected.branch ?? 'not created yet'}</dd>
                  <dt>Spend</dt>
                  <dd>
                    {selected.tokensUsed} tokens · {money(selected.costUsd)}
                  </dd>
                </dl>
              )}
            </div>
          ) : null}

          {tab === 'plan' ? (
            <ol className="swarmPlanList">
              {tasks.length === 0 ? <li>No tasks planned yet.</li> : null}
              {tasks.length > 0 && tasks.length < builderCount ? (
                <li>
                  <strong>
                    {tasks.length} task{tasks.length === 1 ? '' : 's'} for {builderCount}{' '}
                    builders
                  </strong>
                  <span>
                    This mission does not split further, so the spare seats stay idle
                    instead of duplicating work.
                  </span>
                </li>
              ) : null}
              {tasks.map((task) => (
                <li key={task.id} data-status={task.status}>
                  <strong>{task.title}</strong>
                  <span>
                    {task.status}
                    {task.dependsOn.length > 0
                      ? ` · waits on ${task.dependsOn.length}`
                      : ''}
                    {task.attempts > 1 ? ` · attempt ${task.attempts}` : ''}
                  </span>
                  {task.files.length > 0 ? <em>{task.files.join(', ')}</em> : null}
                </li>
              ))}
            </ol>
          ) : null}

          {tab === 'chat' ? (
            <ul className="swarmChatList">
              {(state?.messages ?? [])
                .filter(
                  (message) =>
                    message.kind === 'directive' ||
                    message.kind === 'coordinator_note' ||
                    message.kind === 'seat_report',
                )
                .map((message) => (
                  <li key={message.id} data-kind={message.kind}>
                    <span>{message.kind}</span>
                    <p>{message.body}</p>
                  </li>
                ))}
            </ul>
          ) : null}

          {tab === 'activity' ? (
            <ul className="swarmActivityList">
              {[...(state?.messages ?? [])].reverse().map((message) => (
                <li key={message.id} data-kind={message.kind}>
                  <span>{clockOf(message.createdAt)}</span>
                  <p>{message.body}</p>
                </li>
              ))}
            </ul>
          ) : null}
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
          {seats.map((seat, index) => (
            <option key={seat.seatId} value={seat.seatId}>
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

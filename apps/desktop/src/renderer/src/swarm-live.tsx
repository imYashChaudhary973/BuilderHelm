import type { BoardAgentId } from '@zero/protocol/board';
import {
  SWARM_SINGLE_TASK_NOTE,
  swarmGraphHub,
  swarmGraphPoints,
  swarmSeatLabel,
  type SwarmRole,
  type SwarmRunRecordStatus,
  type SwarmSeatStatus,
  type SwarmState,
} from '@zero/protocol/swarm';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AgentMark } from './components/agent-mark.js';
import { SignalField } from './components/signal-field.js';

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

function planWhy(
  task: SwarmState['tasks'][number],
  messages: SwarmState['messages'],
): string | undefined {
  if (task.status !== 'failed' && !(task.status === 'pending' && task.attempts > 1)) {
    return undefined;
  }
  let found: string | undefined;
  const failed = `failed "${task.title}"`;
  const retrying = `retrying "${task.title}"`;
  for (const message of messages) {
    const body = message.body;
    if (
      !body.includes(failed) &&
      !body.includes(retrying) &&
      !(
        body.includes(task.title) &&
        (body.includes('verify gate') || body.includes('review:'))
      )
    ) {
      continue;
    }
    const mark = `"${task.title}": `;
    const at = body.lastIndexOf(mark);
    found = at >= 0 ? body.slice(at + mark.length) : body;
  }
  return found;
}

/** Stop the last vertical at the node box edge, not inside the card. */
function elbowToBox(
  hx: number,
  hy: number,
  tx: number,
  ty: number,
  size: { readonly w: number; readonly h: number },
): string {
  const halfH = (48 / Math.max(size.h, 1)) * 100;
  const midY = (hy + ty) / 2;
  const startY = hy + Math.sign(midY - hy || 1) * halfH;
  const endY = ty - Math.sign(ty - midY || 1) * halfH;
  return `M ${hx} ${startY} L ${hx} ${midY} L ${tx} ${midY} L ${tx} ${endY}`;
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
  onAddSeat,
  detected,
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
  readonly onAddSeat?: (role: SwarmRole) => void;
  readonly detected?: readonly BoardAgentId[];
}): React.JSX.Element {
  const [view, setView] = useState<'graph' | 'terminals'>('graph');
  const [tab, setTab] = useState<InspectorTab>('roster');
  const [agentView, setAgentView] = useState<'full' | 'seat'>('full');
  const [target, setTarget] = useState('all');
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    const node = graphRef.current;
    if (node === null) return;
    const measure = (): void => {
      setGraphSize({ w: node.clientWidth, h: node.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const roles = seats.map((seat) => seat.role);
  const points = useMemo(() => swarmGraphPoints(roles), [roles]);
  const hub = swarmGraphHub(roles);
  const tasks = state?.tasks ?? [];
  const landed = tasks.filter((task) => task.status === 'landed').length;
  const builderCount = seats.filter((seat) => seat.role === 'builder').length;
  const selected = seats.find((seat) => seat.seatId === target);
  const showAdd =
    onAddSeat !== undefined && detected !== undefined && !stopped && seats.length < 12;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  const spend = seats.reduce((total, seat) => total + seat.costUsd, 0);
  const tokens = seats.reduce((total, seat) => total + seat.tokensUsed, 0);
  const failedTasks = tasks.filter((task) => task.status === 'failed').length;
  const singleTaskFallback = (state?.messages ?? []).some(
    (message) => message.body === SWARM_SINGLE_TASK_NOTE,
  );
  const plannerNote = [...(state?.messages ?? [])]
    .reverse()
    .find(
      (message) =>
        message.body.startsWith('Planner failed:') ||
        message.body.startsWith('Swarm failed:'),
    )?.body;

  function send(): void {
    const text = draft.trim();
    if (text.length === 0) return;
    const ids =
      target === 'all' ? seats.map((seat) => seat.seatId) : [target].filter(Boolean);
    onDirect(ids, text);
    setDraft('');
  }

  function seatNode(seat: SwarmLiveSeat, index: number): ReactNode {
    const point = points[index] ?? { x: 50, y: 50 };
    const on = target === seat.seatId;
    const preview = seat.paneId === null ? '' : (previews[seat.paneId] ?? '');
    const active = activeTaskFor(tasks, seat.seatId);
    const elapsed = active === undefined ? '' : elapsedLabel(active.updatedAt, now);
    const markOn = on || seat.status === 'working';
    return (
      <div
        key={seat.seatId}
        className={[
          'swarmNode',
          index === hub ? 'courtQueen' : '',
          on ? 'swarmNodeOn' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-role={seat.role}
        data-status={seat.status}
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
        onClick={() => setTarget(seat.seatId)}
      >
        <AgentMark
          id={seat.agentId as BoardAgentId}
          on={markOn}
          onClick={() => setTarget(seat.seatId)}
        />
        <strong>{seat.role === 'coordinator' ? 'queen' : seat.role}</strong>
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
      </div>
    );
  }

  return (
    <section
      className="spaceStage"
      aria-labelledby="swarm-title"
      data-core-status="ready"
    >
      <SignalField />
      <div className="swarmLive">
        <header className="swarmLiveHead">
          <div>
            <p className="eyebrow">BuilderHelm Swarm</p>
            <h1 id="swarm-title">{name}</h1>
            <p>
              {folder} · {isolation === 'worktree' ? 'worktrees' : 'shared folder'} ·{' '}
              {status} · {remainLabel}
              {tasks.length > 0 ? ` · ${landed}/${tasks.length} landed` : ''}
              {failedTasks > 0 ? ` · ${failedTasks} failed` : ''}
              {` · ${tokens} tok · ${money(spend)}`}
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
        {singleTaskFallback ? (
          <p className="swarmFallback" role="status">
            {SWARM_SINGLE_TASK_NOTE}
          </p>
        ) : null}
        {plannerNote !== undefined ? (
          <p className="swarmFallback" role="status">
            {plannerNote}
          </p>
        ) : null}
        {status === 'coordinating' ? (
          <div className="swarmCoordinating" role="status">
            <span className="swarmCoordinatingBar" aria-hidden="true" />
            <p>
              The coordinator is reading the repository and splitting the mission into
              tasks. Seats warm up in parallel — the swarm starts the moment the plan
              lands.
            </p>
          </div>
        ) : null}
        {status === 'done' ||
        status === 'failed' ||
        status === 'stopped' ||
        status === 'budget' ? (
          <div className="swarmSummary" data-status={status} role="status">
            <strong>
              {status === 'done'
                ? 'Swarm finished'
                : status === 'failed'
                  ? 'Swarm stopped with failures'
                  : status === 'budget'
                    ? 'Budget spent; swarm stopped'
                    : 'Swarm stopped'}
            </strong>
            <p>
              {landed} landed
              {failedTasks > 0 ? ` · ${failedTasks} failed` : ''}
              {tasks.length > 0 ? ` of ${tasks.length}` : ''}
              {tokens > 0 ? ` · ${tokens} tok · ${money(spend)}` : ''}
            </p>
            {plannerNote !== undefined ? <p>{plannerNote}</p> : null}
          </div>
        ) : null}
        {showAdd && onAddSeat !== undefined ? (
          <div className="wizardSection">
            <div className="swarmRoleChips">
              {(['coordinator', 'builder', 'scout', 'reviewer'] as const).map((role) => (
                <button key={role} type="button" onClick={() => onAddSeat(role)}>
                  + {role}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="swarmLiveStage">
          {view === 'graph' ? (
            <div
              ref={graphRef}
              className="swarmGraph courtPreview"
              role="img"
              aria-label="Swarm roster graph"
              data-phase={status}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {points.map((point, index) => {
                  if (index === hub) return null;
                  const hx = points[hub]?.x ?? 50;
                  const hy = points[hub]?.y ?? 58;
                  return (
                    <path
                      key={seats[index]?.seatId ?? index}
                      className={
                        status === 'coordinating' ||
                        seats[index]?.status === 'working' ||
                        seats[index]?.status === 'booting'
                          ? 'swarmEdgeLive'
                          : undefined
                      }
                      fill="none"
                      d={elbowToBox(hx, hy, point.x, point.y, graphSize)}
                    />
                  );
                })}
              </svg>
              {seats[hub] !== undefined ? seatNode(seats[hub], hub) : null}
              <div className="courtWorkers">
                {seats.map((seat, index) =>
                  index === hub ? null : seatNode(seat, index),
                )}
              </div>
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
              <ul className="swarmSeatList">
                {seats.map((seat) => (
                  <li key={seat.seatId}>
                    <AgentMark
                      id={seat.agentId as BoardAgentId}
                      on={target === seat.seatId || seat.status === 'working'}
                      onClick={() => setTarget(seat.seatId)}
                    />
                    <strong>{seat.role === 'coordinator' ? 'queen' : seat.role}</strong>
                    <span>{seat.agentId}</span>
                    <em data-status={seat.status}>{seat.status}</em>
                    <button
                      className="stopButton"
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
                <div className="swarmAgentModes">
                  <button
                    type="button"
                    className={agentView === 'full' ? 'swarmTab swarmTabOn' : 'swarmTab'}
                    onClick={() => setAgentView('full')}
                  >
                    Full
                  </button>
                  <button
                    type="button"
                    className={agentView === 'seat' ? 'swarmTab swarmTabOn' : 'swarmTab'}
                    onClick={() => setAgentView('seat')}
                  >
                    Seat
                  </button>
                </div>
                {agentView === 'full' ? (
                  <dl>
                    <dt>Status</dt>
                    <dd>{status}</dd>
                    <dt>Budget</dt>
                    <dd>{remainLabel}</dd>
                    <dt>Tasks</dt>
                    <dd>
                      {landed} landed
                      {failedTasks > 0 ? ` · ${failedTasks} failed` : ''}
                      {tasks.length > 0 ? ` of ${tasks.length}` : ''}
                    </dd>
                    <dt>Tokens</dt>
                    <dd>{tokens}</dd>
                    <dt>Cost</dt>
                    <dd>{money(spend)}</dd>
                    <dt>Seats</dt>
                    <dd>
                      {seats.length} · {builderCount} builders
                    </dd>
                  </dl>
                ) : selected === undefined ? (
                  <p>Select a seat in the graph to inspect it.</p>
                ) : (
                  <dl>
                    <dt>Role</dt>
                    <dd>{selected.role === 'coordinator' ? 'queen' : selected.role}</dd>
                    <dt>CLI</dt>
                    <dd>{selected.agentId}</dd>
                    <dt>Status</dt>
                    <dd>{selected.status}</dd>
                    <dt>Branch</dt>
                    <dd>{selected.branch ?? 'not created yet'}</dd>
                    <dt>Tokens</dt>
                    <dd>{selected.tokensUsed}</dd>
                    <dt>Cost</dt>
                    <dd>{money(selected.costUsd)}</dd>
                    <dt>Task</dt>
                    <dd>
                      {activeTaskFor(tasks, selected.seatId)?.title ??
                        (selected.status === 'idle' ? 'Idle' : selected.status)}
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
                      {tasks.length} task{tasks.length === 1 ? '' : 's'} for{' '}
                      {builderCount} builders
                    </strong>
                    <span>
                      This mission does not split further, so the spare seats stay idle
                      instead of duplicating work.
                    </span>
                  </li>
                ) : null}
                {tasks.map((task) => {
                  const why = planWhy(task, state?.messages ?? []);
                  return (
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
                      {why !== undefined ? <em className="swarmPlanWhy">{why}</em> : null}
                    </li>
                  );
                })}
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
          className="spaceWizardFooter swarmDirect"
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
      </div>
    </section>
  );
}

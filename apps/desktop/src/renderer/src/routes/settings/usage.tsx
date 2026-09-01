import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountAgent, QuotaWindow } from '@builderhelm/protocol/accounts';
import { useMemo, useState } from 'react';

function formatReset(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const hoursLeft = hours % 24;
  return hoursLeft === 0 ? `${days}d` : `${days}d ${hoursLeft}h`;
}

function hottest(agent: AccountAgent): QuotaWindow | null {
  const quota = agent.quota;
  if (quota === null) return null;
  const windows = [quota.fiveHour, quota.sevenDay].filter(
    (window): window is QuotaWindow => window !== null,
  );
  if (windows.length === 0) return null;
  return windows.reduce((best, window) =>
    window.usedPercent > best.usedPercent ? window : best,
  );
}

function soonestReset(agent: AccountAgent): string | null {
  const quota = agent.quota;
  if (quota === null) return null;
  const stamps = [quota.fiveHour?.resetsAt, quota.sevenDay?.resetsAt].filter(
    (value): value is string => typeof value === 'string',
  );
  if (stamps.length === 0) return null;
  const soonest = stamps.reduce((best, iso) =>
    new Date(iso).getTime() < new Date(best).getTime() ? iso : best,
  );
  return formatReset(soonest);
}

function QuotaBar({
  label,
  window,
}: {
  readonly label: string;
  readonly window: QuotaWindow | null;
}): React.JSX.Element {
  if (window === null) {
    return (
      <div className="usageWindow">
        <span>{label}</span>
        <span className="usageMeta">—</span>
      </div>
    );
  }
  const hot = window.usedPercent >= 90;
  const reset = formatReset(window.resetsAt);
  return (
    <div className="usageWindow">
      <div className="usageWindowHead">
        <span>{label}</span>
        <span className={hot ? 'usageHot' : 'usageMeta'}>
          {Math.round(window.usedPercent)}%{reset !== null ? ` · resets ${reset}` : ''}
        </span>
      </div>
      <div className="usageTrack" aria-hidden="true">
        <div
          className={hot ? 'usageFill usageFillHot' : 'usageFill'}
          style={{ width: `${Math.min(100, window.usedPercent)}%` }}
        />
      </div>
    </div>
  );
}

export function UsagePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'compact' | 'detailed'>('compact');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    queryFn: () => window.builderHelm.accounts.snapshot(),
  });
  const setRoot = useMutation({
    mutationFn: (input: { agentId: AccountAgent['id']; configRoot: string | null }) =>
      window.builderHelm.accounts.setRoot(input),
    onSuccess: (next) => {
      queryClient.setQueryData(['accounts-snapshot'], next);
    },
  });

  const agents = snapshot.data?.agents ?? [];
  const switchable = useMemo(
    () => agents.filter((agent) => agent.configDirEnv !== null),
    [agents],
  );

  async function chooseRoot(agent: AccountAgent): Promise<void> {
    const folder = await window.builderHelm.board.selectFolder();
    if (folder === null) return;
    setRoot.mutate({ agentId: agent.id, configRoot: folder });
  }

  return (
    <section className="voicePage" aria-labelledby="usage-title">
      <header className="settingsHeader">
        <div>
          <h1 id="usage-title">Usage</h1>
          <p className="voiceLede">
            Claude, Codex, and Grok subscription windows. Missing data stays blank.
          </p>
        </div>
        <button
          type="button"
          className="usageRefresh"
          onClick={() => {
            setRefreshing(true);
            void window.builderHelm.accounts
              .snapshot({ live: true })
              .then((next) => {
                queryClient.setQueryData(['accounts-snapshot'], next);
              })
              .finally(() => setRefreshing(false));
          }}
          disabled={snapshot.isFetching || refreshing}
        >
          Refresh
        </button>
      </header>
      {snapshot.error instanceof Error ? (
        <p className="wizardError" role="alert">
          {snapshot.error.message}
        </p>
      ) : null}
      {setRoot.error instanceof Error ? (
        <p className="wizardError" role="alert">
          {setRoot.error.message}
        </p>
      ) : null}

      <div className="usageToolbar">
        <div className="usageSeg" role="tablist" aria-label="Usage density">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'detailed'}
            className={mode === 'detailed' ? 'usageSegOn' : undefined}
            onClick={() => setMode('detailed')}
          >
            Detailed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'compact'}
            className={mode === 'compact' ? 'usageSegOn' : undefined}
            onClick={() => setMode('compact')}
          >
            Compact
          </button>
        </div>
      </div>

      <ul className="usageList">
        {agents.map((agent) => {
          const peak = hottest(agent);
          const reset = soonestReset(agent);
          const hot = peak !== null && peak.usedPercent >= 90;
          return (
            <li key={agent.id} className="usageRow">
              <span className="usageMark" aria-hidden="true">
                {agent.label.slice(0, 1)}
              </span>
              <div className="usageIdentity">
                <strong>{agent.label}</strong>
                {mode === 'detailed' ? (
                  <div className="usageDetail">
                    <QuotaBar label="5h" window={agent.quota?.fiveHour ?? null} />
                    <QuotaBar label="Weekly" window={agent.quota?.sevenDay ?? null} />
                    {agent.quota?.resetCreditsAvailable !== undefined ? (
                      <p>
                        {agent.quota.resetCreditsAvailable} rate-limit resets available
                      </p>
                    ) : null}
                    {agent.auth === 'missing' ? <p>Not installed</p> : null}
                  </div>
                ) : agent.auth === 'missing' ? (
                  <p>Not installed</p>
                ) : null}
              </div>
              <span className={hot ? 'usageMeta usageHot' : 'usageMeta'}>
                {peak === null
                  ? `Run ${agent.label} to refresh`
                  : `${Math.round(peak.usedPercent)}%${reset !== null ? ` · ${reset}` : ''}`}
              </span>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="usageManage"
        onClick={() => setAccountsOpen((open) => !open)}
      >
        Manage accounts
      </button>
      {accountsOpen ? (
        <ul className="usageAccounts">
          {switchable.map((agent) => (
            <li key={agent.id}>
              <div>
                <strong>{agent.label}</strong>
                <p>{agent.configRoot ?? `Default (${agent.configDirEnv})`}</p>
              </div>
              <div className="usageRoot">
                <button type="button" onClick={() => void chooseRoot(agent)}>
                  Choose folder
                </button>
                {agent.configRoot !== null ? (
                  <button
                    type="button"
                    onClick={() =>
                      setRoot.mutate({ agentId: agent.id, configRoot: null })
                    }
                  >
                    Use default
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

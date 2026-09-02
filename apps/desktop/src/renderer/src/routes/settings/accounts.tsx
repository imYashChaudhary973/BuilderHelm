import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountHome, QuotaProviderId } from '@builderhelm/protocol/accounts';
import { SYSTEM_ACCOUNT_ID } from '@builderhelm/protocol/accounts';

function formatReset(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  if (ms <= 0) return 'now';
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const hoursLeft = hours % 24;
  return hoursLeft === 0 ? `${days}d` : `${days}d ${hoursLeft}h`;
}

function HomeRow({
  home,
  onActive,
  onRemove,
}: {
  readonly home: AccountHome;
  readonly onActive: () => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  return (
    <li className="usageAccountRow">
      <div>
        <strong>
          {home.id === SYSTEM_ACCOUNT_ID ? 'System default' : home.label}
          {home.active ? <span className="usageBadge">Active</span> : null}
        </strong>
        <p>
          {home.email ??
            (home.id === SYSTEM_ACCOUNT_ID
              ? 'Use the login already on this device.'
              : 'Open a pane with this CLI to sign in. Auth stays on this device.')}
        </p>
      </div>
      <div className="usageAccountActions">
        {home.active ? null : (
          <button type="button" onClick={onActive}>
            Use
          </button>
        )}
        {home.id === SYSTEM_ACCOUNT_ID ? null : (
          <button type="button" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

export function AccountsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    queryFn: () => window.builderHelm.accounts.snapshot(),
  });
  const mutate = useMutation({
    mutationFn: async (
      action:
        | { type: 'add'; provider: QuotaProviderId }
        | { type: 'remove'; provider: QuotaProviderId; id: string }
        | { type: 'active'; provider: QuotaProviderId; id: string }
        | { type: 'refresh' },
    ) => {
      if (action.type === 'add')
        return window.builderHelm.accounts.add({ provider: action.provider });
      if (action.type === 'remove') {
        return window.builderHelm.accounts.remove({
          provider: action.provider,
          id: action.id,
        });
      }
      if (action.type === 'active') {
        return window.builderHelm.accounts.setActive({
          provider: action.provider,
          id: action.id,
        });
      }
      return window.builderHelm.accounts.snapshot({ live: true });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['accounts-snapshot'], next);
    },
  });

  return (
    <section className="voicePage" aria-labelledby="accounts-title">
      <header className="settingsHeader">
        <div>
          <h1 id="accounts-title">AI Provider Accounts</h1>
          <p className="voiceLede">
            Optional. BuilderHelm uses the CLI login already on this device. Add extra
            homes only to switch Claude, Codex, or Grok without copying credentials.
          </p>
        </div>
        <button
          type="button"
          className="usageRefresh"
          disabled={mutate.isPending || snapshot.isFetching}
          onClick={() => mutate.mutate({ type: 'refresh' })}
        >
          Refresh
        </button>
      </header>
      {snapshot.error instanceof Error ? (
        <p className="wizardError" role="alert">
          {snapshot.error.message}
        </p>
      ) : null}
      {mutate.error instanceof Error ? (
        <p className="wizardError" role="alert">
          {mutate.error.message}
        </p>
      ) : null}
      <ul className="usageProviderList">
        {(snapshot.data?.providers ?? []).map((provider) => {
          const five = provider.quota?.fiveHour;
          const week = provider.quota?.sevenDay;
          return (
            <li key={provider.id} className="usageProviderCard">
              <header>
                <strong>{provider.label}</strong>
                <p>
                  {provider.id === 'grok'
                    ? 'Weekly credits come from Grok when a non-interactive stats command exists. Email is read from the session file; tokens are not stored.'
                    : provider.id === 'codex'
                      ? '5-hour and weekly windows from Codex app-server. Extra accounts use a separate CODEX_HOME.'
                      : '5-hour and weekly windows from Claude Code statusLine. Extra accounts use CLAUDE_CONFIG_DIR.'}
                </p>
              </header>
              <div className="usageDetail">
                <p className="usageMeta">
                  5h{' '}
                  {five === null || five === undefined
                    ? '—'
                    : `${Math.round(five.usedPercent)}%`}
                  {five?.resetsAt !== undefined && five.resetsAt !== null
                    ? ` · ${formatReset(five.resetsAt)}`
                    : ''}
                  {' · '}
                  Weekly{' '}
                  {week === null || week === undefined
                    ? '—'
                    : `${Math.round(week.usedPercent)}%`}
                  {week?.resetsAt !== undefined && week.resetsAt !== null
                    ? ` · ${formatReset(week.resetsAt)}`
                    : ''}
                </p>
              </div>
              <div className="usageAccountHead">
                <span>Accounts</span>
                <button
                  type="button"
                  onClick={() => mutate.mutate({ type: 'add', provider: provider.id })}
                >
                  + Add Account
                </button>
              </div>
              <ul className="usageAccountList">
                {provider.homes.map((home) => (
                  <HomeRow
                    key={home.id}
                    home={home}
                    onActive={() =>
                      mutate.mutate({
                        type: 'active',
                        provider: provider.id,
                        id: home.id,
                      })
                    }
                    onRemove={() =>
                      mutate.mutate({
                        type: 'remove',
                        provider: provider.id,
                        id: home.id,
                      })
                    }
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

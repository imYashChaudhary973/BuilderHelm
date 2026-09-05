import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountHome,
  AccountProvider,
  QuotaProviderId,
  QuotaWindow,
} from '@builderhelm/protocol/accounts';
import { SYSTEM_ACCOUNT_ID } from '@builderhelm/protocol/accounts';

import { AgentGlyph } from '../../components/agent-mark.js';

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

function formatAgo(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const stamp = new Date(iso).getTime();
  if (Number.isNaN(stamp)) return null;
  const minutes = Math.floor(Math.max(0, Date.now() - stamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

type Meter = {
  readonly key: string;
  readonly title: string;
  readonly note: string | null;
  readonly window: QuotaWindow | null;
};

function metersOf(provider: AccountProvider): readonly Meter[] {
  if (provider.id === 'grok') {
    return provider.homes.flatMap((home) =>
      home.email === null && home.billing === null
        ? []
        : [
            {
              key: home.id,
              title: home.email ?? home.label,
              note: home.billing?.tier ?? null,
              window:
                home.billing === null
                  ? null
                  : {
                      usedPercent: home.billing.usedPercent,
                      resetsAt: home.billing.periodEnd,
                    },
            },
          ],
    );
  }
  const quota = provider.quota;
  return [
    { key: '5h', title: 'Session', note: '5 hours', window: quota?.fiveHour ?? null },
    { key: 'wk', title: 'Weekly', note: '7 days', window: quota?.sevenDay ?? null },
  ];
}

function MeterRow({ meter }: { readonly meter: Meter }): React.JSX.Element {
  const window = meter.window;
  const reset = window === null ? null : formatReset(window.resetsAt);
  const hot = window !== null && window.usedPercent >= 90;
  return (
    <div className="usageMeterRow">
      <div className="usageMeterHead">
        <span className="usageMeterTitle">{meter.title}</span>
        {meter.note !== null ? (
          <span className="usageMeterNote">{meter.note}</span>
        ) : null}
      </div>
      <span className="usageTrack" aria-hidden="true">
        {window === null ? null : (
          <span
            className={hot ? 'usageFill usageFillHot' : 'usageFill'}
            style={{ width: `${Math.max(2, Math.min(100, window.usedPercent))}%` }}
          />
        )}
      </span>
      <div className="usageMeterFoot">
        {window === null ? (
          <span className="usageMeta">No usage reported yet</span>
        ) : (
          <>
            <span className={hot ? 'usageHot' : undefined}>
              {Math.round(window.usedPercent)}% used
            </span>
            <span className="usageMeta">
              {reset === null ? '' : `Resets in ${reset}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
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
  const system = home.id === SYSTEM_ACCOUNT_ID;
  const signedIn = home.email !== null;
  const note = system
    ? 'The login already on this device'
    : signedIn
      ? 'Isolated home'
      : 'Waiting for the login to finish';
  return (
    <li className="usageAccountRow">
      <div className="usageAccountId">
        <strong>{signedIn ? home.label : `${home.label} · signing in`}</strong>
        <p>{note}</p>
      </div>
      <div className="usageAccountActions">
        {home.active ? (
          <span className="usageBadge">Active</span>
        ) : (
          <button type="button" onClick={onActive}>
            Use
          </button>
        )}
        {system ? null : (
          <button type="button" onClick={onRemove} aria-label={`Remove ${home.label}`}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

const PROVIDER_NOTE: Record<QuotaProviderId, string> = {
  claude: 'Official usage endpoint, every 30 seconds.',
  codex: 'Codex app-server on every refresh.',
  grok: 'Each account’s billing log. First read needs one session.',
};

export function UsagePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    queryFn: () => window.builderHelm.accounts.snapshot(),
    refetchInterval: 30_000,
  });
  const mutate = useMutation({
    mutationFn: async (
      action:
        | { type: 'add'; provider: QuotaProviderId }
        | { type: 'remove'; provider: QuotaProviderId; id: string }
        | { type: 'active'; provider: QuotaProviderId; id: string }
        | { type: 'hook'; enabled: boolean }
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
      if (action.type === 'hook') {
        return window.builderHelm.accounts.toggleHook({ enabled: action.enabled });
      }
      return window.builderHelm.accounts.snapshot({ live: true });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['accounts-snapshot'], next);
    },
  });
  const busy = mutate.isPending || snapshot.isFetching;
  const hookOn = snapshot.data?.hookSystemDefault ?? false;
  const providers = snapshot.data?.providers ?? [];
  const updated = formatAgo(snapshot.data?.occurredAt);

  return (
    <section className="usagePage" aria-labelledby="usage-title">
      <header className="usagePageHead">
        <div className="usagePageTitle">
          <h1 id="usage-title">Usage</h1>
          <p>
            Session and weekly windows for the CLIs on this Mac. Your BuilderHelm login is
            under Account.
          </p>
        </div>
        <div className="usagePageActions">
          <span className="usagePageState">
            {updated === null ? '—' : `Updated ${updated}`}
          </span>
          <button
            type="button"
            className="usageRefresh"
            disabled={busy}
            onClick={() => mutate.mutate({ type: 'refresh' })}
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
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
        {providers.map((provider) => (
          <li key={provider.id} className="usageProviderCard">
            <header className="usageProviderHead">
              <span className="usageRowMark" aria-hidden="true">
                <AgentGlyph id={provider.id} />
              </span>
              <div>
                <strong>{provider.label}</strong>
                <p>{PROVIDER_NOTE[provider.id]}</p>
              </div>
              {provider.installed ? null : (
                <span className="usageBadgeMuted">Not installed</span>
              )}
            </header>
            <div className="usageMeterGrid">
              {metersOf(provider).map((meter) => (
                <MeterRow key={meter.key} meter={meter} />
              ))}
            </div>
            <div className="usageAccountHead">
              <span>CLI logins</span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const created = await window.builderHelm.accounts.add({
                    provider: provider.id,
                  });
                  queryClient.setQueryData(['accounts-snapshot'], created);
                  const home = created.providers
                    .find((entry) => entry.id === provider.id)
                    ?.homes.find((entry) => entry.active && entry.configRoot !== null);
                  if (home?.configRoot === undefined || home.configRoot === null) return;
                  await window.builderHelm.accounts.openLoginTerminal({
                    provider: provider.id,
                    configRoot: home.configRoot,
                    accountId: home.id,
                  });
                }}
              >
                Add login
              </button>
            </div>
            <ul className="usageAccountList">
              {provider.homes.map((home) => (
                <HomeRow
                  key={home.id}
                  home={home}
                  onActive={() =>
                    mutate.mutate({ type: 'active', provider: provider.id, id: home.id })
                  }
                  onRemove={() =>
                    mutate.mutate({ type: 'remove', provider: provider.id, id: home.id })
                  }
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="usageProviderCard usageHookCard">
        <div>
          <strong>Include the system Claude login</strong>
          <p>
            Installs a status line in ~/.claude so the login outside any isolated home
            reports its windows too.
          </p>
        </div>
        <button
          type="button"
          className={hookOn ? 'usageToggle usageToggleOn' : 'usageToggle'}
          aria-pressed={hookOn}
          disabled={mutate.isPending}
          onClick={() => mutate.mutate({ type: 'hook', enabled: !hookOn })}
        >
          {hookOn ? 'On' : 'Off'}
        </button>
      </div>
    </section>
  );
}

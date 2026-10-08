import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  AccountHome,
  AccountProvider,
  IsolatedLoginProviderId,
  QuotaProviderId,
  QuotaWindow,
} from '@builderhelm/protocol/accounts';
import { ISOLATED_LOGIN_PROVIDER_IDS } from '@builderhelm/protocol/accounts';

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

function isolatedId(id: QuotaProviderId): IsolatedLoginProviderId | null {
  return ISOLATED_LOGIN_PROVIDER_IDS.find((entry) => entry === id) ?? null;
}

function metersOf(provider: AccountProvider): readonly Meter[] {
  if (provider.id === 'opencode') return [];
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

const HOME_NOTE: Record<AccountHome['kind'], string> = {
  system: 'The login already on this device',
  managed: 'Isolated home created by BuilderHelm',
  attached: 'Your folder · removing it here never deletes it',
};

function HomeRow({
  home,
  disabled,
  onActive,
  onRemove,
  onRename,
}: {
  readonly home: AccountHome;
  readonly disabled: boolean;
  readonly onActive: () => void;
  readonly onRemove: () => void;
  readonly onRename: (label: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const system = home.kind === 'system';
  const pending = home.kind === 'managed' && home.email === null;
  const showEmail = home.email !== null && home.email !== home.label;
  const note = pending
    ? 'Waiting for the login to finish'
    : showEmail
      ? `${home.email} · ${HOME_NOTE[home.kind]}`
      : HOME_NOTE[home.kind];
  if (draft !== null) {
    const name = draft.trim();
    return (
      <li className="usageAccountRow">
        <form
          className="usageAccountRename"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.length === 0) return;
            onRename(name);
            setDraft(null);
          }}
        >
          <input
            aria-label={`Name for ${home.label}`}
            value={draft}
            maxLength={80}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDraft(null);
            }}
          />
          <div className="usageAccountActions">
            <button type="submit" disabled={disabled || name.length === 0}>
              Save
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="usageAccountRow">
      <div className="usageAccountId">
        <strong>{pending ? `${home.label} · signing in` : home.label}</strong>
        <p>{note}</p>
      </div>
      <div className="usageAccountActions">
        {home.active ? (
          <span className="usageBadge">Active</span>
        ) : (
          <button type="button" disabled={disabled} onClick={onActive}>
            Use
          </button>
        )}
        {system || pending ? null : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft(home.label)}
            aria-label={`Rename ${home.label}`}
          >
            Rename
          </button>
        )}
        {system ? null : (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${home.label}`}
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

const PROVIDER_NOTE: Record<QuotaProviderId, string> = {
  claude:
    'Subscription windows from the official usage endpoint (oauth source) or the in-session statusLine. Not an API invoice.',
  codex: 'Subscription windows from Codex app-server. Not token counts or API charges.',
  grok: 'Each account’s billing log. First read needs one session. Not an API invoice.',
  opencode:
    'OpenCode signs in to model providers itself (opencode auth login), so it has one login here and no subscription windows.',
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
        | { type: 'add'; provider: IsolatedLoginProviderId }
        | { type: 'attach'; provider: IsolatedLoginProviderId }
        | { type: 'rename'; provider: QuotaProviderId; id: string; label: string }
        | { type: 'remove'; provider: QuotaProviderId; id: string }
        | { type: 'active'; provider: QuotaProviderId; id: string }
        | { type: 'hook'; enabled: boolean }
        | { type: 'refresh' },
    ) => {
      if (action.type === 'add') {
        const created = await window.builderHelm.accounts.add({
          provider: action.provider,
        });
        queryClient.setQueryData(['accounts-snapshot'], created);
        const home = created.providers
          .find((entry) => entry.id === action.provider)
          ?.homes.find((entry) => entry.active && entry.kind === 'managed');
        if (home !== undefined) {
          await window.builderHelm.accounts.openLoginTerminal({
            provider: action.provider,
            accountId: home.id,
          });
        }
        return created;
      }
      if (action.type === 'attach')
        return window.builderHelm.accounts.attach({ provider: action.provider });
      if (action.type === 'rename') {
        return window.builderHelm.accounts.rename({
          provider: action.provider,
          id: action.id,
          label: action.label,
        });
      }
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
            Subscription windows for Claude, Codex, and Grok, and the CLI logins for them
            and OpenCode, on this Mac — not conversation token counts, not API invoices,
            not estimated API-equivalent cost. Those stay unknown unless a runtime reports
            them on a run. BuilderHelm login is under Settings →{' '}
            <Link to="/settings/accounts">Account</Link>.
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
      {(snapshot.data?.authConflicts ?? []).map((conflict) => (
        <p key={conflict.provider} className="wizardError" role="status">
          {conflict.provider}: {conflict.sources.length} credential sources (
          {conflict.sources.map((source) => source.path).join(', ')}). New runs use the
          Active home; running sessions keep the account they started with. Contents are
          not shown.
        </p>
      ))}
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
            {provider.id === 'opencode' ? null : (
              <div className="usageMeterGrid">
                {metersOf(provider).map((meter) => (
                  <MeterRow key={meter.key} meter={meter} />
                ))}
              </div>
            )}
            <div className="usageAccountHead">
              <span>CLI logins</span>
              {isolatedId(provider.id) === null ? null : (
                <span className="usageAccountHeadActions">
                  <button
                    type="button"
                    disabled={busy}
                    title="Use a folder you already signed in with, such as ~/.claude-work"
                    onClick={() => {
                      const id = isolatedId(provider.id);
                      if (id !== null) mutate.mutate({ type: 'attach', provider: id });
                    }}
                  >
                    Attach folder
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const id = isolatedId(provider.id);
                      if (id !== null) mutate.mutate({ type: 'add', provider: id });
                    }}
                  >
                    Add login
                  </button>
                </span>
              )}
            </div>
            <ul className="usageAccountList">
              {provider.homes.map((home) => (
                <HomeRow
                  key={home.id}
                  home={home}
                  disabled={busy}
                  onRename={(label) =>
                    mutate.mutate({
                      type: 'rename',
                      provider: provider.id,
                      id: home.id,
                      label,
                    })
                  }
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
          <strong>Include Claude logins BuilderHelm did not create</strong>
          <p>
            Installs a status line in ~/.claude and attached Claude folders so they report
            their windows too. Turning it off restores the status line each had.
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

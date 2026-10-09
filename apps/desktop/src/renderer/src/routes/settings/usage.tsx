import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  AccountHome,
  IsolatedLoginProviderId,
  QuotaProviderId,
} from '@builderhelm/protocol/accounts';
import { ISOLATED_LOGIN_PROVIDER_IDS } from '@builderhelm/protocol/accounts';

import { AgentGlyph } from '../../components/agent-mark.js';
import { LimitCards } from './usage-limits.js';
import { UsageHistory } from './usage-history.js';

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

function isolatedId(id: QuotaProviderId): IsolatedLoginProviderId | null {
  return ISOLATED_LOGIN_PROVIDER_IDS.find((entry) => entry === id) ?? null;
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
  onToggleDisabled,
}: {
  readonly home: AccountHome;
  readonly disabled: boolean;
  readonly onActive: () => void;
  readonly onRemove: () => void;
  readonly onRename: (label: string) => void;
  readonly onToggleDisabled: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const system = home.kind === 'system';
  const pending = home.kind === 'managed' && home.email === null;
  const showEmail = home.email !== null && home.email !== home.label;
  const note = home.disabled
    ? 'Disabled · history kept, cannot start runs'
    : pending
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
        ) : home.disabled ? null : (
          <button type="button" disabled={disabled} onClick={onActive}>
            Use
          </button>
        )}
        {system || pending ? null : (
          <button type="button" disabled={disabled} onClick={onToggleDisabled}>
            {home.disabled ? 'Enable' : 'Disable'}
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
    'Each login’s session and weekly windows, from Claude Code’s statusLine while a session runs in it. Not an API invoice.',
  codex:
    'Each login’s windows from Codex app-server, read on Refresh. Not token counts or API charges.',
  grok: 'Each account’s billing log. First read needs one session. Not an API invoice.',
  opencode:
    'OpenCode signs in to model providers itself (opencode auth login), so it has one login here and no subscription windows.',
};

function LimitsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    // Live: opening the page asks each login for fresh limits. Core rate-limits
    // the reads per login, so the 30s poll does not respawn Codex each time.
    queryFn: () => window.builderHelm.accounts.snapshot({ live: true }),
    refetchInterval: 30_000,
  });
  const mutate = useMutation({
    mutationFn: async (
      action:
        | { type: 'add'; provider: IsolatedLoginProviderId }
        | { type: 'attach'; provider: IsolatedLoginProviderId }
        | { type: 'rename'; provider: QuotaProviderId; id: string; label: string }
        | { type: 'remove'; provider: QuotaProviderId; id: string }
        | { type: 'disable'; provider: QuotaProviderId; id: string; disabled: boolean }
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
      if (action.type === 'disable') {
        return window.builderHelm.accounts.setDisabled({
          provider: action.provider,
          id: action.id,
          disabled: action.disabled,
        });
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
          <h1 id="usage-title">Limits</h1>
          <p>
            Current provider-reported windows for each account on this device. Each pool
            is the mean remaining percentage of the distinct accounts reporting that
            window. Choose logins manually; a pool does not route turns. BuilderHelm login
            is under Settings → <Link to="/settings/accounts">Account</Link>.
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
        <details key={conflict.provider} className="usageSourceLocations">
          <summary>
            {conflict.provider}: {conflict.sources.length} login configuration locations
          </summary>
          <p>
            {conflict.provider}: {conflict.sources.length} credential sources (
            {conflict.sources.map((source) => source.path).join(', ')}). New runs use the
            Active home; running sessions keep the account they started with. Contents are
            not shown.
          </p>
        </details>
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
            <LimitCards provider={provider} />
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
                  onToggleDisabled={() =>
                    mutate.mutate({
                      type: 'disable',
                      provider: provider.id,
                      id: home.id,
                      disabled: !home.disabled,
                    })
                  }
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

export function UsagePage(): React.JSX.Element {
  const [view, setView] = useState<'cost' | 'tokens' | 'limits'>('cost');
  return (
    <div className="usageViews">
      <nav className="usageTabs" aria-label="Usage views">
        {(['cost', 'tokens', 'limits'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      {view === 'limits' ? <LimitsPage /> : <UsageHistory view={view} />}
    </div>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountHome,
  AccountProvider,
  AccountQuota,
  QuotaProviderId,
  QuotaWindow,
} from '@builderhelm/protocol/accounts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { AgentGlyph } from './agent-mark.js';

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

function formatAgo(iso: string | null): string | null {
  if (iso === null) return null;
  const stamp = new Date(iso).getTime();
  if (Number.isNaN(stamp)) return null;
  const minutes = Math.floor(Math.max(0, Date.now() - stamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function windowLabel(window: QuotaWindow | null): string | null {
  if (window === null) return null;
  const reset = formatReset(window.resetsAt);
  const used = `${Math.round(window.usedPercent)}% used`;
  return reset === null ? used : `${used} ${reset}`;
}

function chipText(provider: AccountProvider): string {
  const quota = provider.quota;
  if (quota !== null) {
    const parts = [windowLabel(quota.fiveHour), windowLabel(quota.sevenDay)].filter(
      (value): value is string => value !== null,
    );
    if (parts.length > 0) return parts.join(' · ');
  }
  // Grok: usage is per-home billing, not windowed quota. Show the active home,
  // else the highest of the signed-in homes.
  const withBilling = provider.homes.filter((home) => home.billing !== null);
  const home = withBilling.find((entry) => entry.active) ?? withBilling[0];
  if (home?.billing === undefined || home.billing === null) return '—';
  const reset = formatReset(home.billing.periodEnd);
  const used = `${Math.round(home.billing.usedPercent)}% used`;
  return reset === null ? used : `${used} ${reset}`;
}

function hottest(quota: AccountQuota | null): number | null {
  if (quota === null) return null;
  const values = [quota.fiveHour?.usedPercent, quota.sevenDay?.usedPercent].filter(
    (value): value is number => typeof value === 'number',
  );
  if (values.length === 0) return null;
  return Math.max(...values);
}

/** One usage meter: a window for Claude/Codex, a signed-in home for Grok. */
type UsageSection = {
  readonly key: string;
  readonly title: string;
  readonly short: string;
  /** null until the provider has reported this meter at least once. */
  readonly window: QuotaWindow | null;
};

/** Active account first, so both the row summary and the flyout lead with it. */
function activeFirst(provider: AccountProvider): readonly AccountHome[] {
  return [...provider.homes].sort((a, b) => Number(b.active) - Number(a.active));
}

function sectionsOf(provider: AccountProvider): readonly UsageSection[] {
  if (provider.id === 'grok') {
    // A just-signed-in home has no billing entry until its first session, and
    // hiding it made a finished login look like it never happened.
    return activeFirst(provider).flatMap((home) =>
      home.email === null && home.billing === null
        ? []
        : [
            {
              key: home.id,
              title: home.email ?? home.label,
              short: 'wk',
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
  if (quota === null) return [];
  const out: UsageSection[] = [];
  if (quota.fiveHour !== null) {
    out.push({ key: '5h', title: 'Session', short: '5h', window: quota.fiveHour });
  }
  if (quota.sevenDay !== null) {
    out.push({ key: 'wk', title: 'Weekly', short: 'wk', window: quota.sevenDay });
  }
  return out;
}

function lastUpdated(provider: AccountProvider): string | null {
  if (provider.id === 'grok') {
    const stamps = provider.homes
      .flatMap((home) => (home.billing === null ? [] : [home.billing.fetchedAt]))
      .filter((value): value is string => value !== null)
      .sort();
    return stamps.at(-1) ?? null;
  }
  return provider.quota?.occurredAt ?? null;
}

function rowStatus(provider: AccountProvider, sections: readonly UsageSection[]): string {
  if (sections.length === 0) return `Run ${provider.label} to refresh`;
  const reset = sections
    .map((section) => section.window?.resetsAt ?? null)
    .find((value): value is string => value !== null);
  const formatted = formatReset(reset ?? null);
  if (formatted !== null) return `Resets in ${formatted}`;
  return sections.every((section) => section.window === null)
    ? `Run ${provider.label} to refresh`
    : 'No reset reported';
}

function MiniBar({
  short,
  window,
}: {
  readonly short: string;
  readonly window: QuotaWindow;
}): React.JSX.Element {
  const hot = window.usedPercent >= 90;
  return (
    <span className="usageMini">
      <span className="usageMiniLabel">{short}</span>
      <span className="usageMiniTrack" aria-hidden="true">
        <span
          className={hot ? 'usageMiniFill usageFillHot' : 'usageMiniFill'}
          style={{ width: `${Math.max(2, Math.min(100, window.usedPercent))}%` }}
        />
      </span>
      <span className={hot ? 'usageHot' : 'usageMiniValue'}>
        {Math.round(window.usedPercent)}%
      </span>
    </span>
  );
}

function ProviderFlyout({
  provider,
  sections,
  onAccounts,
  onStay,
  onLeave,
}: {
  readonly provider: AccountProvider;
  readonly sections: readonly UsageSection[];
  readonly onAccounts: () => void;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}): React.JSX.Element {
  const ago = formatAgo(lastUpdated(provider));
  const active = activeFirst(provider)[0];
  return (
    <div
      className="usageFlyout"
      role="group"
      aria-label={`${provider.label} usage`}
      onMouseEnter={onStay}
      onMouseLeave={onLeave}
    >
      <div className="usageFlyoutHead">
        <span className="usageRowMark" aria-hidden="true">
          <AgentGlyph id={provider.id} />
        </span>
        <strong>{provider.label}</strong>
      </div>
      <p className="usageFlyoutAgo">
        {ago === null ? 'No usage reported yet' : `Updated ${ago}`}
      </p>
      <div className="usageFlyoutBody">
        {sections.length === 0 ? (
          <p className="usageMeta">
            Run {provider.label} once in a pane; it then reports its own limits.
          </p>
        ) : (
          sections.map((section) => {
            const meter = section.window;
            if (meter === null) {
              return (
                <div key={section.key} className="usageFlyoutWindow">
                  <span className="usageFlyoutTitle">{section.title}</span>
                  <span className="usageTrack" aria-hidden="true" />
                  <span className="usageFlyoutFoot">
                    <span className="usageMeta">Signed in · no usage reported yet</span>
                  </span>
                </div>
              );
            }
            const reset = formatReset(meter.resetsAt);
            const hot = meter.usedPercent >= 90;
            return (
              <div key={section.key} className="usageFlyoutWindow">
                <span className="usageFlyoutTitle">{section.title}</span>
                <span className="usageTrack" aria-hidden="true">
                  <span
                    className={hot ? 'usageFill usageFillHot' : 'usageFill'}
                    style={{
                      width: `${Math.max(2, Math.min(100, meter.usedPercent))}%`,
                    }}
                  />
                </span>
                <span className="usageFlyoutFoot">
                  <span className={hot ? 'usageHot' : undefined}>
                    {Math.round(meter.usedPercent)}% used
                  </span>
                  <span className="usageMeta">
                    {reset === null ? '' : `Resets in ${reset}`}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
      <span className="usageFlyoutSection">{provider.label} Account</span>
      <button type="button" className="usageFootRow" onClick={onAccounts}>
        <span className="usageFootLabel">
          {active?.email ?? active?.label ?? 'Not signed in'}
        </span>
        <span className="usageChevron" aria-hidden="true">
          ›
        </span>
      </button>
      <button type="button" className="usageFootRow" onClick={onAccounts}>
        <span className="usageFootLabel">Manage Accounts…</span>
      </button>
    </div>
  );
}

export function UsageBar(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'compact' | 'detailed'>('detailed');
  const [flyout, setFlyout] = useState<QuotaProviderId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Set while the panel was opened by hover, so leaving closes it again. */
  const hoverOpened = useRef(false);
  const timer = useRef<number | null>(null);
  /** Separate from the open timer: the panel and its detail hide on their own. */
  const flyoutTimer = useRef<number | null>(null);
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    queryFn: () => window.builderHelm.accounts.snapshot({ live: true }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        // Otherwise the next open shows a detail for a provider the pointer
        // is nowhere near.
        setFlyout(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(
    () => () => {
      clearTimer();
      clearFlyoutTimer();
    },
    [],
  );

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const clearFlyoutTimer = (): void => {
    if (flyoutTimer.current !== null) {
      window.clearTimeout(flyoutTimer.current);
      flyoutTimer.current = null;
    }
  };

  /**
   * The detail panel belongs to whatever the pointer is on: a provider chip, a
   * provider row, or the panel itself. Anything else hides it.
   */
  const showFlyout = (id: QuotaProviderId): void => {
    clearFlyoutTimer();
    setFlyout(id);
  };

  /** Short grace so moving diagonally onto the panel does not drop it. */
  const hideFlyout = (): void => {
    clearFlyoutTimer();
    flyoutTimer.current = window.setTimeout(() => {
      flyoutTimer.current = null;
      setFlyout(null);
    }, 140);
  };

  /**
   * Opening on hover needs a moment of intent: the bar sits on the bottom edge
   * and the pointer crosses it on the way elsewhere.
   */
  const hoverOpen = (id: QuotaProviderId): void => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      hoverOpened.current = true;
      showFlyout(id);
      setOpen(true);
    }, 220);
  };

  const hoverLeave = (): void => {
    clearTimer();
    if (!hoverOpened.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      hoverOpened.current = false;
      setOpen(false);
      setFlyout(null);
    }, 260);
  };

  const providers = snapshot.data?.providers ?? [];
  const openAccounts = (): void => {
    clearTimer();
    hoverOpened.current = false;
    setOpen(false);
    setFlyout(null);
    void navigate({ to: '/settings/usage' });
  };
  const refresh = (): void => {
    void window.builderHelm.accounts.snapshot({ live: true }).then((next) => {
      queryClient.setQueryData(['accounts-snapshot'], next);
    });
  };

  return (
    <div className="usageBar" ref={rootRef} onMouseLeave={hoverLeave}>
      <button
        type="button"
        className="usageBarMain"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          clearTimer();
          hoverOpened.current = false;
          setOpen((value) => {
            if (value) setFlyout(null);
            return !value;
          });
        }}
      >
        {providers.map((provider) => {
          const peak = hottest(provider.quota);
          return (
            <span
              key={provider.id}
              className="usageChip"
              // Hovering a chip reveals that provider's panel without a click.
              onMouseEnter={() => {
                if (open) {
                  showFlyout(provider.id);
                  return;
                }
                hoverOpen(provider.id);
              }}
              onMouseLeave={hideFlyout}
            >
              <span className="usageChipMark" aria-hidden="true">
                <AgentGlyph id={provider.id} />
              </span>
              <span className={peak !== null && peak >= 90 ? 'usageHot' : undefined}>
                {chipText(provider)}
              </span>
            </span>
          );
        })}
      </button>
      <button
        type="button"
        className="usageBarRefresh"
        title="Refresh usage"
        disabled={snapshot.isFetching}
        onClick={(event) => {
          event.stopPropagation();
          refresh();
        }}
      >
        ↻
      </button>
      {open ? (
        <div
          className="usagePopover"
          role="dialog"
          aria-label="Usage"
          // Reading the panel counts as staying, so a hover-open stays open.
          onMouseEnter={clearTimer}
        >
          <header className="usagePopoverHead">
            <strong>Usage</strong>
            <span className="usagePopoverHeadEnd">
              <span className="usageMeta">all agents</span>
              <button
                type="button"
                className={snapshot.isFetching ? 'usageSpin' : undefined}
                title="Refresh usage"
                disabled={snapshot.isFetching}
                onClick={refresh}
              >
                ↻
              </button>
            </span>
          </header>
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
          <ul className="usagePopoverList">
            {providers.map((provider) => {
              const sections = sectionsOf(provider);
              const on = flyout === provider.id;
              return (
                <li
                  key={provider.id}
                  onMouseEnter={() => showFlyout(provider.id)}
                  onMouseLeave={hideFlyout}
                >
                  <button
                    type="button"
                    className={on ? 'usageRow usageRowOn' : 'usageRow'}
                    aria-expanded={on}
                    // Keyboard users get the same detail on focus.
                    onFocus={() => showFlyout(provider.id)}
                    onBlur={hideFlyout}
                    onClick={() => showFlyout(provider.id)}
                  >
                    <span className="usageRowMark" aria-hidden="true">
                      <AgentGlyph id={provider.id} />
                    </span>
                    <span className="usageRowBody">
                      <span className="usageRowHead">
                        <strong>{provider.label}</strong>
                        <span className="usageMeta">{rowStatus(provider, sections)}</span>
                      </span>
                      {mode === 'detailed' && sections.length > 0 ? (
                        <span className="usageRowBars">
                          {sections
                            .flatMap((section) =>
                              section.window === null
                                ? []
                                : [{ ...section, meter: section.window }],
                            )
                            .slice(0, 2)
                            .map((section) => (
                              <MiniBar
                                key={section.key}
                                short={section.short}
                                window={section.meter}
                              />
                            ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="usageChevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="usageFootRow" onClick={openAccounts}>
            <span className="usageFootLabel">Usage details &amp; history</span>
            <span className="usageChevron" aria-hidden="true">
              ›
            </span>
          </button>
          <button type="button" className="usageFootRow" onClick={openAccounts}>
            <span className="usageFootLabel">Manage Accounts…</span>
            <span className="usageChevron" aria-hidden="true">
              ›
            </span>
          </button>
          {(() => {
            const provider = providers.find((entry) => entry.id === flyout);
            if (provider === undefined) return null;
            return (
              <ProviderFlyout
                provider={provider}
                sections={sectionsOf(provider)}
                onAccounts={openAccounts}
                onStay={clearFlyoutTimer}
                onLeave={hideFlyout}
              />
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}

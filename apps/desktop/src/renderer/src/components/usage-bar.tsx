import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountProvider,
  AccountQuota,
  QuotaWindow,
} from '@builderhelm/protocol/accounts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

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

function windowLabel(window: QuotaWindow | null): string | null {
  if (window === null) return null;
  const reset = formatReset(window.resetsAt);
  const used = `${Math.round(window.usedPercent)}% used`;
  return reset === null ? used : `${used} ${reset}`;
}

function chipText(provider: AccountProvider): string {
  const quota = provider.quota;
  if (quota === null) return '—';
  const five = windowLabel(quota.fiveHour);
  const week = windowLabel(quota.sevenDay);
  if (five !== null && week !== null) return `${five} · ${week}`;
  return five ?? week ?? '—';
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
          {Math.round(window.usedPercent)}%{reset !== null ? ` · ${reset}` : ''}
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

function hottest(quota: AccountQuota | null): number | null {
  if (quota === null) return null;
  const values = [quota.fiveHour?.usedPercent, quota.sevenDay?.usedPercent].filter(
    (value): value is number => typeof value === 'number',
  );
  if (values.length === 0) return null;
  return Math.max(...values);
}

export function UsageBar(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'compact' | 'detailed'>('compact');
  const rootRef = useRef<HTMLDivElement>(null);
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    queryFn: () => window.builderHelm.accounts.snapshot(),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const providers = snapshot.data?.providers ?? [];

  return (
    <div className="usageBar" ref={rootRef}>
      <button
        type="button"
        className="usageBarMain"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {providers.map((provider) => {
          const peak = hottest(provider.quota);
          return (
            <span key={provider.id} className="usageChip">
              <span className="usageChipMark" aria-hidden="true">
                {provider.label.slice(0, 1)}
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
        title="Refresh Codex windows"
        disabled={snapshot.isFetching}
        onClick={(event) => {
          event.stopPropagation();
          void window.builderHelm.accounts.snapshot({ live: true }).then((next) => {
            queryClient.setQueryData(['accounts-snapshot'], next);
          });
        }}
      >
        ↻
      </button>
      {open ? (
        <div className="usagePopover" role="dialog" aria-label="Usage">
          <header className="usagePopoverHead">
            <strong>Usage</strong>
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
          </header>
          <ul className="usagePopoverList">
            {providers.map((provider) => {
              const reset =
                formatReset(provider.quota?.fiveHour?.resetsAt ?? null) ??
                formatReset(provider.quota?.sevenDay?.resetsAt ?? null);
              return (
                <li key={provider.id}>
                  <div className="usagePopoverId">
                    <strong>{provider.label}</strong>
                    {reset !== null ? <span>Resets in {reset}</span> : null}
                  </div>
                  {mode === 'detailed' ? (
                    <div className="usageDetail">
                      <QuotaBar label="5h" window={provider.quota?.fiveHour ?? null} />
                      <QuotaBar
                        label="Weekly"
                        window={provider.quota?.sevenDay ?? null}
                      />
                    </div>
                  ) : (
                    <span className="usageMeta">{chipText(provider)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="usageManage"
            onClick={() => {
              setOpen(false);
              void navigate({ to: '/settings/usage' });
            }}
          >
            Manage Accounts…
          </button>
        </div>
      ) : null}
    </div>
  );
}

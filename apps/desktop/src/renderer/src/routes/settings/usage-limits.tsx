import type {
  AccountHome,
  AccountProvider,
  QuotaWindow,
} from '@builderhelm/protocol/accounts';

function formatAge(iso: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function formatReset(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  if (ms <= 0) return 'reset passed';
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  const days = Math.floor(hours / 24);
  const hoursLeft = hours % 24;
  return hoursLeft === 0 ? `${days}d` : `${days}d ${hoursLeft}h`;
}

interface Segment {
  readonly key: string;
  readonly label: string;
  readonly window: QuotaWindow | null;
  readonly credits: number;
  /** When the figures were reported, if they are older than they should be. */
  readonly staleSince: string | null;
}

interface LimitCard {
  readonly id: string;
  readonly title: string;
  readonly segments: readonly Segment[];
}

interface Pool {
  readonly left: number;
  /** Share of the whole pool the soonest reset gives back, and when. */
  readonly next: { readonly gain: number; readonly resetsAt: string } | null;
}

const KIND_ORDER: Record<QuotaWindow['kind'], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

/**
 * The provider's distinct accounts: a home still signing in is left out, and
 * logins that share an account key (one account attached through two
 * folders) appear once, using the most recent reading.
 */
export function distinctAccounts(provider: AccountProvider): readonly AccountHome[] {
  const byAccount = new Map<string, AccountHome>();
  for (const home of provider.homes) {
    if (home.kind === 'managed' && home.email === null) continue;
    const key = home.accountKey ?? `home:${home.id}`;
    const current = byAccount.get(key);
    const newer =
      current === undefined ||
      (home.quota !== null &&
        (current.quota === null || home.quota.occurredAt > current.quota.occurredAt));
    if (newer) byAccount.set(key, home);
  }
  return [...byAccount.values()];
}

/** One card per window id; each distinct account is a segment in it. */
export function limitCards(provider: AccountProvider): readonly LimitCard[] {
  const accounts = distinctAccounts(provider);
  const windows = new Map<string, QuotaWindow>();
  for (const home of accounts) {
    for (const window of home.quota?.windows ?? []) {
      if (!windows.has(window.id)) windows.set(window.id, window);
    }
  }
  return [...windows.values()]
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        Number(a.scope !== null) - Number(b.scope !== null) ||
        a.label.localeCompare(b.label),
    )
    .map((sample) => ({
      id: sample.id,
      title: sample.label,
      segments: accounts.map((home) => ({
        key: home.id,
        label: home.disabled ? `${home.label} · disabled` : home.label,
        window: home.quota?.windows.find((window) => window.id === sample.id) ?? null,
        credits: home.quota?.resetCreditsAvailable ?? 0,
        staleSince:
          home.limits.state === 'stale' ? (home.quota?.occurredAt ?? null) : null,
      })),
    }));
}

/**
 * A visual summary of distinct accounts, not one combined quota: the mean of
 * the remaining percentage of each account that reported this window.
 * Accounts with no figures are left out rather than counted as full. The
 * soonest reset's gain is that account's used share divided by the number of
 * reporting accounts. A turn still runs on the login you picked; nothing
 * routes work to the account with the most left.
 */
export function poolOf(segments: readonly Segment[]): Pool | null {
  const known = segments.flatMap((segment) =>
    segment.window === null ? [] : [segment.window],
  );
  if (known.length === 0) return null;
  const left =
    known.reduce((sum, window) => sum + (100 - window.usedPercent), 0) / known.length;
  const now = Date.now();
  const upcoming = known
    .filter(
      (window) =>
        window.usedPercent > 0 &&
        window.resetsAt !== null &&
        new Date(window.resetsAt).getTime() > now,
    )
    .sort(
      (a, b) => new Date(a.resetsAt ?? 0).getTime() - new Date(b.resetsAt ?? 0).getTime(),
    )[0];
  return {
    left,
    next:
      upcoming?.resetsAt === undefined || upcoming.resetsAt === null
        ? null
        : { gain: upcoming.usedPercent / known.length, resetsAt: upcoming.resetsAt },
  };
}

function SegmentBar({ segment }: { readonly segment: Segment }): React.JSX.Element {
  const window = segment.window;
  if (window === null) {
    return (
      <div className="limitSegment limitSegmentEmpty" title="No figures reported yet">
        <span className="limitSegmentText">
          <span className="limitSegmentName">{segment.label}</span>
          <span className="limitSegmentValue">No data</span>
        </span>
      </div>
    );
  }
  const left = Math.max(0, Math.min(100, 100 - window.usedPercent));
  const reset = formatReset(window.resetsAt);
  return (
    <div
      className={
        segment.staleSince === null ? 'limitSegment' : 'limitSegment limitSegmentStale'
      }
      title={`${segment.label}: ${Math.round(left)}% left`}
      role="img"
      aria-label={`${segment.label} ${Math.round(left)}% left${reset === null ? '' : `, resets in ${reset}`}`}
    >
      <span className="limitSegmentFill" style={{ width: `${left}%` }} />
      <span className="limitSegmentText">
        <span className="limitSegmentName">{segment.label}</span>
        <span className="limitSegmentValue">{Math.round(left)}%</span>
      </span>
      <span className="limitSegmentReset">
        {reset === null ? '—' : `↻ ${reset}`}
        {segment.staleSince === null ? '' : ` · as of ${formatAge(segment.staleSince)}`}
        {segment.credits > 0
          ? ` · ${segment.credits} reset credit${segment.credits === 1 ? '' : 's'}`
          : ''}
      </span>
    </div>
  );
}

/** Accounts that cannot show limits, each with the reason. */
function LimitIssues({
  provider,
}: {
  readonly provider: AccountProvider;
}): React.JSX.Element | null {
  const issues = distinctAccounts(provider).filter(
    (home) => home.limits.state !== 'ok' && home.limits.message !== null,
  );
  if (issues.length === 0) return null;
  return (
    <ul className="limitIssues">
      {issues.map((home) => (
        <li
          key={home.id}
          className={home.limits.state === 'error' ? 'limitIssueError' : undefined}
        >
          <strong>{home.label}</strong> {home.limits.message}
        </li>
      ))}
    </ul>
  );
}

export function LimitCards({
  provider,
}: {
  readonly provider: AccountProvider;
}): React.JSX.Element | null {
  const cards = limitCards(provider);
  return (
    <div className={`limitCards limitTone-${provider.id}`}>
      {cards.map((card) => {
        const pool = poolOf(card.segments);
        const next = pool?.next ?? null;
        return (
          <section key={card.id} className="limitCard" aria-label={card.title}>
            <div className="limitSummary">
              <span className="limitTitle">{card.title}</span>
              <span className="limitLeft">
                <strong>{pool === null ? '—' : `${Math.round(pool.left)}%`}</strong> left
              </span>
              {next === null || Math.round(next.gain) === 0 ? null : (
                <span className="limitNext">
                  ↻ +{Math.round(next.gain)}% in {formatReset(next.resetsAt)}
                </span>
              )}
            </div>
            <div className="limitSegments">
              {card.segments.map((segment) => (
                <SegmentBar key={segment.key} segment={segment} />
              ))}
            </div>
          </section>
        );
      })}
      <LimitIssues provider={provider} />
    </div>
  );
}

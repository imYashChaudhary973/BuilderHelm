import type {
  AccountHome,
  AccountProvider,
  QuotaWindow,
} from '@builderhelm/protocol/accounts';

export function formatReset(iso: string | null): string | null {
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

interface Segment {
  readonly key: string;
  readonly label: string;
  readonly window: QuotaWindow | null;
  readonly credits: number;
}

interface LimitCard {
  readonly title: string;
  readonly segments: readonly Segment[];
}

interface Pool {
  readonly left: number;
  /** Share of the whole pool the soonest reset gives back, and when. */
  readonly next: { readonly gain: number; readonly resetsAt: string } | null;
}

/** Logins that can report: everything except a home still signing in. */
function reporting(provider: AccountProvider): readonly AccountHome[] {
  return provider.homes.filter((home) => home.kind !== 'managed' || home.email !== null);
}

export function limitCards(provider: AccountProvider): readonly LimitCard[] {
  const homes = reporting(provider);
  if (provider.id === 'opencode') return [];
  if (provider.id === 'grok') {
    return [
      {
        title: 'Credits',
        segments: homes.map((home) => ({
          key: home.id,
          label: home.label,
          credits: 0,
          window:
            home.billing === null
              ? null
              : {
                  usedPercent: home.billing.usedPercent,
                  resetsAt: home.billing.periodEnd,
                },
        })),
      },
    ];
  }
  const card = (title: string, pick: 'fiveHour' | 'sevenDay'): LimitCard => ({
    title,
    segments: homes.map((home) => ({
      key: home.id,
      label: home.label,
      window: home.quota?.[pick] ?? null,
      credits: home.quota?.resetCreditsAvailable ?? 0,
    })),
  });
  return [card('Session', 'fiveHour'), card('Weekly', 'sevenDay')];
}

/**
 * Pooled headroom across the logins that reported: the mean of what each has
 * left. Logins with no figures are left out rather than counted as full.
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
      className="limitSegment"
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
        {segment.credits > 0
          ? ` · ${segment.credits} reset credit${segment.credits === 1 ? '' : 's'}`
          : ''}
      </span>
    </div>
  );
}

export function LimitCards({
  provider,
  emptyNote,
}: {
  readonly provider: AccountProvider;
  readonly emptyNote: string;
}): React.JSX.Element | null {
  const cards = limitCards(provider);
  if (cards.length === 0) return null;
  if (cards.every((card) => poolOf(card.segments) === null)) {
    return <p className="limitEmpty">{emptyNote}</p>;
  }
  return (
    <div className={`limitCards limitTone-${provider.id}`}>
      {cards.map((card) => {
        const pool = poolOf(card.segments);
        const next = pool?.next ?? null;
        return (
          <section key={card.title} className="limitCard" aria-label={card.title}>
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
    </div>
  );
}

import type { AccountQuota, QuotaWindow } from '@builderhelm/protocol';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function toIso(resetsAt: unknown): string | null {
  if (typeof resetsAt === 'string' && resetsAt.trim().length > 0) {
    const parsed = new Date(resetsAt);
    return Number.isNaN(parsed.getTime()) ? resetsAt.trim() : parsed.toISOString();
  }
  const n = finiteNumber(resetsAt);
  if (n === undefined) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function usedOf(value: unknown): { used: number; resetsAt: string | null } | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const used =
    finiteNumber(raw.used_percentage) ??
    finiteNumber(raw.usedPercent) ??
    finiteNumber(raw.utilization);
  if (used === undefined) return null;
  return { used: clampPercent(used), resetsAt: toIso(raw.resets_at ?? raw.resetsAt) };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const CLAUDE_SESSION_KEYS = ['five_hour', 'fiveHour', 'current_session'];
const CLAUDE_WEEKLY_KEYS = [
  'seven_day',
  'sevenDay',
  'seven_day_all_models',
  'weekly_limit',
  'weekly',
];

/**
 * Claude Code statusLine JSON. Field names have drifted across versions:
 * five_hour/seven_day, current_session/weekly_limit, and per-model
 * seven_day_<model> rows. Account-wide names map to `session` and `weekly`
 * (the highest reading wins when several aliases appear); each per-model
 * weekly row keeps its own `weekly:<model>` window.
 */
export function parseClaudeRateLimits(
  payload: unknown,
  occurredAt: string,
): AccountQuota | null {
  const root =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  if (root === null) return null;
  const rateLimits =
    typeof root.rate_limits === 'object' && root.rate_limits !== null
      ? (root.rate_limits as Record<string, unknown>)
      : root;
  const windows = new Map<string, QuotaWindow>();
  const keep = (window: QuotaWindow): void => {
    const current = windows.get(window.id);
    if (current === undefined || window.usedPercent > current.usedPercent) {
      windows.set(window.id, window);
    }
  };
  for (const [key, value] of Object.entries(rateLimits)) {
    const reading = usedOf(value);
    if (reading === null) continue;
    const base = { usedPercent: reading.used, resetsAt: reading.resetsAt };
    if (CLAUDE_SESSION_KEYS.includes(key)) {
      keep({ id: 'session', label: 'Session', kind: 'session', scope: null, ...base });
    } else if (CLAUDE_WEEKLY_KEYS.includes(key)) {
      keep({ id: 'weekly', label: 'Weekly', kind: 'weekly', scope: null, ...base });
    } else {
      const model = /^seven_day_([a-z0-9]+)$/i.exec(key)?.[1];
      if (model !== undefined) {
        keep({
          id: `weekly:${model.toLowerCase()}`.slice(0, 64),
          label: `Weekly · ${titleCase(model)}`.slice(0, 80),
          kind: 'weekly',
          scope: titleCase(model).slice(0, 80),
          ...base,
        });
      } else {
        const label = titleCase(key.replace(/_/g, ' ')).slice(0, 80);
        keep({
          id: `other:${key}`.slice(0, 64),
          label,
          kind: 'other',
          scope: null,
          ...base,
        });
      }
    }
  }
  if (windows.size === 0) return null;
  return {
    windows: [...windows.values()].slice(0, 16),
    source: 'statusline',
    occurredAt,
    plan: null,
  };
}

/**
 * A Codex window is named by its length, not its slot: Codex has reported a
 * lone weekly window as `primary`, which a slot-based reading would call the
 * session.
 */
function codexWindow(value: unknown, scope: string | null): QuotaWindow | null {
  const reading = usedOf(value);
  if (reading === null) return null;
  const minutes = finiteNumber((value as Record<string, unknown>).windowDurationMins);
  let kind: QuotaWindow['kind'] = 'other';
  let label = 'Limit';
  if (minutes !== undefined && minutes <= 24 * 60) {
    kind = 'session';
    label = minutes === 300 ? 'Session' : `${Math.round(minutes / 60)}-hour`;
  } else if (minutes !== undefined && minutes >= 6 * 1440 && minutes <= 8 * 1440) {
    kind = 'weekly';
    label = 'Weekly';
  } else if (minutes !== undefined && minutes >= 27 * 1440) {
    kind = 'monthly';
    label = 'Monthly';
  } else if (minutes !== undefined) {
    label = `${Math.round(minutes / 1440)}-day`;
  }
  const base = kind === 'other' ? `other:${minutes ?? 'unknown'}` : kind;
  return {
    id: (scope === null ? base : `${base}:${scope.toLowerCase()}`).slice(0, 64),
    label: (scope === null ? label : `${label} · ${scope}`).slice(0, 80),
    kind,
    scope,
    usedPercent: reading.used,
    resetsAt: reading.resetsAt,
  };
}

/** Codex app-server account/rateLimits/read result. */
export function parseCodexRateLimits(
  payload: unknown,
  occurredAt: string,
): AccountQuota | null {
  const root =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  if (root === null) return null;
  const result =
    typeof root.result === 'object' && root.result !== null
      ? (root.result as Record<string, unknown>)
      : root;
  const buckets =
    typeof result.rateLimitsByLimitId === 'object' && result.rateLimitsByLimitId !== null
      ? Object.values(result.rateLimitsByLimitId as Record<string, unknown>)
      : [result.rateLimits ?? result];
  const windows: QuotaWindow[] = [];
  let plan: string | null = null;
  for (const bucket of buckets) {
    if (typeof bucket !== 'object' || bucket === null) continue;
    const row = bucket as Record<string, unknown>;
    const limitId = typeof row.limitId === 'string' ? row.limitId : 'codex';
    const name =
      typeof row.limitName === 'string' && row.limitName.length > 0
        ? row.limitName
        : null;
    // The default `codex` bucket is the account-wide limit.
    const scope = limitId === 'codex' ? null : (name ?? limitId).slice(0, 80);
    if (typeof row.planType === 'string' && row.planType.length > 0) plan = row.planType;
    for (const slot of [row.primary, row.secondary]) {
      const window = codexWindow(slot, scope);
      if (window !== null && !windows.some((entry) => entry.id === window.id)) {
        windows.push(window);
      }
    }
  }
  if (windows.length === 0) return null;
  const credits = result.rateLimitResetCredits;
  const available =
    typeof credits === 'object' && credits !== null
      ? finiteNumber((credits as Record<string, unknown>).availableCount)
      : undefined;
  return {
    windows: windows.slice(0, 16),
    source: 'app-server',
    occurredAt,
    plan: plan?.slice(0, 80) ?? null,
    ...(available !== undefined
      ? { resetCreditsAvailable: Math.max(0, Math.round(available)) }
      : {}),
  };
}

export function formatQuotaLine(quota: AccountQuota): string {
  const short: Record<QuotaWindow['kind'], string> = {
    session: '5h',
    weekly: 'wk',
    monthly: 'mo',
    other: '',
  };
  return quota.windows
    .filter((window) => window.scope === null && window.kind !== 'other')
    .map((window) => `${Math.round(window.usedPercent)}% ${short[window.kind]}`)
    .join(' · ');
}

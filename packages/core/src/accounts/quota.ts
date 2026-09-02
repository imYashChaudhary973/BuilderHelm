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

function parseClaudeWindow(value: unknown): QuotaWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const used =
    finiteNumber(raw.used_percentage) ??
    finiteNumber(raw.usedPercent) ??
    finiteNumber(raw.utilization);
  if (used === undefined) return null;
  return {
    usedPercent: clampPercent(used),
    resetsAt: toIso(raw.resets_at ?? raw.resetsAt),
  };
}

function parseCodexWindow(value: unknown): QuotaWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const used = finiteNumber(raw.usedPercent) ?? finiteNumber(raw.used_percentage);
  if (used === undefined) return null;
  return {
    usedPercent: clampPercent(used),
    resetsAt: toIso(raw.resetsAt ?? raw.resets_at),
  };
}

function windowMinutes(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return finiteNumber((value as Record<string, unknown>).windowDurationMins);
}

/** Claude Code statusLine JSON: rate_limits.five_hour / seven_day. */
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
  const fiveHour = parseClaudeWindow(rateLimits.five_hour ?? rateLimits.fiveHour);
  const sevenDay = parseClaudeWindow(rateLimits.seven_day ?? rateLimits.sevenDay);
  if (fiveHour === null && sevenDay === null) return null;
  return { fiveHour, sevenDay, source: 'statusline', occurredAt };
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
  const snapshot =
    typeof result.rateLimits === 'object' && result.rateLimits !== null
      ? (result.rateLimits as Record<string, unknown>)
      : result;
  const primary = snapshot.primary;
  const secondary = snapshot.secondary;
  const primaryMins = windowMinutes(primary);
  const secondaryMins = windowMinutes(secondary);
  let fiveHour = parseCodexWindow(primary);
  let sevenDay = parseCodexWindow(secondary);
  if (
    primaryMins !== undefined &&
    secondaryMins !== undefined &&
    primaryMins > secondaryMins
  ) {
    fiveHour = parseCodexWindow(secondary);
    sevenDay = parseCodexWindow(primary);
  }
  if (fiveHour === null && sevenDay === null) return null;
  const credits = result.rateLimitResetCredits;
  const available =
    typeof credits === 'object' && credits !== null
      ? finiteNumber((credits as Record<string, unknown>).availableCount)
      : undefined;
  return {
    fiveHour,
    sevenDay,
    source: 'app-server',
    occurredAt,
    ...(available !== undefined
      ? { resetCreditsAvailable: Math.max(0, Math.round(available)) }
      : {}),
  };
}

export function formatQuotaLine(quota: AccountQuota): string {
  const parts: string[] = [];
  if (quota.fiveHour !== null) {
    parts.push(`${Math.round(quota.fiveHour.usedPercent)}% 5h`);
  }
  if (quota.sevenDay !== null) {
    parts.push(`${Math.round(quota.sevenDay.usedPercent)}% wk`);
  }
  return parts.join(' · ');
}

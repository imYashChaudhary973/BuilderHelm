import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GrokBilling {
  readonly usedPercent: number;
  readonly periodEnd: string | null;
  readonly periodType: string | null;
  readonly tier: string | null;
  readonly fetchedAt: string;
}

interface BillingLogEntry extends Record<string, unknown> {
  readonly ts?: unknown;
  readonly ctx?: unknown;
}

interface BillingContext {
  readonly config?: {
    readonly creditUsagePercent?: unknown;
    readonly currentPeriod?: { readonly type?: unknown; readonly end?: unknown };
  };
  readonly subscriptionTier?: unknown;
}

/** One day: entries older than this describe a finished billing snapshot. */
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;

function parseEntry(line: string): GrokBilling | null {
  try {
    const entry = JSON.parse(line) as BillingLogEntry;
    const ctx: unknown = entry.ctx;
    if (typeof ctx !== 'object' || ctx === null) return null;
    const billing = ctx as BillingContext;
    const config = billing.config;
    if (typeof config !== 'object' || config === null) return null;
    const used = config.creditUsagePercent;
    if (typeof used !== 'number' || !Number.isFinite(used)) return null;
    const period = config.currentPeriod;
    const periodType = typeof period?.type === 'string' ? period.type : null;
    const periodEnd = typeof period?.end === 'string' ? period.end : null;
    const tier =
      typeof billing.subscriptionTier === 'string' ? billing.subscriptionTier : null;
    return {
      usedPercent: Math.min(100, Math.max(0, used)),
      periodEnd,
      periodType,
      tier,
      fetchedAt: typeof entry.ts === 'string' ? entry.ts : '',
    };
  } catch {
    return null;
  }
}

/**
 * Reads the newest billing snapshot the Grok CLI logged for this home. The CLI
 * writes "billing: fetched credits config" on every session start, so this is
 * the officially-produced usage source. Entries older than a day are dropped:
 * they describe a finished window, not a current limit.
 */
export function readGrokBilling(configRoot: string | null): GrokBilling | null {
  if (configRoot === null) return null;
  const logPath = join(configRoot, 'logs', 'unified.jsonl');
  if (!existsSync(logPath)) return null;
  let lines: string[];
  try {
    lines = readFileSync(logPath, 'utf8').split('\n');
  } catch {
    return null;
  }
  const cutoff = Date.now() - MAX_ENTRY_AGE_MS;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined || !line.includes('billing: fetched credits config')) continue;
    const parsed = parseEntry(line);
    if (parsed === null) continue;
    const fetchedMs = new Date(parsed.fetchedAt).getTime();
    if (!Number.isFinite(fetchedMs) || fetchedMs < cutoff) return null;
    return parsed;
  }
  return null;
}

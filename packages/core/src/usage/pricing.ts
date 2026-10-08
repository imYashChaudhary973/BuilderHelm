import type { SettingsRepository } from '@builderhelm/db';
import {
  modelAliasSchema,
  modelPriceSchema,
  type ModelAlias,
  type ModelPrice,
  type PricingState,
  type PricingUpdateInput,
  type RateSet,
} from '@builderhelm/protocol';
import { BuilderHelmError, utcNow } from '@builderhelm/shared';

import { BUNDLED_AS_OF, BUNDLED_PRICES } from './prices.js';

const OVERRIDES_KEY = 'usage.pricing.overrides';
const ALIASES_KEY = 'usage.pricing.aliases';
const REFRESHED_KEY = 'usage.pricing.refreshed';
export const PRICE_REFRESH_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** The token counts pricing needs; one ledger record or a sum of them. */
export interface PricedTokens {
  readonly modelId: string | null;
  readonly uncachedInput: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cacheWrite1h: number;
  readonly output: number;
  readonly speed: 'standard' | 'fast' | null;
  readonly inferenceGeo: string | null;
}

export interface CategoryCost {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
}

export type CostResult =
  | {
      readonly priced: true;
      readonly categories: CategoryCost;
      /** What cache reads saved against paying the uncached input rate. */
      readonly cacheSavings: number;
      readonly price: ModelPrice;
      /** Set when an assumption was made, such as an unrecorded speed tier. */
      readonly note: string | null;
    }
  | {
      readonly priced: false;
      readonly reason: string;
      readonly price: ModelPrice | null;
    };

/** Candidate price keys for a model id, most specific first. */
function candidates(modelId: string): string[] {
  const lower = modelId.trim().toLowerCase();
  const bare = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  const undated = bare.replace(/-\d{8}$/, '').replace(/-latest$/, '');
  // Claude ids can carry a context-window tag such as `[1m]`.
  const untagged = undated.replace(/\[[^\]]*\]$/, '');
  return [...new Set([lower, bare, undated, untagged])];
}

export function resolvePrice(
  modelId: string | null,
  table: ReadonlyMap<string, ModelPrice>,
  aliases: readonly ModelAlias[],
): ModelPrice | null {
  if (modelId === null) return null;
  for (const candidate of candidates(modelId)) {
    const alias = aliases.find((entry) => entry.alias.toLowerCase() === candidate);
    const target = alias?.model.toLowerCase() ?? candidate;
    const price = table.get(target);
    if (price !== undefined) return price;
  }
  return null;
}

/**
 * Cost of one model call at public API rates. Long-context rates apply to
 * the whole request once its prompt passes the threshold, so this must be
 * called per record, never on summed tokens.
 */
export function costOf(tokens: PricedTokens, price: ModelPrice | null): CostResult {
  if (price === null) {
    return { priced: false, reason: 'No published price for this model', price: null };
  }
  const prompt = tokens.uncachedInput + tokens.cacheRead + tokens.cacheWrite;
  const long =
    price.longContext !== null && prompt > price.longContext.thresholdTokens
      ? price.longContext
      : null;
  let rates: RateSet | null;
  let note: string | null = null;
  if (tokens.speed === 'fast') {
    rates = long === null ? price.fast : long.fast;
    if (rates === null) {
      return {
        priced: false,
        reason: 'Ran at the fast tier, which has no published price for this model',
        price,
      };
    }
  } else {
    rates = long === null ? price.standard : long.standard;
    if (tokens.speed === null) note = 'Speed tier not recorded; priced at standard';
  }
  const geo =
    tokens.inferenceGeo === 'us' && price.usGeoMultiplier !== null
      ? price.usGeoMultiplier
      : 1;
  const perToken = (rate: number): number => (rate * geo) / 1_000_000;
  const fiveMinuteWrites = tokens.cacheWrite - tokens.cacheWrite1h;
  const categories: CategoryCost = {
    input: tokens.uncachedInput * perToken(rates.input),
    cacheRead: tokens.cacheRead * perToken(rates.cacheRead),
    cacheWrite:
      fiveMinuteWrites * perToken(rates.cacheWrite) +
      tokens.cacheWrite1h * perToken(rates.cacheWrite1h ?? rates.cacheWrite),
    output: tokens.output * perToken(rates.output),
  };
  return {
    priced: true,
    categories,
    cacheSavings: Math.max(
      0,
      tokens.cacheRead * (perToken(rates.input) - perToken(rates.cacheRead)),
    ),
    price,
    note,
  };
}

// ── Refreshed table ─────────────────────────────────────────────────────────

const PER_MILLION = 1_000_000;

function rate(entry: Record<string, unknown>, key: string): number | null {
  const value = entry[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * PER_MILLION * 1_000_000) / 1_000_000
    : null;
}

function ratesFrom(entry: Record<string, unknown>, suffix: string): RateSet | null {
  const input = rate(entry, `input_cost_per_token${suffix}`);
  const output = rate(entry, `output_cost_per_token${suffix}`);
  if (input === null || output === null) return null;
  return {
    input,
    cacheRead: rate(entry, `cache_read_input_token_cost${suffix}`) ?? input,
    cacheWrite: rate(entry, `cache_creation_input_token_cost${suffix}`) ?? input,
    cacheWrite1h: rate(entry, `cache_creation_input_token_cost_above_1hr${suffix}`),
    output,
  };
}

function scale(rates: RateSet, factor: number): RateSet {
  const times = (value: number): number => Math.round(value * factor * 1e6) / 1e6;
  return {
    input: times(rates.input),
    cacheRead: times(rates.cacheRead),
    cacheWrite: times(rates.cacheWrite),
    cacheWrite1h: rates.cacheWrite1h === null ? null : times(rates.cacheWrite1h),
    output: times(rates.output),
  };
}

/**
 * Maps the community-maintained LiteLLM price list to price entries for the
 * providers BuilderHelm reads usage from. Entries that do not validate are
 * dropped, not guessed.
 */
export function pricesFromLiteLlm(raw: unknown, asOf: string): ModelPrice[] {
  if (raw === null || typeof raw !== 'object') return [];
  const out: ModelPrice[] = [];
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (model.includes('/') || value === null || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (entry.litellm_provider !== 'anthropic' && entry.litellm_provider !== 'openai')
      continue;
    const standard = ratesFrom(entry, '');
    if (standard === null) continue;
    const specific = entry.provider_specific_entry as Record<string, unknown> | undefined;
    const fastFactor = typeof specific?.fast === 'number' ? specific.fast : null;
    const priority = ratesFrom(entry, '_priority');
    const threshold = Object.keys(entry)
      .map((key) => /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key)?.[1])
      .find((match) => match !== undefined);
    const longStandard =
      threshold === undefined ? null : ratesFrom(entry, `_above_${threshold}k_tokens`);
    const parsed = modelPriceSchema.safeParse({
      model: model.toLowerCase(),
      standard,
      fast: priority ?? (fastFactor === null ? null : scale(standard, fastFactor)),
      longContext:
        threshold === undefined || longStandard === null
          ? null
          : {
              thresholdTokens: Number(threshold) * 1_000,
              standard: longStandard,
              fast: ratesFrom(entry, `_above_${threshold}k_tokens_priority`),
            },
      usGeoMultiplier: typeof specific?.us === 'number' ? specific.us : null,
      origin: 'refreshed',
      sourceLabel: 'LiteLLM price list',
      sourceUrl: PRICE_REFRESH_URL,
      asOf,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out.slice(0, 1_500);
}

// ── Stored state ────────────────────────────────────────────────────────────

function readList<T>(raw: string | undefined, parse: (value: unknown) => T | null): T[] {
  if (raw === undefined) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.flatMap((entry) => {
          const parsed = parse(entry);
          return parsed === null ? [] : [parsed];
        })
      : [];
  } catch {
    return [];
  }
}

export type PriceFetcher = (url: string) => Promise<unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Price list request failed (${response.status})`);
  return (await response.json()) as unknown;
}

/**
 * Effective price table: a person's override, else the refreshed list, else
 * the bundled table. Prices are applied when a report is built, so changing
 * one re-prices all history.
 */
export class PricingService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly fetchPrices: PriceFetcher = fetchJson,
  ) {}

  table(): Map<string, ModelPrice> {
    const table = new Map<string, ModelPrice>();
    for (const price of BUNDLED_PRICES) table.set(price.model, price);
    for (const price of this.refreshed().entries) table.set(price.model, price);
    for (const price of this.overrides()) table.set(price.model, price);
    return table;
  }

  aliases(): ModelAlias[] {
    return readList(this.settings.read(ALIASES_KEY), (value) => {
      const parsed = modelAliasSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    });
  }

  state(): PricingState {
    const refreshed = this.refreshed();
    return {
      entries: [...this.table().values()].sort((a, b) => a.model.localeCompare(b.model)),
      overrides: this.overrides(),
      aliases: this.aliases(),
      refreshedAt: refreshed.at,
      refreshSourceUrl: PRICE_REFRESH_URL,
      bundledAsOf: BUNDLED_AS_OF,
    };
  }

  async update(input: PricingUpdateInput): Promise<PricingState> {
    const now = utcNow();
    if (input.action === 'refresh') {
      let raw: unknown;
      try {
        raw = await this.fetchPrices(PRICE_REFRESH_URL);
      } catch {
        throw new BuilderHelmError(
          'INTEGRATION_OFFLINE',
          'The price list could not be downloaded. The previous prices stay in use.',
        );
      }
      const entries = pricesFromLiteLlm(raw, now.slice(0, 10));
      if (entries.length === 0) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The downloaded price list had no usable prices. The previous prices stay in use.',
        );
      }
      this.settings.write(REFRESHED_KEY, JSON.stringify({ at: now, entries }), now);
      return this.state();
    }
    if (input.action === 'set-override' || input.action === 'remove-override') {
      const model = input.model.toLowerCase();
      const rest = this.overrides().filter((entry) => entry.model !== model);
      const next =
        input.action === 'remove-override'
          ? rest
          : [
              ...rest,
              modelPriceSchema.parse({
                model,
                standard: input.standard,
                fast: input.fast,
                longContext: null,
                usGeoMultiplier: null,
                origin: 'override',
                sourceLabel: 'Your override',
                sourceUrl: null,
                asOf: now.slice(0, 10),
              }),
            ];
      this.settings.write(OVERRIDES_KEY, JSON.stringify(next), now);
      return this.state();
    }
    const alias = input.alias.toLowerCase();
    const rest = this.aliases().filter((entry) => entry.alias.toLowerCase() !== alias);
    const next =
      input.action === 'remove-alias'
        ? rest
        : [...rest, { alias, model: input.model.toLowerCase() }];
    this.settings.write(ALIASES_KEY, JSON.stringify(next), now);
    return this.state();
  }

  private overrides(): ModelPrice[] {
    return readList(this.settings.read(OVERRIDES_KEY), (value) => {
      const parsed = modelPriceSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    });
  }

  private refreshed(): { at: string | null; entries: ModelPrice[] } {
    const raw = this.settings.read(REFRESHED_KEY);
    if (raw === undefined) return { at: null, entries: [] };
    try {
      const value = JSON.parse(raw) as { at?: unknown; entries?: unknown };
      const entries = readList(JSON.stringify(value.entries ?? []), (entry) => {
        const parsed = modelPriceSchema.safeParse(entry);
        return parsed.success ? parsed.data : null;
      });
      return { at: typeof value.at === 'string' ? value.at : null, entries };
    } catch {
      return { at: null, entries: [] };
    }
  }
}

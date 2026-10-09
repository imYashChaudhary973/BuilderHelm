import type { ModelPrice, RateSet } from '@builderhelm/protocol';

/**
 * Bundled API prices in USD per million tokens, taken from each provider's
 * public pricing page on BUNDLED_AS_OF. A model missing here stays unpriced
 * until the person refreshes the table or sets an override; it is never
 * treated as free.
 */
export const BUNDLED_AS_OF = '2026-10-08';

const ANTHROPIC_SOURCE = {
  sourceLabel: 'Claude API pricing',
  sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
};
const OPENAI_SOURCE = {
  sourceLabel: 'OpenAI API pricing',
  sourceUrl: 'https://developers.openai.com/api/docs/pricing',
};

/**
 * Claude's cache rates are multiples of the input rate: 5-minute writes
 * 1.25x, one-hour writes 2x, reads 0.1x (0.05x on Opus/Sonnet 5.5, 0.025x on
 * Fable/Mythos 5.1). Fast mode multiplies input and output, and the cache
 * multipliers apply on top.
 */
function claudeRates(input: number, output: number, readMultiplier = 0.1): RateSet {
  const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
  return {
    input,
    cacheRead: round(input * readMultiplier),
    cacheWrite: round(input * 1.25),
    cacheWrite1h: round(input * 2),
    output,
  };
}

function claude(
  models: readonly string[],
  standard: RateSet,
  options: {
    fast?: RateSet;
    longContext?: { thresholdTokens: number; standard: RateSet };
    /** Claude 4.6 and later bill US-only inference at 1.1x. */
    usGeo: boolean;
  },
): ModelPrice[] {
  return models.map((model) => ({
    model,
    standard,
    fast: options.fast ?? null,
    longContext:
      options.longContext === undefined ? null : { ...options.longContext, fast: null },
    usGeoMultiplier: options.usGeo ? 1.1 : null,
    origin: 'bundled' as const,
    ...ANTHROPIC_SOURCE,
    asOf: BUNDLED_AS_OF,
  }));
}

/** OpenAI lists cache writes only for newer models; elsewhere a write bills as input. */
function openaiRates(
  input: number,
  cacheRead: number | null,
  output: number,
  cacheWrite: number | null = null,
): RateSet {
  return {
    input,
    cacheRead: cacheRead ?? input,
    cacheWrite: cacheWrite ?? input,
    cacheWrite1h: null,
    output,
  };
}

function openai(
  model: string,
  standard: RateSet,
  options: {
    fast?: RateSet;
    longContext?: { standard: RateSet; fast?: RateSet };
  } = {},
): ModelPrice {
  return {
    model,
    standard,
    fast: options.fast ?? null,
    longContext:
      options.longContext === undefined
        ? null
        : {
            thresholdTokens: 272_000,
            standard: options.longContext.standard,
            fast: options.longContext.fast ?? null,
          },
    usGeoMultiplier: null,
    origin: 'bundled',
    ...OPENAI_SOURCE,
    asOf: BUNDLED_AS_OF,
  };
}

export const BUNDLED_PRICES: readonly ModelPrice[] = [
  ...claude(['claude-fable-5-1', 'claude-mythos-5-1'], claudeRates(10, 50, 0.025), {
    usGeo: true,
  }),
  ...claude(['claude-fable-5', 'claude-mythos-5'], claudeRates(10, 50), { usGeo: true }),
  ...claude(['claude-opus-5-5'], claudeRates(4, 20, 0.05), {
    fast: claudeRates(8, 40, 0.05),
    usGeo: true,
  }),
  ...claude(['claude-opus-5', 'claude-opus-4-8'], claudeRates(5, 25), {
    fast: claudeRates(10, 50),
    usGeo: true,
  }),
  ...claude(['claude-opus-4-7', 'claude-opus-4-6'], claudeRates(5, 25), { usGeo: true }),
  ...claude(['claude-opus-4-5'], claudeRates(5, 25), { usGeo: false }),
  ...claude(['claude-opus-4-1', 'claude-opus-4'], claudeRates(15, 75), { usGeo: false }),
  ...claude(['claude-sonnet-5-5'], claudeRates(2, 10, 0.05), { usGeo: true }),
  ...claude(['claude-sonnet-5'], claudeRates(2, 10), { usGeo: true }),
  ...claude(['claude-sonnet-4-6'], claudeRates(3, 15), { usGeo: true }),
  ...claude(['claude-sonnet-4-5', 'claude-sonnet-4'], claudeRates(3, 15), {
    usGeo: false,
  }),
  ...claude(['claude-haiku-5-5'], claudeRates(0.1, 0.5), {
    longContext: { thresholdTokens: 100_000, standard: claudeRates(0.5, 2.5) },
    usGeo: true,
  }),
  ...claude(['claude-haiku-4-5'], claudeRates(1, 5), { usGeo: false }),
  ...claude(['claude-3-5-haiku'], claudeRates(0.8, 4), { usGeo: false }),

  openai('gpt-6-astra', openaiRates(10, 1, 50, 12.5), {
    fast: openaiRates(20, 2, 100, 25),
    longContext: {
      standard: openaiRates(20, 2, 75, 25),
      fast: openaiRates(40, 4, 150, 50),
    },
  }),
  openai('gpt-6.1-sol', openaiRates(2, 0.1, 10, 2.5), {
    fast: openaiRates(4, 0.2, 20, 5),
    longContext: {
      standard: openaiRates(4, 0.2, 15, 5),
      fast: openaiRates(8, 0.4, 30, 10),
    },
  }),
  openai('gpt-6-sol', openaiRates(2, 0.2, 10, 2.5), {
    fast: openaiRates(4, 0.4, 20, 5),
    longContext: {
      standard: openaiRates(4, 0.4, 15, 5),
      fast: openaiRates(8, 0.8, 30, 10),
    },
  }),
  openai('gpt-6-luna', openaiRates(0.1, 0.01, 0.5, 0.125), {
    fast: openaiRates(0.2, 0.02, 1, 0.25),
    longContext: {
      standard: openaiRates(0.2, 0.02, 0.75, 0.25),
      fast: openaiRates(0.4, 0.04, 1.5, 0.5),
    },
  }),
  openai('gpt-5.6-sol', openaiRates(4, 0.4, 20, 5), {
    fast: openaiRates(8, 0.8, 40, 10),
    longContext: {
      standard: openaiRates(8, 0.8, 30, 10),
      fast: openaiRates(16, 1.6, 60, 20),
    },
  }),
  openai('gpt-5.6-terra', openaiRates(2, 0.2, 12, 2.5), {
    longContext: { standard: openaiRates(4, 0.4, 18, 5) },
  }),
  openai('gpt-5.6-luna', openaiRates(0.2, 0.02, 1.2, 0.25), {
    longContext: { standard: openaiRates(0.4, 0.04, 1.8, 0.5) },
  }),
  openai('gpt-5.5', openaiRates(5, 0.5, 30), {
    fast: openaiRates(12.5, 1.25, 75),
    longContext: { standard: openaiRates(10, 1, 45) },
  }),
  openai('gpt-5.4', openaiRates(2.5, 0.25, 15), {
    fast: openaiRates(5, 0.5, 30),
    longContext: { standard: openaiRates(5, 0.5, 22.5) },
  }),
  openai('gpt-5.4-mini', openaiRates(0.75, 0.075, 4.5), {
    fast: openaiRates(1.5, 0.15, 9),
  }),
  openai('gpt-5.4-nano', openaiRates(0.2, 0.02, 1.25)),
  openai('gpt-5.2', openaiRates(1.75, 0.175, 14), { fast: openaiRates(3.5, 0.35, 28) }),
  openai('gpt-5.1', openaiRates(1.25, 0.125, 10), { fast: openaiRates(2.5, 0.25, 20) }),
  openai('gpt-5', openaiRates(1.25, 0.125, 10), { fast: openaiRates(2.5, 0.25, 20) }),
  openai('gpt-5-mini', openaiRates(0.25, 0.025, 2), {
    fast: openaiRates(0.45, 0.045, 3.6),
  }),
  openai('gpt-5-nano', openaiRates(0.05, 0.005, 0.4)),
  openai('gpt-4.1', openaiRates(2, 0.5, 8), { fast: openaiRates(3.5, 0.875, 14) }),
  openai('gpt-4.1-mini', openaiRates(0.4, 0.1, 1.6), {
    fast: openaiRates(0.7, 0.175, 2.8),
  }),
  openai('gpt-4o', openaiRates(2.5, 1.25, 10), { fast: openaiRates(4.25, 2.125, 17) }),
  openai('gpt-4o-mini', openaiRates(0.15, 0.075, 0.6), {
    fast: openaiRates(0.25, 0.125, 1),
  }),
  openai('o3', openaiRates(2, 0.5, 8), { fast: openaiRates(3.5, 0.875, 14) }),
  openai('o4-mini', openaiRates(1.1, 0.275, 4.4), { fast: openaiRates(2, 0.5, 8) }),
];

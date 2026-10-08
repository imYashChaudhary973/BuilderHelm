import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import { afterEach, describe, expect, it } from 'vitest';

import {
  costOf,
  pricesFromLiteLlm,
  PricingService,
  resolvePrice,
  type PricedTokens,
} from '../src/usage/pricing.js';

const databases: BuilderHelmDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function service(fetchPrices?: (url: string) => Promise<unknown>): PricingService {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  return new PricingService(new SettingsRepository(database), fetchPrices);
}

const tokens = (overrides: Partial<PricedTokens> = {}): PricedTokens => ({
  modelId: 'claude-opus-5-5',
  uncachedInput: 2,
  cacheRead: 9_725,
  cacheWrite: 17_449,
  cacheWrite1h: 17_449,
  output: 244,
  speed: 'standard',
  inferenceGeo: null,
  ...overrides,
});

function total(result: ReturnType<typeof costOf>): number | null {
  if (!result.priced) return null;
  const { input, cacheRead, cacheWrite, output } = result.categories;
  return input + cacheRead + cacheWrite + output;
}

describe('pricing', () => {
  it('prices each category at its own Claude rate, one-hour writes at 2x input', () => {
    const pricing = service();
    const price = resolvePrice('claude-opus-5-5', pricing.table(), []);
    const result = costOf(tokens(), price);
    // 2 × $4 + 9,725 × $0.20 + 17,449 × $8 + 244 × $20, per million.
    expect(total(result)).toBeCloseTo(
      (2 * 4 + 9_725 * 0.2 + 17_449 * 8 + 244 * 20) / 1e6,
      10,
    );
    expect(result.priced && result.cacheSavings).toBeCloseTo(
      (9_725 * (4 - 0.2)) / 1e6,
      10,
    );
  });

  it('uses fast-mode rates, and leaves a fast call unpriced where none is published', () => {
    const pricing = service();
    const table = pricing.table();
    const fast = costOf(
      tokens({ cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, speed: 'fast' }),
      resolvePrice('claude-opus-5-5', table, []),
    );
    expect(total(fast)).toBeCloseTo((2 * 8 + 244 * 40) / 1e6, 10);
    const sonnet = costOf(
      tokens({ speed: 'fast' }),
      resolvePrice('claude-sonnet-5-5', table, []),
    );
    expect(sonnet.priced).toBe(false);
  });

  it('never prices an unknown model as free', () => {
    const result = costOf(
      tokens(),
      resolvePrice('mystery-model-9', service().table(), []),
    );
    expect(result).toMatchObject({
      priced: false,
      reason: expect.stringMatching(/No published price/),
    });
  });

  it('resolves dated ids, provider prefixes, and aliases', () => {
    const pricing = service();
    const table = pricing.table();
    expect(resolvePrice('claude-haiku-4-5-20251001', table, [])?.model).toBe(
      'claude-haiku-4-5',
    );
    expect(resolvePrice('openai/gpt-6-sol', table, [])?.model).toBe('gpt-6-sol');
    expect(
      resolvePrice('my-proxy-opus', table, [
        { alias: 'my-proxy-opus', model: 'claude-opus-5-5' },
      ])?.model,
    ).toBe('claude-opus-5-5');
  });

  it('applies long-context rates to the whole request past the threshold', () => {
    const table = service().table();
    const big = costOf(
      tokens({
        modelId: 'gpt-6-sol',
        uncachedInput: 300_000,
        cacheRead: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        output: 1_000,
      }),
      resolvePrice('gpt-6-sol', table, []),
    );
    expect(total(big)).toBeCloseTo((300_000 * 4 + 1_000 * 15) / 1e6, 10);
  });

  it('multiplies every category by 1.1 for US-only inference on Claude 4.6 and later', () => {
    const table = service().table();
    const price = resolvePrice('claude-opus-5-5', table, []);
    expect(total(costOf(tokens({ inferenceGeo: 'us' }), price))).toBeCloseTo(
      (total(costOf(tokens(), price)) ?? 0) * 1.1,
      10,
    );
  });

  it('re-prices history when an override is set, and notes an unrecorded tier', async () => {
    const pricing = service();
    const unknown = tokens({ modelId: 'gpt-reserve', speed: null });
    expect(costOf(unknown, resolvePrice('gpt-reserve', pricing.table(), [])).priced).toBe(
      false,
    );
    const rates = {
      input: 1,
      cacheRead: 0.1,
      cacheWrite: 1,
      cacheWrite1h: null,
      output: 2,
    };
    await pricing.update({
      action: 'set-override',
      model: 'gpt-reserve',
      standard: rates,
      fast: null,
    });
    const priced = costOf(unknown, resolvePrice('gpt-reserve', pricing.table(), []));
    expect(priced).toMatchObject({
      priced: true,
      note: expect.stringMatching(/not recorded/),
    });
    expect(pricing.state().overrides[0]?.origin).toBe('override');
  });

  it('maps the refreshed price list and keeps old prices when the download fails', async () => {
    const list = {
      'claude-new-1': {
        litellm_provider: 'anthropic',
        input_cost_per_token: 3e-6,
        output_cost_per_token: 1.5e-5,
        cache_read_input_token_cost: 3e-7,
        cache_creation_input_token_cost: 3.75e-6,
        provider_specific_entry: { fast: 2 },
      },
      'vertex_ai/claude-new-1': { litellm_provider: 'vertex_ai' },
    };
    expect(pricesFromLiteLlm(list, '2026-10-08')).toEqual([
      expect.objectContaining({
        model: 'claude-new-1',
        standard: expect.objectContaining({ input: 3, output: 15, cacheRead: 0.3 }),
        fast: expect.objectContaining({ input: 6, output: 30 }),
        origin: 'refreshed',
      }),
    ]);
    const failing = service(async () => {
      throw new Error('offline');
    });
    await expect(failing.update({ action: 'refresh' })).rejects.toThrow(
      /previous prices/,
    );
    expect(failing.state().refreshedAt).toBeNull();
  });
});

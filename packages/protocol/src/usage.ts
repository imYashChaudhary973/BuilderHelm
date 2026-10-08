import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

/**
 * Where a usage record came from. `api` is BuilderHelm's own model calls
 * (Chats) made with a configured API key; the others are agent CLIs.
 */
export const USAGE_PROVIDER_IDS = ['claude', 'codex', 'opencode', 'api'] as const;
export const usageProviderIdSchema = z.enum(USAGE_PROVIDER_IDS);
export type UsageProviderId = z.infer<typeof usageProviderIdSchema>;

export const usageSourceKindSchema = z.enum([
  'claude-transcript',
  'codex-rollout',
  'opencode-db',
  'builderhelm-chat',
]);
export type UsageSourceKind = z.infer<typeof usageSourceKindSchema>;

const tokenCountSchema = z.number().int().nonnegative();

/**
 * One measured usage event, normalized across providers.
 *
 * Token categories never overlap: `uncachedInputTokens + cacheReadTokens +
 * cacheWriteTokens + outputTokens` is the whole event. `cacheWrite1hTokens` is
 * the part of `cacheWriteTokens` written with a one-hour TTL, and
 * `reasoningTokens` is the part of `outputTokens` spent reasoning; neither is
 * ever added on top. `complete` is false when the source left a category out
 * (for example a cache-write count it does not record).
 */
export const usageRecordSchema = z
  .object({
    /** Provider-scoped identity; the same event seen twice keeps one row. */
    eventKey: z.string().min(1).max(256),
    provider: usageProviderIdSchema,
    /** Stable account identity: a fingerprint, never a raw credential. */
    accountKey: z.string().min(1).max(128),
    /** BuilderHelm login the source belonged to when it was read. */
    accountRef: z.string().min(1).max(128).nullable(),
    environment: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(256).nullable(),
    /** Short label for the session, such as its project folder name. */
    sessionLabel: z.string().min(1).max(200).nullable(),
    modelId: z.string().min(1).max(200).nullable(),
    occurredAt: z.string().datetime(),
    uncachedInputTokens: tokenCountSchema,
    cacheReadTokens: tokenCountSchema,
    cacheWriteTokens: tokenCountSchema,
    cacheWrite1hTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    reasoningTokens: tokenCountSchema.nullable(),
    /** Cost the provider itself reported for this event, if any. */
    reportedCostUsd: z.number().nonnegative().finite().nullable(),
    /** Provider's raw tier name, such as `standard` or `priority`. */
    serviceTier: z.string().min(1).max(64).nullable(),
    /** The pricing tier this event ran at; null when the source does not say. */
    speed: z.enum(['standard', 'fast']).nullable(),
    /** `us` when the request was pinned to US-only inference. */
    inferenceGeo: z.string().min(1).max(32).nullable(),
    source: usageSourceKindSchema,
    sourceId: z.string().min(1).max(512),
    complete: z.boolean(),
  })
  .strict()
  .refine((record) => record.cacheWrite1hTokens <= record.cacheWriteTokens, {
    message: 'One-hour cache writes are part of cache writes',
    path: ['cacheWrite1hTokens'],
  })
  .refine(
    (record) =>
      record.reasoningTokens === null || record.reasoningTokens <= record.outputTokens,
    { message: 'Reasoning tokens are part of output tokens', path: ['reasoningTokens'] },
  );
export type UsageRecord = z.infer<typeof usageRecordSchema>;

// ── Pricing ──────────────────────────────────────────────────────────────────

const usdPerMillionSchema = z.number().nonnegative().finite().max(100_000);

/** USD per million tokens for each category. */
export const rateSetSchema = z
  .object({
    input: usdPerMillionSchema,
    cacheRead: usdPerMillionSchema,
    cacheWrite: usdPerMillionSchema,
    /** One-hour cache writes; null when the provider has no such TTL. */
    cacheWrite1h: usdPerMillionSchema.nullable(),
    output: usdPerMillionSchema,
  })
  .strict();
export type RateSet = z.infer<typeof rateSetSchema>;

export const priceOriginSchema = z.enum(['bundled', 'refreshed', 'override']);
export type PriceOrigin = z.infer<typeof priceOriginSchema>;

export const modelPriceSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    standard: rateSetSchema,
    /** Faster service tier (Claude fast mode, OpenAI priority); null if unpublished. */
    fast: rateSetSchema.nullable(),
    /** Rates for a request whose prompt exceeds the threshold, applied to the whole request. */
    longContext: z
      .object({
        thresholdTokens: z.number().int().positive(),
        standard: rateSetSchema,
        fast: rateSetSchema.nullable(),
      })
      .strict()
      .nullable(),
    /** Multiplier for US-only inference, applied to every category. */
    usGeoMultiplier: z.number().min(1).max(10).nullable(),
    origin: priceOriginSchema,
    sourceLabel: z.string().min(1).max(200),
    sourceUrl: z.string().url().max(500).nullable(),
    /** Date the rates were taken from the source (YYYY-MM-DD). */
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const modelAliasSchema = z
  .object({
    alias: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
  })
  .strict();
export type ModelAlias = z.infer<typeof modelAliasSchema>;

export const pricingStateSchema = z
  .object({
    /** Effective prices: override, else refreshed, else bundled. */
    entries: z.array(modelPriceSchema).max(2_000),
    overrides: z.array(modelPriceSchema).max(500),
    aliases: z.array(modelAliasSchema).max(500),
    refreshedAt: z.string().datetime().nullable(),
    refreshSourceUrl: z.string().url(),
    bundledAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type PricingState = z.infer<typeof pricingStateSchema>;

export const pricingUpdateInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set-override'),
      model: z.string().trim().min(1).max(200),
      standard: rateSetSchema,
      fast: rateSetSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('remove-override'),
      model: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('set-alias'),
      alias: z.string().trim().min(1).max(200),
      model: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('remove-alias'),
      alias: z.string().trim().min(1).max(200),
    })
    .strict(),
  z.object({ action: z.literal('refresh') }).strict(),
]);
export type PricingUpdateInput = z.infer<typeof pricingUpdateInputSchema>;

// ── Report ───────────────────────────────────────────────────────────────────

export const USAGE_RANGES = ['today', '7d', '30d', '90d', 'all'] as const;
export const usageRangeSchema = z.enum(USAGE_RANGES);
export type UsageRange = z.infer<typeof usageRangeSchema>;

export const usageReportInputSchema = z
  .object({
    range: usageRangeSchema,
    /** Environment id; null means all environments. */
    environment: z.string().min(1).max(128).nullable(),
    /** Read new history from every source before reporting. */
    rescan: z.boolean().optional(),
  })
  .strict();
export type UsageReportInput = z.infer<typeof usageReportInputSchema>;

export const usageTokensSchema = z
  .object({
    uncachedInput: tokenCountSchema,
    cacheRead: tokenCountSchema,
    cacheWrite: tokenCountSchema,
    output: tokenCountSchema,
    /** Of output; already counted there. */
    reasoning: tokenCountSchema,
    total: tokenCountSchema,
    records: tokenCountSchema,
    /** Records whose source left a token category out. */
    incompleteRecords: tokenCountSchema,
  })
  .strict();
export type UsageTokens = z.infer<typeof usageTokensSchema>;

const usdSchema = z.number().nonnegative().finite();

/**
 * Estimated API-equivalent cost: what these tokens would cost at public API
 * rates. It is never a subscription charge.
 */
export const usageCostSchema = z
  .object({
    /** Calculated from token counts and rates; null when nothing was priced. */
    estimatedUsd: usdSchema.nullable(),
    categories: z
      .object({
        input: usdSchema,
        cacheRead: usdSchema,
        cacheWrite: usdSchema,
        output: usdSchema,
      })
      .strict()
      .nullable(),
    /** Cost the provider reported that cannot be split into categories. */
    reportedUsd: usdSchema.nullable(),
    /** What cache reads saved against uncached input; null unless both rates are known. */
    cacheSavingsUsd: usdSchema.nullable(),
    pricedTokens: tokenCountSchema,
    unpricedTokens: tokenCountSchema,
  })
  .strict();
export type UsageCost = z.infer<typeof usageCostSchema>;

/** `local`: a model run on this machine, with no API price to compare. */
export const usagePricingStatusSchema = z.enum([
  'priced',
  'reported',
  'partial',
  'unpriced',
  'local',
  'none',
]);
export type UsagePricingStatus = z.infer<typeof usagePricingStatusSchema>;

export const usageRowSchema = z
  .object({
    key: z.string().min(1).max(300),
    label: z.string().min(1).max(300),
    detail: z.string().max(300).nullable(),
    tokens: usageTokensSchema,
    cost: usageCostSchema,
    pricing: usagePricingStatusSchema,
  })
  .strict();
export type UsageRow = z.infer<typeof usageRowSchema>;

export const usageModelRowSchema = usageRowSchema
  .extend({
    /** Price entry the model resolved to, after aliases. */
    pricedAs: z.string().max(200).nullable(),
    rateSource: z
      .object({
        origin: priceOriginSchema,
        label: z.string().max(200),
        asOf: z.string().max(20),
      })
      .strict()
      .nullable(),
    /** Why some tokens stayed unpriced, such as a fast tier with no published rate. */
    pricingNote: z.string().max(300).nullable(),
  })
  .strict();
export type UsageModelRow = z.infer<typeof usageModelRowSchema>;

export const usageSourceStateSchema = z.enum([
  'ok',
  'partial',
  'failed',
  'missing',
  'unavailable',
]);
export type UsageSourceState = z.infer<typeof usageSourceStateSchema>;

export const usageSourceStatusSchema = z
  .object({
    id: z.string().min(1).max(600),
    provider: z.string().min(1).max(32),
    kind: z.string().min(1).max(64),
    accountLabel: z.string().max(200).nullable(),
    /** Where it was read, home-relative; null for sources with no path. */
    location: z.string().max(600).nullable(),
    state: usageSourceStateSchema,
    records: tokenCountSchema,
    /** Lines or rows that could not be read as usage. */
    skipped: tokenCountSchema,
    lastScanAt: z.string().datetime().nullable(),
    message: z.string().max(400).nullable(),
  })
  .strict();
export type UsageSourceStatus = z.infer<typeof usageSourceStatusSchema>;

export const usageReportSchema = z
  .object({
    range: usageRangeSchema,
    environment: z.string().max(128).nullable(),
    from: z.string().datetime().nullable(),
    to: z.string().datetime(),
    environments: z
      .array(z.object({ id: z.string().max(128), label: z.string().max(200) }).strict())
      .max(64),
    totals: usageRowSchema,
    byProvider: z.array(usageRowSchema).max(32),
    byAccount: z.array(usageRowSchema).max(256),
    byModel: z.array(usageModelRowSchema).max(512),
    byDay: z.array(usageRowSchema).max(4_000),
    bySession: z.array(usageRowSchema).max(50),
    /** Sources grouped by status, plus providers BuilderHelm cannot read. */
    sources: z.array(usageSourceStatusSchema).max(2_000),
    pricing: z
      .object({
        refreshedAt: z.string().datetime().nullable(),
        bundledAsOf: z.string().max(20),
      })
      .strict(),
    scan: z
      .object({
        lastScanAt: z.string().datetime().nullable(),
        error: z.string().max(400).nullable(),
      })
      .strict(),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type UsageReport = z.infer<typeof usageReportSchema>;

export const usageReportRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: usageReportInputSchema })
  .strict();
export const pricingStateRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const pricingUpdateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: pricingUpdateInputSchema })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const usageReportIpcResponseSchema = ipcResult(usageReportSchema);
export const pricingStateIpcResponseSchema = ipcResult(pricingStateSchema);

import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

export const previewBoundsSchema = z
  .object({
    x: z.number().int().min(0).max(10_000),
    y: z.number().int().min(0).max(10_000),
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
  })
  .strict();
export type PreviewBounds = z.infer<typeof previewBoundsSchema>;

export const previewUrlSchema = z.string().min(1).max(4096);

export function parsePreviewUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const withProtocol = /^[a-zA-Z][a-zA-Z+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.toString();
}

export const browserCommandInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('open'),
      url: previewUrlSchema,
      bounds: previewBoundsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('bounds'),
      bounds: previewBoundsSchema,
    })
    .strict(),
  z.object({ action: z.literal('hide') }).strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('forward') }).strict(),
  z.object({ action: z.literal('reload') }).strict(),
]);
export type BrowserCommandInput = z.infer<typeof browserCommandInputSchema>;

export const browserStateSchema = z
  .object({
    url: z.string().max(4096),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
  })
  .strict();
export type BrowserState = z.infer<typeof browserStateSchema>;

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const browserCommandRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: browserCommandInputSchema,
  })
  .strict();

export const browserCommandIpcResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: browserStateSchema }).strict(),
  z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
]);

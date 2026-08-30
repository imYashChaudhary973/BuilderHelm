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

/** Pull listening origins out of terminal text. Only loopback http(s). */
export function extractPreviewOrigins(text: string): string[] {
  const found = new Set<string>();
  const pattern =
    /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const raw = match[0] ?? '';
    const https = raw.toLowerCase().startsWith('https://');
    const url = parsePreviewUrl(
      `${https ? 'https' : 'http'}://127.0.0.1:${String(port)}/`,
    );
    if (url !== null) found.add(url);
  }
  return [...found];
}

export const previewViewportIds = ['desktop', 'tablet', 'phone'] as const;
export const previewViewportIdSchema = z.enum(previewViewportIds);
export type PreviewViewportId = (typeof previewViewportIds)[number];

export const PREVIEW_VIEWPORTS = {
  desktop: { id: 'desktop', width: 1280, height: 800 },
  tablet: { id: 'tablet', width: 768, height: 1024 },
  phone: { id: 'phone', width: 390, height: 844 },
} as const satisfies Record<
  PreviewViewportId,
  { readonly id: PreviewViewportId; readonly width: number; readonly height: number }
>;

export const previewOriginSchema = z
  .object({
    url: z.string().min(1).max(4096),
    port: z.number().int().min(1).max(65535),
    sessionId: z.string().uuid().nullable(),
    paneId: z.string().uuid().nullable(),
  })
  .strict();
export type PreviewOrigin = z.infer<typeof previewOriginSchema>;

export const previewSnapshotNodeSchema = z
  .object({
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/),
    role: z.string().min(1).max(40),
    name: z.string().max(80),
  })
  .strict();
export type PreviewSnapshotNode = z.infer<typeof previewSnapshotNodeSchema>;

/** Keep only role/name/ref. Drop cookies, values, and extra keys. */
export function buildPageSnapshot(raw: unknown): PreviewSnapshotNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: PreviewSnapshotNode[] = [];
  for (const [index, row] of raw.entries()) {
    if (nodes.length >= 200) break;
    if (typeof row !== 'object' || row === null) continue;
    const role =
      'role' in row && typeof row.role === 'string' ? row.role.trim().slice(0, 40) : '';
    if (role.length === 0) continue;
    const name =
      'name' in row && typeof row.name === 'string' ? row.name.trim().slice(0, 80) : '';
    const parsed = previewSnapshotNodeSchema.safeParse({
      ref: `e${String(index + 1)}`,
      role,
      name,
    });
    if (parsed.success) nodes.push(parsed.data);
  }
  return nodes;
}

export const previewSnapshotSchema = z
  .object({
    url: z.string().max(4096),
    viewport: previewViewportIdSchema,
    nodes: z.array(previewSnapshotNodeSchema).max(200),
  })
  .strict();
export type PreviewSnapshot = z.infer<typeof previewSnapshotSchema>;

export const previewArtifactKindSchema = z.enum([
  'screenshot',
  'snapshot',
  'tool',
  'console',
]);
export type PreviewArtifactKind = z.infer<typeof previewArtifactKindSchema>;

export const previewArtifactSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid().nullable(),
    headSha: z.string().min(7).max(64),
    kind: previewArtifactKindSchema,
    url: z.string().max(4096),
    viewport: previewViewportIdSchema,
    nodes: z.array(previewSnapshotNodeSchema).max(200).nullable(),
    pngBase64: z.string().max(8_000_000).nullable(),
    detail: z.string().max(2000).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PreviewArtifact = z.infer<typeof previewArtifactSchema>;

export const previewScreenshotInputSchema = z
  .object({
    root: z.string().min(1).max(4096).optional(),
    runId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type PreviewScreenshotInput = z.infer<typeof previewScreenshotInputSchema>;

export const previewArtifactListInputSchema = z
  .object({
    root: z.string().min(1).max(4096).optional(),
    runId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type PreviewArtifactListInput = z.infer<typeof previewArtifactListInputSchema>;

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
  z
    .object({
      action: z.literal('viewport'),
      preset: previewViewportIdSchema,
      bounds: previewBoundsSchema,
    })
    .strict(),
  z.object({ action: z.literal('hide') }).strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('forward') }).strict(),
  z.object({ action: z.literal('reload') }).strict(),
  z.object({ action: z.literal('external') }).strict(),
]);
export type BrowserCommandInput = z.infer<typeof browserCommandInputSchema>;

export const browserStateSchema = z
  .object({
    url: z.string().max(4096),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    viewport: previewViewportIdSchema,
  })
  .strict();
export type BrowserState = z.infer<typeof browserStateSchema>;

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const browserCommandRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: browserCommandInputSchema,
  })
  .strict();

export const browserCommandIpcResponseSchema = ipcResult(browserStateSchema);

export const browserOriginsRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const browserSnapshotRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: previewScreenshotInputSchema,
  })
  .strict();
export const browserScreenshotRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: previewScreenshotInputSchema,
  })
  .strict();
export const browserArtifactsRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: previewArtifactListInputSchema,
  })
  .strict();

export const browserOriginsIpcResponseSchema = ipcResult(
  z.array(previewOriginSchema).max(32),
);
export const browserSnapshotIpcResponseSchema = ipcResult(previewSnapshotSchema);
export const browserScreenshotIpcResponseSchema = ipcResult(previewArtifactSchema);
export const browserArtifactsIpcResponseSchema = ipcResult(
  z.array(previewArtifactSchema).max(50),
);

export const previewDriveActionSchema = z.enum(['click', 'type', 'fill', 'scroll']);
export type PreviewDriveAction = z.infer<typeof previewDriveActionSchema>;

export const previewRefSchema = z.string().regex(/^e[1-9][0-9]{0,3}$/);

export const previewDriveInputSchema = z
  .object({
    action: previewDriveActionSchema,
    ref: previewRefSchema,
    text: z.string().max(4_000).optional(),
  })
  .strict();
export type PreviewDriveInput = z.infer<typeof previewDriveInputSchema>;

export const previewDriveReceiptSchema = z
  .object({
    id: z.string().uuid(),
    action: previewDriveActionSchema,
    ref: previewRefSchema,
    url: z.string().max(4096),
    summary: z.string().max(500),
    privileged: z.boolean(),
    outcome: z.enum(['done', 'denied', 'blocked']),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PreviewDriveReceipt = z.infer<typeof previewDriveReceiptSchema>;

export const previewDriveApprovalSchema = z
  .object({
    id: z.string().uuid(),
    action: previewDriveActionSchema,
    ref: previewRefSchema,
    summary: z.string().max(500),
  })
  .strict();
export type PreviewDriveApproval = z.infer<typeof previewDriveApprovalSchema>;

export const previewDriveResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done'), receipt: previewDriveReceiptSchema }).strict(),
  z
    .object({
      kind: z.literal('approval_required'),
      approval: previewDriveApprovalSchema,
    })
    .strict(),
]);
export type PreviewDriveResult = z.infer<typeof previewDriveResultSchema>;

export const previewEventSchema = z
  .object({
    kind: z.enum(['console', 'network']),
    text: z.string().max(400),
    url: z.string().max(400),
    status: z.number().int().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PreviewEvent = z.infer<typeof previewEventSchema>;

export const previewPickSchema = z
  .object({
    role: z.string().max(40),
    name: z.string().max(80),
    html: z.string().max(500),
    pngBase64: z.string().max(8_000_000).nullable(),
  })
  .strict();
export type PreviewPick = z.infer<typeof previewPickSchema>;

export function redactPreviewUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.slice(0, 200);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    parsed.username = '';
    parsed.password = '';
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (/token|key|secret|auth|password|cookie|sid/i.test(key)) {
      parsed.searchParams.set(key, 'redacted');
    }
  }
  return parsed.toString().slice(0, 300);
}

export function previewTargetNeedsApproval(target: {
  readonly tag: string;
  readonly type: string;
  readonly name: string;
  readonly href: string;
  readonly pageOrigin: string;
}): boolean {
  const name = target.name.toLowerCase();
  const type = target.type.toLowerCase();
  if (type === 'password' || type === 'submit') return true;
  if (/submit|send|delete|remove|pay|checkout|confirm|purchase|buy|destroy/.test(name)) {
    return true;
  }
  if (target.tag === 'a' && target.href.length > 0) {
    try {
      return new URL(target.href).origin !== target.pageOrigin;
    } catch {
      return true;
    }
  }
  return false;
}

export const browserDriveRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: previewDriveInputSchema,
  })
  .strict();
export const browserApproveRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: z.object({ id: z.string().uuid(), allow: z.boolean() }).strict(),
  })
  .strict();
export const browserEventsRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const browserPickRequestSchema = browserEventsRequestSchema;
export const browserPickSendRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: z
      .object({
        note: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export const browserDriveIpcResponseSchema = ipcResult(previewDriveResultSchema);
export const browserEventsIpcResponseSchema = ipcResult(
  z.array(previewEventSchema).max(100),
);
export const browserPickIpcResponseSchema = ipcResult(previewPickSchema);
export const browserPickSendIpcResponseSchema = ipcResult(
  z.object({ sent: z.boolean() }).strict(),
);
export const browserReceiptsIpcResponseSchema = ipcResult(
  z.array(previewDriveReceiptSchema).max(100),
);

export const desktopActActionSchema = z.enum(['click', 'type']);
export type DesktopActAction = z.infer<typeof desktopActActionSchema>;

export const desktopActInputSchema = z
  .object({
    action: desktopActActionSchema,
    x: z.number().int().min(0).max(16_000).optional(),
    y: z.number().int().min(0).max(16_000).optional(),
    text: z.string().max(4_000).optional(),
  })
  .strict();
export type DesktopActInput = z.infer<typeof desktopActInputSchema>;

export function desktopActNeedsApproval(): boolean {
  return true;
}

export function escapeAppleScript(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export const desktopActApprovalSchema = z
  .object({
    id: z.string().uuid(),
    summary: z.string().max(500),
  })
  .strict();
export type DesktopActApproval = z.infer<typeof desktopActApprovalSchema>;

export const desktopActReceiptSchema = z
  .object({
    id: z.string().uuid(),
    action: desktopActActionSchema,
    summary: z.string().max(500),
    outcome: z.enum(['done', 'denied', 'blocked']),
    createdAt: z.string().datetime(),
  })
  .strict();
export type DesktopActReceipt = z.infer<typeof desktopActReceiptSchema>;

export const desktopActResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done'), receipt: desktopActReceiptSchema }).strict(),
  z
    .object({
      kind: z.literal('approval_required'),
      approval: desktopActApprovalSchema,
    })
    .strict(),
]);
export type DesktopActResult = z.infer<typeof desktopActResultSchema>;

export const desktopScreenshotSchema = z
  .object({ pngBase64: z.string().max(12_000_000) })
  .strict();

export const desktopActRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: desktopActInputSchema,
  })
  .strict();
export const desktopApproveRequestSchema = browserApproveRequestSchema;
export const desktopScreenshotRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const desktopActIpcResponseSchema = ipcResult(desktopActResultSchema);
export const desktopScreenshotIpcResponseSchema = ipcResult(desktopScreenshotSchema);

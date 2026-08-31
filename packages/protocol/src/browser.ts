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
  'annotation',
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

export const browserZoomPercents = [75, 90, 100, 110, 125, 150] as const;
export const browserZoomPercentSchema = z.union([
  z.literal(75),
  z.literal(90),
  z.literal(100),
  z.literal(110),
  z.literal(125),
  z.literal(150),
]);
export type BrowserZoomPercent = z.infer<typeof browserZoomPercentSchema>;

/** Next allowed zoom stop. Unknown current values snap through 100. */
export function stepBrowserZoom(current: number, step: 1 | -1): BrowserZoomPercent {
  const from = browserZoomPercents.indexOf(current as BrowserZoomPercent);
  const index = from === -1 ? browserZoomPercents.indexOf(100) : from;
  const next = index + step;
  if (next <= 0) return browserZoomPercents[0];
  if (next >= browserZoomPercents.length - 1) {
    return browserZoomPercents[browserZoomPercents.length - 1] ?? 150;
  }
  return browserZoomPercents[next] ?? 100;
}

export const browserMenuKinds = ['import', 'overflow', 'viewport'] as const;
export const browserMenuKindSchema = z.enum(browserMenuKinds);
export type BrowserMenuKind = (typeof browserMenuKinds)[number];

/**
 * Toolbar menus are a child window. The embedded page sits above renderer DOM,
 * so a React popover anchored in the toolbar would be painted behind it.
 *
 * The renderer only supplies kind and position. Items are built in main from
 * mapped ports and the real profile list, then pushed to the popup.
 */
export const browserMenuInputSchema = z
  .object({
    kind: browserMenuKindSchema,
    x: z.number().int().min(0).max(30_000),
    y: z.number().int().min(0).max(30_000),
  })
  .strict();
export type BrowserMenuInput = z.infer<typeof browserMenuInputSchema>;

/** `choice` is null when the menu closed without a selection. */
export const browserMenuResultSchema = z
  .object({ choice: z.string().min(1).max(4200).nullable() })
  .strict();
export type BrowserMenuResult = z.infer<typeof browserMenuResultSchema>;

export const browserMenuPayloadSchema = z
  .object({
    kind: browserMenuKindSchema,
    origins: z.array(previewOriginSchema).max(32),
    settings: z.lazy(() => browserSettingsSchema),
    viewport: previewViewportIdSchema,
  })
  .strict();
export type BrowserMenuPayload = z.infer<typeof browserMenuPayloadSchema>;

export const browserMenuPickSchema = z
  .object({ choice: z.string().min(1).max(4200).nullable() })
  .strict();
export type BrowserMenuPick = z.infer<typeof browserMenuPickSchema>;

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
  z.object({ action: z.literal('external'), url: previewUrlSchema.optional() }).strict(),
  z.object({ action: z.literal('devtools') }).strict(),
  z.object({ action: z.literal('zoom'), percent: browserZoomPercentSchema }).strict(),
  z.object({ action: z.literal('visible'), visible: z.boolean() }).strict(),
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

export const previewRectSchema = z
  .object({
    x: z.number().int().min(0).max(30_000),
    y: z.number().int().min(0).max(30_000),
    width: z.number().int().min(1).max(30_000),
    height: z.number().int().min(1).max(30_000),
  })
  .strict();
export type PreviewRect = z.infer<typeof previewRectSchema>;

/**
 * What a grabbed element is allowed to carry: identity, geometry, and a picture.
 * No markup, no field values, no attributes beyond role and accessible name.
 */
export const previewPickSchema = z
  .object({
    locator: z.string().min(1).max(200),
    role: z.string().max(40),
    name: z.string().max(80),
    rect: previewRectSchema,
    url: z.string().max(300),
    viewport: previewViewportIdSchema,
    pngBase64: z.string().max(8_000_000).nullable(),
  })
  .strict();
export type PreviewPick = z.infer<typeof previewPickSchema>;

export const previewToolModes = ['grab', 'annotate'] as const;
export const previewToolModeSchema = z.enum(previewToolModes);
export type PreviewToolMode = (typeof previewToolModes)[number];

export const previewPickInputSchema = z.object({ mode: previewToolModeSchema }).strict();
export type PreviewPickInput = z.infer<typeof previewPickInputSchema>;

export const previewAnnotationInputSchema = z
  .object({
    note: z.string().trim().min(1).max(500),
    root: z.string().min(1).max(4096).optional(),
    runId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type PreviewAnnotationInput = z.infer<typeof previewAnnotationInputSchema>;

export const previewDrawSaveInputSchema = z
  .object({
    png: z.instanceof(ArrayBuffer),
    root: z.string().min(1).max(4096).optional(),
    runId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type PreviewDrawSaveInput = z.infer<typeof previewDrawSaveInputSchema>;

/** One-line evidence text for an annotation. Carries no markup or field values. */
export function formatAnnotationDetail(input: {
  readonly index: number;
  readonly note: string;
  readonly pick: PreviewPick;
}): string {
  const { rect, role, name, locator } = input.pick;
  const named = name.length > 0 ? ` "${name}"` : '';
  return (
    `#${String(input.index)} ${input.note} — ${role}${named} ` +
    `@${String(rect.x)},${String(rect.y)} ${String(rect.width)}x${String(rect.height)} ` +
    `[${locator}]`
  ).slice(0, 2000);
}

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
export const browserPickRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: previewPickInputSchema })
  .strict();
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

/* ---------- SETTINGS, SEARCH, PROFILES ---------- */

export const browserSearchEngineIds = ['google', 'duckduckgo', 'bing'] as const;
export const browserSearchEngineIdSchema = z.enum(browserSearchEngineIds);
export type BrowserSearchEngineId = (typeof browserSearchEngineIds)[number];

/**
 * Fixed query endpoints. A strict enum rather than a user-supplied template so
 * omnibox text can never be routed to an arbitrary host.
 */
export const BROWSER_SEARCH_ENGINES = {
  google: {
    id: 'google',
    label: 'Google',
    query: 'https://www.google.com/search?q=',
  },
  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    query: 'https://duckduckgo.com/?q=',
  },
  bing: { id: 'bing', label: 'Bing', query: 'https://www.bing.com/search?q=' },
} as const satisfies Record<
  BrowserSearchEngineId,
  {
    readonly id: BrowserSearchEngineId;
    readonly label: string;
    readonly query: string;
  }
>;

/**
 * Host-shaped input only. Anything with whitespace, or without a plausible
 * host, is a search phrase — never a navigation target.
 */
function looksLikeUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return true;
  // A scheme, unless the colon introduces a port: `localhost:5173` is a host,
  // `javascript:alert(1)` and `data:text/html,…` are not addresses we open.
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(value)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:(?!\d)/.test(value)) return false;
  const host = value.split(/[/?#]/)[0] ?? '';
  if (/^localhost(:\d{1,5})?$/i.test(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(host)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(host);
}

/**
 * Omnibox resolution. A URL navigates; anything else becomes an encoded search
 * on the configured engine. Returns null only for empty or unusable input.
 */
export function resolveOmniboxTarget(
  raw: string,
  engine: BrowserSearchEngineId,
): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (looksLikeUrl(trimmed)) return parsePreviewUrl(trimmed);
  return `${BROWSER_SEARCH_ENGINES[engine].query}${encodeURIComponent(trimmed)}`;
}

export const browserProfileSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(60),
    isDefault: z.boolean(),
    cookieDomains: z.array(z.string().min(1).max(253)).max(50),
    cookieCount: z.number().int().min(0).max(100_000),
    createdAt: z.string().datetime(),
  })
  .strict();
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

/** One persistent Electron partition per profile keeps cookies and cache apart. */
export function browserProfilePartition(profileId: string): string {
  return `persist:builderhelm-browser:${profileId}`;
}

export const browserSettingsSchema = z
  .object({
    homePage: z.string().max(4096),
    searchEngine: browserSearchEngineIdSchema,
    zoomPercent: browserZoomPercentSchema,
    linkRouting: z.boolean(),
    shiftOpensInApp: z.boolean(),
    terminalLinkActions: z.boolean(),
    localhostWorktreeLabels: z.boolean(),
    activeProfileId: z.string().uuid(),
    profiles: z.array(browserProfileSchema).min(1).max(10),
  })
  .strict();
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;

export const browserSettingsUpdateInputSchema = z
  .object({
    homePage: z.string().max(4096).optional(),
    searchEngine: browserSearchEngineIdSchema.optional(),
    zoomPercent: browserZoomPercentSchema.optional(),
    linkRouting: z.boolean().optional(),
    shiftOpensInApp: z.boolean().optional(),
    terminalLinkActions: z.boolean().optional(),
    localhostWorktreeLabels: z.boolean().optional(),
    activeProfileId: z.string().uuid().optional(),
  })
  .strict();
export type BrowserSettingsUpdateInput = z.infer<typeof browserSettingsUpdateInputSchema>;

export const browserProfileCreateInputSchema = z
  .object({ name: z.string().trim().min(1).max(60) })
  .strict();
export type BrowserProfileCreateInput = z.infer<typeof browserProfileCreateInputSchema>;

export const browserProfileDeleteInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export type BrowserProfileDeleteInput = z.infer<typeof browserProfileDeleteInputSchema>;

/** Cookie-Editor JSON export. Unknown keys are dropped rather than trusted. */
export const browserCookieImportItemSchema = z.object({
  domain: z.string().min(1).max(253),
  name: z.string().min(1).max(256),
  value: z.string().max(4096),
  path: z.string().max(1024).optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(['no_restriction', 'lax', 'strict', 'unspecified']).optional(),
  expirationDate: z.number().min(0).max(1e13).optional(),
});
export type BrowserCookieImportItem = z.infer<typeof browserCookieImportItemSchema>;

export const BROWSER_COOKIE_FILE_MAX_BYTES = 2_000_000;
export const BROWSER_COOKIE_MAX_ITEMS = 2000;

export const browserCookieImportFileSchema = z
  .array(browserCookieImportItemSchema)
  .min(1)
  .max(BROWSER_COOKIE_MAX_ITEMS);

export interface BrowserCookieWrite {
  readonly url: string;
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified';
  readonly expirationDate?: number;
}

/**
 * Turn an exported cookie into an Electron cookie write. Returns null when the
 * domain or path cannot be trusted, so a malformed file drops rows instead of
 * writing them to the wrong origin.
 */
export function toBrowserCookieWrite(
  item: BrowserCookieImportItem,
): BrowserCookieWrite | null {
  const host = item.domain.replace(/^\./, '').trim().toLowerCase();
  if (host.length === 0 || /[^a-z0-9.\-:]/.test(host)) return null;
  if (host.startsWith('.') || host.endsWith('.')) return null;
  const path = item.path ?? '/';
  if (!path.startsWith('/') || path.includes('..')) return null;
  const secure = item.secure ?? false;
  const url = `${secure ? 'https' : 'http'}://${host}${path}`;
  if (parsePreviewUrl(url) === null) return null;
  return {
    url,
    name: item.name,
    value: item.value,
    domain: item.domain,
    path,
    secure,
    httpOnly: item.httpOnly ?? false,
    sameSite: item.sameSite ?? 'lax',
    ...(item.expirationDate === undefined ? {} : { expirationDate: item.expirationDate }),
  };
}

export interface CookieImportPlan {
  readonly writes: readonly BrowserCookieWrite[];
  readonly rejected: number;
  readonly domains: readonly string[];
  readonly countByDomain: Readonly<Record<string, number>>;
}

/**
 * Everything the cookie import decides before it touches a cookie store:
 * which rows survive `toBrowserCookieWrite`, how many were dropped, and the
 * per-domain tally the confirmation prompt shows. Pure so the logic the OS
 * dialogs gate is covered by tests rather than only by clicking.
 */
export function planCookieImport(
  items: readonly BrowserCookieImportItem[],
): CookieImportPlan {
  const writes: BrowserCookieWrite[] = [];
  let rejected = 0;
  const countByDomain: Record<string, number> = {};
  for (const item of items) {
    const write = toBrowserCookieWrite(item);
    if (write === null) {
      rejected += 1;
      continue;
    }
    writes.push(write);
    countByDomain[write.domain] = (countByDomain[write.domain] ?? 0) + 1;
  }
  return {
    writes,
    rejected,
    domains: Object.keys(countByDomain).sort(),
    countByDomain,
  };
}

/** Import report. Domains and counts only; a cookie value never leaves main. */
export const browserCookieImportResultSchema = z
  .object({
    profileId: z.string().uuid(),
    imported: z.number().int().min(0),
    rejected: z.number().int().min(0),
    domains: z.array(z.string().min(1).max(253)).max(50),
    cancelled: z.boolean(),
  })
  .strict();
export type BrowserCookieImportResult = z.infer<typeof browserCookieImportResultSchema>;

export const browserSettingsRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const browserSettingsUpdateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: browserSettingsUpdateInputSchema,
  })
  .strict();
export const browserProfileCreateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: browserProfileCreateInputSchema,
  })
  .strict();
export const browserProfileDeleteRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: browserProfileDeleteInputSchema,
  })
  .strict();
export const browserCookieImportRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: browserProfileDeleteInputSchema,
  })
  .strict();

export const browserSettingsIpcResponseSchema = ipcResult(browserSettingsSchema);
export const browserCookieImportIpcResponseSchema = ipcResult(
  browserCookieImportResultSchema,
);

export const browserMenuRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: browserMenuInputSchema })
  .strict();
export const browserMenuIpcResponseSchema = ipcResult(browserMenuResultSchema);

export const browserAnnotateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: previewAnnotationInputSchema,
  })
  .strict();
export const browserDrawSaveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: previewDrawSaveInputSchema })
  .strict();

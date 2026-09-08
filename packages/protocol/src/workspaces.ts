import { z } from 'zod';
import { boardCreateInputSchema, boardSessionSummarySchema } from './board.js';
import { modelErrorSchema } from './model.js';

const path = z.string().min(1).max(4096);
export const workspaceLocationSchema = z
  .object({
    slot: z.number().int().min(0).max(15),
    cwd: path,
    branch: z.string().nullable(),
  })
  .strict();
export const workspaceRecordSchema = z
  .object({
    id: z.string().uuid(),
    root: path,
    baseSha: z.string().nullable(),
    state: z.enum(['provisioning', 'running', 'interrupted', 'closed']),
    request: boardCreateInputSchema,
    summary: boardSessionSummarySchema.nullable(),
    locations: z.array(workspaceLocationSchema).max(16),
    updatedAt: z.string(),
  })
  .strict();
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;
export const workspaceMetaSchema = z
  .object({
    root: path,
    label: z.string().min(1).max(160),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();
export type WorkspaceMeta = z.infer<typeof workspaceMetaSchema>;
export const workspaceSnapshotSchema = z
  .object({
    records: z.array(workspaceRecordSchema).max(1000),
    metadata: z.array(workspaceMetaSchema).max(1000),
    activeId: z.string().uuid().nullable(),
    activePaneId: z.string().uuid().nullable(),
  })
  .strict();
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export const workspaceIdInputSchema = z.object({ id: z.string().uuid() }).strict();
export const workspaceSelectInputSchema = z
  .object({ id: z.string().uuid().nullable(), paneId: z.string().uuid().optional() })
  .strict();
export const workspaceImportInputSchema = z
  .object({ entries: z.array(workspaceMetaSchema).max(128) })
  .strict();
export const editorDraftInputSchema = z
  .object({
    root: path,
    path,
    text: z.string().max(1_000_000),
    baseText: z.string().max(1_000_000),
  })
  .strict();
export type EditorDraftInput = z.infer<typeof editorDraftInputSchema>;
export const editorDraftSchema = editorDraftInputSchema.extend({ updatedAt: z.string() });
export type EditorDraft = z.infer<typeof editorDraftSchema>;
export const editorDraftListInputSchema = z.object({ root: path }).strict();
export const workspaceOrderInputSchema = z
  .object({ id: z.string().uuid(), paneIds: z.array(z.string().uuid()).max(16) })
  .strict();
export const foundationOkSchema = z.object({ saved: z.literal(true) }).strict();
export const foundationResult = <T extends z.ZodType>(schema: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: schema }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
export const workspaceSnapshotResultSchema = foundationResult(workspaceSnapshotSchema);
export const workspaceRecordResultSchema = foundationResult(workspaceRecordSchema);
export const foundationOkResultSchema = foundationResult(foundationOkSchema);
export const editorDraftListResultSchema = foundationResult(
  z.array(editorDraftSchema).max(100),
);
export const FOUNDATION_CHANNELS = {
  snapshot: 'builderhelm:workspaces:snapshot',
  select: 'builderhelm:workspaces:select',
  metadata: 'builderhelm:workspaces:metadata',
  importLegacy: 'builderhelm:workspaces:import',
  restart: 'builderhelm:workspaces:restart',
  order: 'builderhelm:workspaces:order',
  drafts: 'builderhelm:editor:drafts',
  saveDraft: 'builderhelm:editor:save-draft',
} as const;

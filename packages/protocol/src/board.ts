import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

export const boardAgentIds = [
  'claude',
  'codex',
  'opencode',
  'grok',
  'omp',
  'gemini',
  'kimi',
  'custom',
] as const;

export const boardAgentIdSchema = z.enum(boardAgentIds);
export type BoardAgentId = (typeof boardAgentIds)[number];

export interface BoardAgentCatalogEntry {
  readonly id: BoardAgentId;
  readonly label: string;
  readonly command: string;
}

/** Known agent launchers. `custom` panes always require an explicit command. */
export const BOARD_AGENT_CATALOG: readonly BoardAgentCatalogEntry[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude' },
  { id: 'codex', label: 'Codex', command: 'codex' },
  { id: 'opencode', label: 'OpenCode', command: 'opencode' },
  { id: 'grok', label: 'Grok Build', command: 'grok' },
  { id: 'omp', label: 'Oh My Pi', command: 'omp' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
  { id: 'kimi', label: 'Kimi Code', command: 'kimi' },
  { id: 'custom', label: 'Custom command', command: '' },
];

export const boardPaneCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
]);
export type BoardPaneCount = z.infer<typeof boardPaneCountSchema>;

/** Fixed grid per pane count: cols x rows. */
export const boardGridLayouts = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  8: { cols: 4, rows: 2 },
  10: { cols: 5, rows: 2 },
  12: { cols: 4, rows: 3 },
} as const satisfies Record<BoardPaneCount, { cols: number; rows: number }>;

export const boardIsolationSchema = z.enum(['shared', 'worktree']);
export type BoardIsolation = z.infer<typeof boardIsolationSchema>;

export const boardCorrelationSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const boardPaneSpecSchema = z
  .object({
    slot: z.number().int().min(0).max(11),
    agentId: boardAgentIdSchema,
    command: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (pane) =>
      pane.agentId !== 'custom' ||
      (pane.command !== undefined && pane.command.length > 0),
    { message: 'Custom panes require a command' },
  );
export type BoardPaneSpec = z.infer<typeof boardPaneSpecSchema>;

export const boardCreateInputSchema = z
  .object({
    correlationId: boardCorrelationSchema,
    folderPath: z.string().min(1).max(4096),
    paneCount: boardPaneCountSchema,
    isolation: boardIsolationSchema,
    panes: z.array(boardPaneSpecSchema).min(1).max(12),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.panes.length !== input.paneCount) {
      ctx.addIssue({
        code: 'custom',
        message: 'panes length must equal paneCount',
      });
    }
    const slots = new Set(input.panes.map((pane) => pane.slot));
    if (slots.size !== input.panes.length) {
      ctx.addIssue({ code: 'custom', message: 'pane slots must be unique' });
    }
    for (const pane of input.panes) {
      if (pane.slot < 0 || pane.slot >= input.paneCount) {
        ctx.addIssue({ code: 'custom', message: 'pane slot out of range' });
      }
    }
  });
export type BoardCreateInput = z.infer<typeof boardCreateInputSchema>;

export const boardPaneStatusSchema = z.enum(['starting', 'running', 'exited', 'failed']);
export type BoardPaneStatus = z.infer<typeof boardPaneStatusSchema>;

export const boardPaneSummarySchema = z
  .object({
    paneId: z.string().uuid(),
    slot: z.number().int().min(0).max(11),
    agentId: boardAgentIdSchema,
    title: z.string().min(1).max(160),
    status: boardPaneStatusSchema,
    branch: z.string().min(1).max(255).nullable(),
    cwd: z.string().min(1).max(4096),
  })
  .strict();
export type BoardPaneSummary = z.infer<typeof boardPaneSummarySchema>;

export const boardSessionSummarySchema = z
  .object({
    sessionId: z.string().uuid(),
    folderPath: z.string().min(1).max(4096),
    paneCount: boardPaneCountSchema,
    isolation: boardIsolationSchema,
    panes: z.array(boardPaneSummarySchema).min(1).max(12),
  })
  .strict();
export type BoardSessionSummary = z.infer<typeof boardSessionSummarySchema>;

/** Push-only stream from main to renderer. `data` payloads are base64 UTF-8. */
export const boardPaneEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('data'),
      data: z.string().min(1).max(1_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('status'),
      status: boardPaneStatusSchema,
      exitCode: z.number().int().nullable(),
    })
    .strict(),
]);
export type BoardPaneEvent = z.infer<typeof boardPaneEventSchema>;

export const boardPaneEventEnvelopeSchema = z
  .object({
    sessionId: z.string().uuid(),
    paneId: z.string().uuid(),
    event: boardPaneEventSchema,
  })
  .strict();
export type BoardPaneEventEnvelope = z.infer<typeof boardPaneEventEnvelopeSchema>;

export const boardPaneWriteInputSchema = z
  .object({
    correlationId: boardCorrelationSchema,
    sessionId: z.string().uuid(),
    paneId: z.string().uuid(),
    data: z.string().min(1).max(10_000),
  })
  .strict();
export type BoardPaneWriteInput = z.infer<typeof boardPaneWriteInputSchema>;

export const boardPaneResizeInputSchema = z
  .object({
    correlationId: boardCorrelationSchema,
    sessionId: z.string().uuid(),
    paneId: z.string().uuid(),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(300),
  })
  .strict();
export type BoardPaneResizeInput = z.infer<typeof boardPaneResizeInputSchema>;

export const boardPaneCloseInputSchema = z
  .object({
    correlationId: boardCorrelationSchema,
    sessionId: z.string().uuid(),
    paneId: z.string().uuid(),
  })
  .strict();
export type BoardPaneCloseInput = z.infer<typeof boardPaneCloseInputSchema>;

export const boardSelectFolderInputSchema = z
  .object({ correlationId: boardCorrelationSchema })
  .strict();
export type BoardSelectFolderInput = z.infer<typeof boardSelectFolderInputSchema>;

export const boardAgentDetectionSchema = z
  .object({
    id: boardAgentIdSchema,
    label: z.string().min(1).max(80),
    available: z.boolean(),
    path: z.string().max(4096).nullable(),
  })
  .strict();
export type BoardAgentDetection = z.infer<typeof boardAgentDetectionSchema>;

export const boardDetectAgentsInputSchema = z
  .object({ correlationId: boardCorrelationSchema })
  .strict();
export type BoardDetectAgentsInput = z.infer<typeof boardDetectAgentsInputSchema>;

export const boardPresetSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    folderPath: z.string().min(1).max(4096),
    paneCount: boardPaneCountSchema,
    isolation: boardIsolationSchema,
    panes: z.array(boardPaneSpecSchema).min(1).max(12),
  })
  .strict()
  .superRefine((preset, ctx) => {
    if (preset.panes.length !== preset.paneCount) {
      ctx.addIssue({ code: 'custom', message: 'panes length must equal paneCount' });
    }
  });
export type BoardPresetSpec = z.infer<typeof boardPresetSpecSchema>;

export const boardPresetRecordSchema = boardPresetSpecSchema
  .extend({
    id: z.string().uuid(),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();
export type BoardPresetRecord = z.infer<typeof boardPresetRecordSchema>;

export const boardPresetSaveInputSchema = z
  .object({ correlationId: boardCorrelationSchema, preset: boardPresetSpecSchema })
  .strict();
export type BoardPresetSaveInput = z.infer<typeof boardPresetSaveInputSchema>;

export const boardPresetDeleteInputSchema = z
  .object({ correlationId: boardCorrelationSchema, id: z.string().uuid() })
  .strict();
export type BoardPresetDeleteInput = z.infer<typeof boardPresetDeleteInputSchema>;

export const boardLandInputSchema = z
  .object({
    correlationId: boardCorrelationSchema,
    repoPath: z.string().min(1).max(4096),
    branch: z.string().min(1).max(255),
  })
  .strict();
export type BoardLandInput = z.infer<typeof boardLandInputSchema>;

export const boardLandResultSchema = z
  .object({
    landed: z.literal(true),
    head: z.string().min(7).max(64),
  })
  .strict();
export type BoardLandResult = z.infer<typeof boardLandResultSchema>;

export const boardLandPreviewSchema = z
  .object({
    branch: z.string().min(1).max(255),
    base: z.string().min(1).max(255),
    ahead: z.number().int().nonnegative(),
    files: z.array(z.string().min(1).max(4096)).max(500),
    stat: z.string().max(16_000),
    diff: z.string().max(64_000),
  })
  .strict();
export type BoardLandPreview = z.infer<typeof boardLandPreviewSchema>;

function boardIpcResponse<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const boardCreateIpcResponseSchema = boardIpcResponse(boardSessionSummarySchema);
export const boardWriteIpcResponseSchema = boardIpcResponse(
  z.object({ written: z.literal(true) }).strict(),
);
export const boardResizeIpcResponseSchema = boardIpcResponse(
  z.object({ resized: z.literal(true) }).strict(),
);
export const boardPaneCloseIpcResponseSchema = boardIpcResponse(
  z.object({ closed: z.literal(true) }).strict(),
);
export const boardSelectFolderIpcResponseSchema = boardIpcResponse(z.string().nullable());
export const boardDetectAgentsIpcResponseSchema = boardIpcResponse(
  z.array(boardAgentDetectionSchema),
);
export const boardPresetListIpcResponseSchema = boardIpcResponse(
  z.array(boardPresetRecordSchema),
);
export const boardPresetSaveIpcResponseSchema = boardIpcResponse(boardPresetRecordSchema);
export const boardPresetDeleteIpcResponseSchema = boardIpcResponse(
  z.object({ deleted: z.literal(true) }).strict(),
);
export const boardLandIpcResponseSchema = boardIpcResponse(boardLandResultSchema);
export const boardLandPreviewIpcResponseSchema = boardIpcResponse(boardLandPreviewSchema);

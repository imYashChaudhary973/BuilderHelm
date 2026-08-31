import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const searchCommandSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(80),
    hint: z.string().min(1).max(120),
    to: z.string().min(1).max(200),
  })
  .strict();
export type SearchCommand = z.infer<typeof searchCommandSchema>;

export const SEARCH_COMMANDS: readonly SearchCommand[] = [
  { id: 'new-space', title: 'New Space', hint: 'Start a terminal workspace', to: '/' },
  {
    id: 'swarm',
    title: 'BuilderHelm Swarm',
    hint: 'Coordinated multi-agent run',
    to: '/swarm',
  },
  { id: 'board', title: 'BuilderHelm Board', hint: 'Tasks and intake', to: '/board' },
  { id: 'memory', title: 'BuilderHelm Memory', hint: 'Cited local vault', to: '/memory' },
  { id: 'notes', title: 'Notes', hint: 'Project notes beside the Board', to: '/notes' },
  { id: 'settings', title: 'Settings', hint: 'Voice and browser', to: '/settings/voice' },
  {
    id: 'usage',
    title: 'Accounts and usage',
    hint: 'Installed CLIs and reported usage',
    to: '/settings/usage',
  },
  {
    id: 'tools',
    title: 'Tools panel',
    hint: 'Editor, Git, Browser, Review',
    to: 'tools',
  },
];

export const searchFileHitSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    name: z.string().min(1).max(255),
    kind: z.enum(['file', 'dir']),
  })
  .strict();
export type SearchFileHit = z.infer<typeof searchFileHitSchema>;

export const searchCardHitSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    workspace: z.string().min(1).max(4_096),
    projectName: z.string().min(1).max(120),
    column: z.string().min(1).max(32),
  })
  .strict();
export type SearchCardHit = z.infer<typeof searchCardHitSchema>;

export const searchMemoryHitSchema = z
  .object({
    vaultId: z.string().uuid(),
    vaultName: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    path: z.string().min(1).max(4_096),
    excerpt: z.string().max(1_000),
  })
  .strict();
export type SearchMemoryHit = z.infer<typeof searchMemoryHitSchema>;

export const searchNoteHitSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    workspace: z.string().min(1).max(4_096),
  })
  .strict();
export type SearchNoteHit = z.infer<typeof searchNoteHitSchema>;

export const searchQueryInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    root: z.string().min(1).max(4_096).nullable(),
    limit: z.number().int().min(1).max(80).optional(),
  })
  .strict();
export type SearchQueryInput = z.infer<typeof searchQueryInputSchema>;

export const searchQueryResultSchema = z
  .object({
    files: z.array(searchFileHitSchema).max(80),
    cards: z.array(searchCardHitSchema).max(40),
    memory: z.array(searchMemoryHitSchema).max(40),
    notes: z.array(searchNoteHitSchema).max(40),
  })
  .strict();
export type SearchQueryResult = z.infer<typeof searchQueryResultSchema>;

export const searchQueryRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: searchQueryInputSchema })
  .strict();
export const searchCancelRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: z.object({}).strict() })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const searchQueryIpcResponseSchema = ipcResult(searchQueryResultSchema);
export const searchCancelIpcResponseSchema = ipcResult(
  z.object({ cancelled: z.literal(true) }),
);

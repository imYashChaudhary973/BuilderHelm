import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

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

export const CONNECTION_KINDS = ['apify', 'x-write'] as const;
export const connectionKindSchema = z.enum(CONNECTION_KINDS);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const CONNECTOR_TOOLS = ['apify.research', 'x.publish'] as const;
export const connectorToolIdSchema = z.enum(CONNECTOR_TOOLS);
export type ConnectorToolId = z.infer<typeof connectorToolIdSchema>;

export const connectionTransportSchema = z.enum(['https']);
export const discoveredToolSchema = z
  .object({
    name: connectorToolIdSchema,
    description: z.string().min(1).max(500),
    risk: z.literal('external_side_effect'),
  })
  .strict();
export type DiscoveredTool = z.infer<typeof discoveredToolSchema>;

export const connectionRecordSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    kind: connectionKindSchema,
    transport: connectionTransportSchema,
    endpoint: z.string().url().max(2048),
    authRef: z.string().min(1).max(200),
    enabled: z.boolean(),
    schemaVersion: z.string().min(1).max(128),
    schemaHash: z.string().min(1).max(64),
    tools: z.array(discoveredToolSchema).max(8),
    lastTestAt: z.string().datetime().nullable(),
    lastTestOk: z.boolean().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ConnectionRecord = z.infer<typeof connectionRecordSchema>;

export const connectionGrantSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
    toolName: connectorToolIdSchema,
    schemaHash: z.string().min(1).max(64),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ConnectionGrant = z.infer<typeof connectionGrantSchema>;

export const skillProvenanceSchema = z.enum(['local', 'reviewed']);
export const skillRecordSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    version: z.string().min(1).max(32),
    provenance: skillProvenanceSchema,
    body: z.string().min(1).max(20_000),
    capabilities: z.array(connectorToolIdSchema).max(8),
    createdAt: z.string().datetime(),
  })
  .strict();
export type SkillRecord = z.infer<typeof skillRecordSchema>;

export const skillBindingSchema = z
  .object({
    skillId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
    createdAt: z.string().datetime(),
  })
  .strict();
export type SkillBinding = z.infer<typeof skillBindingSchema>;

export const connectorJobStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'outcomeUnknown',
]);
export const researchSourceSchema = z
  .object({
    id: z.string().min(1).max(200),
    url: z.string().url().max(2048),
    author: z.string().max(200),
    text: z.string().max(2_000),
    postedAt: z.string().max(64),
  })
  .strict();
export type ResearchSource = z.infer<typeof researchSourceSchema>;

export const connectorJobSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    connectionId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
    toolName: connectorToolIdSchema,
    remoteJobId: z.string().min(1).max(200).nullable(),
    status: connectorJobStatusSchema,
    costLimitUsd: z.number().nonnegative(),
    destination: z.string().min(1).max(300),
    report: z.string().max(20_000).nullable(),
    sources: z.array(researchSourceSchema).max(50),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ConnectorJob = z.infer<typeof connectorJobSchema>;

export const socialContentManagerSchema = z
  .object({
    skillId: z.string().uuid(),
    name: z.literal('Social Content Manager'),
    instructions: z.string().min(1).max(20_000),
  })
  .strict();
export type SocialContentManager = z.infer<typeof socialContentManagerSchema>;

export const connectionsSnapshotSchema = z
  .object({
    connections: z.array(connectionRecordSchema),
    grants: z.array(connectionGrantSchema),
    skills: z.array(skillRecordSchema),
    bindings: z.array(skillBindingSchema),
    jobs: z.array(connectorJobSchema),
    socialContentManager: socialContentManagerSchema,
    sessionMcpServers: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            transport: connectionTransportSchema,
            endpoint: z.string().url().max(2048),
            tools: z.array(connectorToolIdSchema),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type ConnectionsSnapshot = z.infer<typeof connectionsSnapshotSchema>;

export const connectionConnectInputSchema = z
  .object({
    kind: connectionKindSchema,
    token: z.string().trim().min(8).max(500).regex(/^\S+$/),
  })
  .strict();
export type ConnectionConnectInput = z.infer<typeof connectionConnectInputSchema>;

export const connectionIdInputSchema = z
  .object({ connectionId: z.string().uuid() })
  .strict();
export type ConnectionIdInput = z.infer<typeof connectionIdInputSchema>;

export const connectionGrantInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
    toolName: connectorToolIdSchema,
    enabled: z.boolean(),
  })
  .strict();
export type ConnectionGrantInput = z.infer<typeof connectionGrantInputSchema>;

export const apifyResearchInputSchema = z
  .object({
    requestId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
    topic: z.string().trim().min(1).max(200),
    since: z.string().min(10).max(40),
    until: z.string().min(10).max(40),
    limit: z.number().int().min(1).max(25),
    costLimitUsd: z.number().positive().max(20),
    approved: z.literal(true),
  })
  .strict();
export type ApifyResearchInput = z.infer<typeof apifyResearchInputSchema>;

export const xPublishInputSchema = z
  .object({
    requestId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
    text: z.string().trim().min(1).max(280),
    account: z.string().trim().min(1).max(80),
    approved: z.literal(true),
  })
  .strict();
export type XPublishInput = z.infer<typeof xPublishInputSchema>;

export const skillCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(32),
    body: z.string().trim().min(1).max(20_000),
    provenance: skillProvenanceSchema.default('local'),
    capabilities: z.array(connectorToolIdSchema).max(8).default([]),
  })
  .strict();
export type SkillCreateInput = z.input<typeof skillCreateInputSchema>;

export const skillBindInputSchema = z
  .object({
    skillId: z.string().uuid(),
    profileId: z.string().min(1).max(80),
  })
  .strict();
export type SkillBindInput = z.infer<typeof skillBindInputSchema>;

export const mcpRoleSchema = z.enum(['agent', 'control']);
export const mcpControlInputSchema = z
  .object({
    role: mcpRoleSchema,
    profileId: z.string().min(1).max(80).nullable(),
    message: z.unknown(),
  })
  .strict();
export type McpControlInput = z.infer<typeof mcpControlInputSchema>;

export const mcpControlResultSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type McpControlResult = z.infer<typeof mcpControlResultSchema>;

const emptyInput = z.object({}).strict();
export const connectionsSnapshotRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: emptyInput })
  .strict();
export const connectionConnectRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: connectionConnectInputSchema,
  })
  .strict();
export const connectionIdRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: connectionIdInputSchema })
  .strict();
export const connectionGrantRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: connectionGrantInputSchema,
  })
  .strict();
export const apifyResearchRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: apifyResearchInputSchema })
  .strict();
export const xPublishRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: xPublishInputSchema })
  .strict();
export const skillCreateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: skillCreateInputSchema })
  .strict();
export const skillBindRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: skillBindInputSchema })
  .strict();
export const mcpControlRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: mcpControlInputSchema })
  .strict();

export const connectionsSnapshotIpcResponseSchema = ipcResult(connectionsSnapshotSchema);
export const connectionRecordIpcResponseSchema = ipcResult(connectionRecordSchema);
export const connectionGrantIpcResponseSchema = ipcResult(
  connectionGrantSchema.nullable(),
);
export const connectorJobIpcResponseSchema = ipcResult(connectorJobSchema);
export const skillRecordIpcResponseSchema = ipcResult(skillRecordSchema);
export const mcpControlIpcResponseSchema = ipcResult(mcpControlResultSchema);

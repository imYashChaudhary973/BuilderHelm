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
export const REMOTE_PROTOCOL_VERSION = 1 as const;
export const REMOTE_DEFAULT_PORT = 17_832 as const;
export const REMOTE_SCOPES = ['observe', 'instruct', 'approve', 'cancel'] as const;
export const remoteScopeSchema = z.enum(REMOTE_SCOPES);
export type RemoteScope = z.infer<typeof remoteScopeSchema>;

export const remoteBindSchema = z.enum(['loopback', 'private']);
export type RemoteBind = z.infer<typeof remoteBindSchema>;

export const remoteCommandSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().uuid(), type: z.literal('status') }).strict(),
  z.object({ id: z.string().uuid(), type: z.literal('artifacts') }).strict(),
  z
    .object({
      id: z.string().uuid(),
      type: z.literal('instruct'),
      runId: z.string().uuid(),
      text: z.string().min(1).max(4_000),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      type: z.literal('approve'),
      requestId: z.string().uuid(),
      decision: z.enum(['allow', 'deny']),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      type: z.literal('cancel'),
      runId: z.string().uuid(),
    })
    .strict(),
]);
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;

export const remoteStatusSchema = z
  .object({
    hostAuthoritative: z.literal(true),
    lifetime: z.literal('desktop-open'),
    run: z
      .object({
        id: z.string().uuid(),
        status: z.string().min(1).max(40),
      })
      .nullable(),
    pendingApprovals: z.array(
      z
        .object({
          requestId: z.string().uuid(),
          summary: z.string().max(400),
        })
        .strict(),
    ),
  })
  .strict();
export type RemoteStatus = z.infer<typeof remoteStatusSchema>;

export const remoteArtifactSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.string().min(1).max(40),
    url: z.string().max(2_000),
    headSha: z.string().max(64),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();
export type RemoteArtifact = z.infer<typeof remoteArtifactSchema>;

export const remoteEventSchema = z
  .object({
    seq: z.number().int().positive(),
    type: z.enum(['command', 'status', 'artifact', 'approval']),
    payload: z.unknown(),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();
export type RemoteEvent = z.infer<typeof remoteEventSchema>;

export const remoteSessionSchema = z
  .object({
    id: z.string().uuid(),
    clientLabel: z.string().min(1).max(80),
    scopes: z.array(remoteScopeSchema).min(1),
    createdAt: z.string().datetime({ offset: false }),
    lastSeenAt: z.string().datetime({ offset: false }),
    revokedAt: z.string().datetime({ offset: false }).nullable(),
  })
  .strict();
export type RemoteSession = z.infer<typeof remoteSessionSchema>;

export const remoteAuditSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    commandId: z.string().uuid().nullable(),
    action: z.string().min(1).max(40),
    outcome: z.enum(['ok', 'denied', 'replayed', 'error']),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict();
export type RemoteAudit = z.infer<typeof remoteAuditSchema>;

export const remotePairingOfferSchema = z
  .object({
    code: z.string().min(6).max(16),
    expiresAt: z.string().datetime({ offset: false }),
    fingerprint: z.string().min(8).max(64),
    hostPublicKey: z.string().min(1).max(200),
    addresses: z.array(z.string().min(1).max(80)).min(1),
    protocolVersion: z.literal(REMOTE_PROTOCOL_VERSION),
  })
  .strict();
export type RemotePairingOffer = z.infer<typeof remotePairingOfferSchema>;

export const remoteSnapshotSchema = z
  .object({
    fingerprint: z.string().min(8).max(64),
    listening: z.boolean(),
    bind: remoteBindSchema,
    port: z.number().int().min(0).max(65_535).nullable(),
    addresses: z.array(z.string().min(1).max(80)),
    pairing: remotePairingOfferSchema.nullable(),
    sessions: z.array(remoteSessionSchema),
    audit: z.array(remoteAuditSchema),
    hostMustRemainRunning: z.literal(true),
  })
  .strict();
export type RemoteSnapshot = z.infer<typeof remoteSnapshotSchema>;

export const remoteListenInputSchema = z.object({ bind: remoteBindSchema }).strict();
export type RemoteListenInput = z.infer<typeof remoteListenInputSchema>;

export const remoteRevokeInputSchema = z
  .object({ sessionId: z.string().uuid() })
  .strict();
export type RemoteRevokeInput = z.infer<typeof remoteRevokeInputSchema>;

const emptyInput = z.object({}).strict();
export const remoteSnapshotRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: emptyInput })
  .strict();
export const remoteListenRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: remoteListenInputSchema })
  .strict();
export const remoteStopRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: emptyInput })
  .strict();
export const remotePairOfferRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: emptyInput })
  .strict();
export const remoteRevokeRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: remoteRevokeInputSchema })
  .strict();

export const remoteSnapshotIpcResponseSchema = ipcResult(remoteSnapshotSchema);
export const remotePairingIpcResponseSchema = ipcResult(remotePairingOfferSchema);
export const remoteSessionIpcResponseSchema = ipcResult(remoteSessionSchema);

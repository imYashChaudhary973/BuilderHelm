import { createId, utcNow, type CorrelationId, type ZeroId } from '@zero/shared';
import { z } from 'zod';

import { jsonValueSchema, type JsonValue } from './json.js';

export const actorRefSchema = z.object({
  type: z.enum(['user', 'system', 'agent', 'automation', 'integration']),
  id: z.string().min(1).optional(),
});

export const zeroEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  occurredAt: z.string().datetime({ offset: false }),
  actor: actorRefSchema.optional(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  payload: jsonValueSchema,
});

export type ActorRef = z.infer<typeof actorRefSchema>;
export type ZeroEvent = z.infer<typeof zeroEventSchema>;

export interface CreateEventInput {
  readonly type: string;
  readonly correlationId: CorrelationId;
  readonly payload: JsonValue;
  readonly actor?: ActorRef;
  readonly causationId?: ZeroId;
}

export function createEvent(input: CreateEventInput): ZeroEvent {
  return zeroEventSchema.parse({
    id: createId(),
    type: input.type,
    occurredAt: utcNow(),
    correlationId: input.correlationId,
    payload: input.payload,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  });
}

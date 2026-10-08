import { z } from 'zod';
import { usageReportInputSchema, usageReportSchema } from '@builderhelm/protocol/usage';
import { quotaProviderIdSchema } from '@builderhelm/protocol/accounts';

export const usageWorkerRequestSchema = z
  .object({
    id: z.string().uuid(),
    input: usageReportInputSchema,
    logins: z
      .array(
        z
          .object({
            provider: quotaProviderIdSchema,
            accountRef: z.string().min(1).max(128),
            label: z.string().max(200),
            root: z.string().min(1).max(4096),
            identity: z.string().max(512).nullable(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict();
export const usageWorkerResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({ id: z.string().uuid(), ok: z.literal(true), value: usageReportSchema })
    .strict(),
  z.object({ id: z.string().uuid(), ok: z.literal(false) }).strict(),
]);

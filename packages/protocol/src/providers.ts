import type { CorrelationId } from '@zero/shared';
import { z } from 'zod';

import {
  modelCapabilityOverrideRecordSchema,
  modelCapabilityOverridesSchema,
  modelErrorSchema,
  modelRecordSchema,
  modelRefSchema,
} from './model.js';

export const providerProtocols = [
  'openai',
  'anthropic',
  'openai-compatible',
  'anthropic-compatible',
  'ollama',
  'litellm',
  'custom',
] as const;

export const providerProtocolSchema = z.enum(providerProtocols);

const sensitiveHeaderName =
  /(?:authorization|cookie|credential|api[-_]?key|token|secret)/i;

export const providerHeaderSchema = z
  .discriminatedUnion('source', [
    z
      .object({
        name: z.string().trim().min(1).max(100),
        source: z.literal('static'),
        value: z.string().max(2_000),
      })
      .strict(),
    z
      .object({
        name: z.string().trim().min(1).max(100),
        source: z.literal('secret'),
        secretRef: z.string().trim().min(1).max(200),
      })
      .strict(),
  ])
  .superRefine((header, context) => {
    if (header.source === 'static' && sensitiveHeaderName.test(header.name)) {
      context.addIssue({
        code: 'custom',
        message: 'Sensitive headers must reference secure storage',
        path: ['source'],
      });
    }
  });

export const providerPrivacySchema = z
  .object({
    allowPersonal: z.boolean().default(true),
    allowSensitive: z.boolean().default(false),
    allowHealth: z.boolean().default(false),
  })
  .strict();

const providerFields = {
  label: z.string().trim().min(1).max(100),
  protocol: providerProtocolSchema,
  baseUrl: z
    .union([z.url().startsWith('https://'), z.url().startsWith('http://')])
    .nullable(),
  headers: z.array(providerHeaderSchema).max(20),
  privacy: providerPrivacySchema,
  enabled: z.boolean(),
} as const;

export const createProviderInputSchema = z
  .object({
    ...providerFields,
    apiKey: z.string().max(16_384),
  })
  .strict()
  .superRefine((provider, context) => {
    if (provider.protocol !== 'ollama' && provider.apiKey.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'An API key is required for this protocol',
        path: ['apiKey'],
      });
    }
    if (provider.protocol === 'openai-compatible' && provider.baseUrl === null) {
      context.addIssue({
        code: 'custom',
        message: 'An explicit base URL is required for this protocol',
        path: ['baseUrl'],
      });
    }
  });

export const updateProviderInputSchema = z
  .object({
    id: z.string().uuid(),
    ...providerFields,
    apiKey: z.string().max(16_384).optional(),
  })
  .strict()
  .superRefine((provider, context) => {
    if (
      provider.protocol !== 'ollama' &&
      provider.apiKey !== undefined &&
      provider.apiKey.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An API key cannot be empty for this protocol',
        path: ['apiKey'],
      });
    }
    if (provider.protocol === 'openai-compatible' && provider.baseUrl === null) {
      context.addIssue({
        code: 'custom',
        message: 'An explicit base URL is required for this protocol',
        path: ['baseUrl'],
      });
    }
  });

export const deleteProviderInputSchema = z.object({ id: z.string().uuid() }).strict();

export const providerSummarySchema = z
  .object({
    id: z.string().uuid(),
    label: z.string(),
    protocol: providerProtocolSchema,
    baseUrl: z.string().nullable(),
    headers: z.array(providerHeaderSchema),
    privacy: providerPrivacySchema,
    enabled: z.boolean(),
    hasCredential: z.literal(true),
    createdAt: z.string().datetime({ offset: false }),
    updatedAt: z.string().datetime({ offset: false }),
  })
  .strict();

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

export const providerListRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const providerCreateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: createProviderInputSchema })
  .strict();
export const providerUpdateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: updateProviderInputSchema })
  .strict();
export const providerDeleteRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: deleteProviderInputSchema })
  .strict();

export const providerOperationInputSchema = z
  .object({ providerId: z.string().uuid() })
  .strict();
export const modelListInputSchema = z
  .object({ providerId: z.string().uuid().optional() })
  .strict();
export const modelCapabilityOverrideListInputSchema = z
  .object({ providerId: z.string().uuid().optional() })
  .strict();
export const modelCapabilityOverrideUpdateInputSchema = z
  .object({
    modelRef: modelRefSchema,
    overrides: modelCapabilityOverridesSchema,
  })
  .strict();
export const providerTestConnectionRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: providerOperationInputSchema })
  .strict();
export const providerDiscoverModelsRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: providerOperationInputSchema })
  .strict();
export const modelListRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: modelListInputSchema })
  .strict();
export const modelCapabilityOverrideListRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: modelCapabilityOverrideListInputSchema,
  })
  .strict();
export const modelCapabilityOverrideUpdateRequestSchema = z
  .object({
    correlationId: correlationIdSchema,
    input: modelCapabilityOverrideUpdateInputSchema,
  })
  .strict();

export const providerListResponseSchema = z.array(providerSummarySchema);
export const providerMutationResponseSchema = providerSummarySchema;
export const providerDeleteResponseSchema = z
  .object({ deleted: z.literal(true) })
  .strict();
export const providerConnectionResultSchema = z
  .object({ ok: z.literal(true), latencyMs: z.number().int().nonnegative() })
  .strict();
export const modelListResponseSchema = z.array(modelRecordSchema);
export const modelCapabilityOverrideListResponseSchema = z.array(
  modelCapabilityOverrideRecordSchema,
);
export const providerTestConnectionIpcResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: providerConnectionResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
]);
export const modelListIpcResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: modelListResponseSchema }).strict(),
  z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
]);
export const modelCapabilityOverrideListIpcResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({ ok: z.literal(true), value: modelCapabilityOverrideListResponseSchema })
    .strict(),
  z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
]);
export const modelCapabilityOverrideUpdateIpcResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: modelRecordSchema }).strict(),
  z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
]);

export type ProviderProtocol = z.infer<typeof providerProtocolSchema>;
export type ProviderHeader = z.infer<typeof providerHeaderSchema>;
export type ProviderPrivacy = z.infer<typeof providerPrivacySchema>;
export type CreateProviderInput = z.infer<typeof createProviderInputSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderInputSchema>;
export type DeleteProviderInput = z.infer<typeof deleteProviderInputSchema>;
export type ProviderSummary = z.infer<typeof providerSummarySchema>;
export type ProviderOperationInput = z.infer<typeof providerOperationInputSchema>;
export type ModelListInput = z.infer<typeof modelListInputSchema>;
export type ModelCapabilityOverrideListInput = z.infer<
  typeof modelCapabilityOverrideListInputSchema
>;
export type ModelCapabilityOverrideUpdateInput = z.infer<
  typeof modelCapabilityOverrideUpdateInputSchema
>;
export type ProviderConnectionResult = z.infer<typeof providerConnectionResultSchema>;

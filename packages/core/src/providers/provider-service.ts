import type {
  ProviderRepository,
  AuditEventWrite,
  ProviderWrite,
  StoredProvider,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  createProviderInputSchema,
  providerHeaderSchema,
  providerSummarySchema,
  updateProviderInputSchema,
  type CreateProviderInput,
  type ProviderHeader,
  type ProviderSummary,
  type UpdateProviderInput,
} from '@builderhelm/protocol';
import {
  createId,
  utcNow,
  BuilderHelmError,
  type CorrelationId,
} from '@builderhelm/shared';

import {
  BUILDERHELM_KEYCHAIN_SERVICE,
  type SecretStore,
} from '../secrets/secret-store.js';

function parseHeaders(value: string): ProviderHeader[] {
  const parsed: unknown = JSON.parse(value);
  return providerHeaderSchema.array().parse(parsed);
}

function toSummary(provider: StoredProvider): ProviderSummary {
  return providerSummarySchema.parse({
    id: provider.id,
    label: provider.label,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    headers: parseHeaders(provider.headersJson),
    privacy: {
      allowPersonal: provider.allowPersonal === 1,
      allowSensitive: provider.allowSensitive === 1,
      allowHealth: provider.allowHealth === 1,
    },
    enabled: provider.enabled === 1,
    hasCredential: true,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  });
}

function providerWrite(
  input: CreateProviderInput | UpdateProviderInput,
  id: string,
  secretRef: string,
  createdAt: string,
  updatedAt: string,
): ProviderWrite {
  return {
    id,
    label: input.label,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    secretRef,
    headersJson: JSON.stringify(input.headers),
    allowPersonal: input.privacy.allowPersonal,
    allowSensitive: input.privacy.allowSensitive,
    allowHealth: input.privacy.allowHealth,
    enabled: input.enabled,
    createdAt,
    updatedAt,
  };
}

function auditEvent(
  eventType: string,
  correlationId: CorrelationId,
  providerId: string,
  before: ProviderSummary | null,
  after: ProviderSummary | null,
): AuditEventWrite {
  return {
    id: createId(),
    eventType,
    actorType: 'user',
    actorId: null,
    correlationId,
    riskLevel: 'destructive_sensitive',
    resourceRefsJson: JSON.stringify([{ type: 'provider', id: providerId }]),
    beforeJson: before === null ? null : JSON.stringify(before),
    afterJson: after === null ? null : JSON.stringify(after),
    approvalId: null,
    createdAt: utcNow(),
  };
}

function missingProvider(): BuilderHelmError {
  return new BuilderHelmError('VALIDATION_FAILED', 'Provider was not found');
}

export class ProviderService {
  constructor(
    private readonly repository: ProviderRepository,
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
  ) {}

  list(): ProviderSummary[] {
    return this.repository.list().map(toSummary);
  }

  async create(
    rawInput: CreateProviderInput,
    correlationId: CorrelationId,
  ): Promise<ProviderSummary> {
    const input = createProviderInputSchema.parse(rawInput);
    const id = createId();
    const secretRef = `builderhelm.provider.${id}.api-key`;
    const now = utcNow();
    const write = providerWrite(input, id, secretRef, now, now);
    const summary = toSummary({
      ...write,
      allowPersonal: Number(write.allowPersonal),
      allowSensitive: Number(write.allowSensitive),
      allowHealth: Number(write.allowHealth),
      enabled: Number(write.enabled),
    });

    await this.secrets.set(secretRef, input.apiKey);
    try {
      this.repository.create(
        write,
        {
          ref: secretRef,
          providerId: id,
          service: BUILDERHELM_KEYCHAIN_SERVICE,
          createdAt: now,
          updatedAt: now,
        },
        auditEvent('provider.created', correlationId, id, null, summary),
      );
    } catch (cause) {
      await this.secrets.delete(secretRef);
      throw new BuilderHelmError('DATABASE_FAILED', 'Failed to save provider settings', {
        cause,
      });
    }

    this.logger.info({
      event: 'provider.created',
      correlationId,
      data: { providerId: id, protocol: input.protocol },
    });
    return summary;
  }

  async update(
    rawInput: UpdateProviderInput,
    correlationId: CorrelationId,
  ): Promise<ProviderSummary> {
    const input = updateProviderInputSchema.parse(rawInput);
    const current = this.repository.findById(input.id);
    if (current === undefined) throw missingProvider();

    const before = toSummary(current);
    const now = utcNow();
    const write = providerWrite(
      input,
      current.id,
      current.secretRef,
      current.createdAt,
      now,
    );
    const after = toSummary({
      ...write,
      allowPersonal: Number(write.allowPersonal),
      allowSensitive: Number(write.allowSensitive),
      allowHealth: Number(write.allowHealth),
      enabled: Number(write.enabled),
    });
    const previousSecret =
      input.apiKey === undefined ? null : await this.secrets.get(current.secretRef);

    if (input.apiKey !== undefined)
      await this.secrets.set(current.secretRef, input.apiKey);
    try {
      this.repository.update(
        write,
        auditEvent('provider.updated', correlationId, current.id, before, after),
        input.apiKey !== undefined,
      );
    } catch (cause) {
      if (input.apiKey !== undefined) {
        if (previousSecret === null) await this.secrets.delete(current.secretRef);
        else await this.secrets.set(current.secretRef, previousSecret);
      }
      throw new BuilderHelmError(
        'DATABASE_FAILED',
        'Failed to update provider settings',
        {
          cause,
        },
      );
    }

    this.logger.info({
      event: 'provider.updated',
      correlationId,
      data: { providerId: current.id, credentialChanged: input.apiKey !== undefined },
    });
    return after;
  }

  async delete(id: string, correlationId: CorrelationId): Promise<{ deleted: true }> {
    const current = this.repository.findById(id);
    if (current === undefined) throw missingProvider();

    const previousSecret = await this.secrets.get(current.secretRef);
    if (previousSecret === null) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Provider credential is unavailable',
      );
    }

    await this.secrets.delete(current.secretRef);
    try {
      this.repository.delete(
        current.id,
        auditEvent(
          'provider.deleted',
          correlationId,
          current.id,
          toSummary(current),
          null,
        ),
      );
    } catch (cause) {
      await this.secrets.set(current.secretRef, previousSecret);
      throw new BuilderHelmError(
        'DATABASE_FAILED',
        'Failed to delete provider settings',
        {
          cause,
        },
      );
    }

    this.logger.info({
      event: 'provider.deleted',
      correlationId,
      data: { providerId: current.id },
    });
    return { deleted: true };
  }
}

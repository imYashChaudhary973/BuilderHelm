import {
  ModelGateway,
  OpenAIResponsesAdapter,
  type GatewayFetch,
  type ProviderConnectionResult,
} from '@zero/model-gateway';
import type { Logger } from '@zero/observability';
import {
  modelRecordSchema,
  providerHeaderSchema,
  providerProtocolSchema,
  type ModelRecord,
  type ProviderHeader,
} from '@zero/protocol';
import { normalizeError, utcNow, ZeroError, type CorrelationId } from '@zero/shared';
import type {
  ModelRepository,
  ModelWrite,
  ProviderRepository,
  StoredModel,
  StoredProvider,
} from '@zero/db';

import type { SecretStore } from '../secrets/secret-store.js';

const providerRequestTimeoutMs = 15_000;

function parseHeaders(value: string): ProviderHeader[] {
  const parsed: unknown = JSON.parse(value);
  return providerHeaderSchema.array().parse(parsed);
}

function storedModelToRecord(model: StoredModel): ModelRecord {
  const metadata: unknown = JSON.parse(model.metadataJson);
  const tags = modelRecordSchema.shape.tags.parse(
    typeof metadata === 'object' && metadata !== null && 'tags' in metadata
      ? metadata.tags
      : [],
  );

  return modelRecordSchema.parse({
    ref: model.id,
    providerId: model.providerId,
    modelId: model.modelId,
    label: model.label,
    capabilities: {
      text: model.text === 1,
      vision: model.vision === 1,
      audioInput: model.audioInput === 1,
      toolCalling: model.toolCalling === 1,
      parallelTools: model.parallelTools === 1,
      structuredOutput: model.structuredOutput === 1,
      streaming: model.streaming === 1,
      reasoningControls: model.reasoningControls === 1,
      serverWebSearch: model.serverWebSearch === 1,
      serverMcp: model.serverMcp === 1,
      ...(model.contextWindow === null ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxOutputTokens === null
        ? {}
        : { maxOutputTokens: model.maxOutputTokens }),
    },
    privacyClass: model.privacyClass,
    tags,
  });
}

function modelWrite(model: ModelRecord, occurredAt: string): ModelWrite {
  return {
    id: model.ref,
    providerId: model.providerId,
    modelId: model.modelId,
    label: model.label,
    privacyClass: model.privacyClass,
    enabled: true,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    capabilities: {
      ...model.capabilities,
      contextWindow: model.capabilities.contextWindow ?? null,
      maxOutputTokens: model.capabilities.maxOutputTokens ?? null,
      metadataJson: JSON.stringify({ tags: model.tags }),
    },
  };
}

function assertUniqueModels(models: readonly ModelRecord[]): void {
  const refs = new Set<string>();
  for (const model of models) {
    if (refs.has(model.ref)) {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'Provider returned duplicate model identifiers',
      );
    }
    refs.add(model.ref);
  }
}

export class ModelService {
  private readonly gateway: ModelGateway;

  constructor(
    private readonly providers: ProviderRepository,
    private readonly models: ModelRepository,
    secrets: SecretStore,
    private readonly logger: Logger,
    private readonly fetcher: GatewayFetch = fetch,
  ) {
    this.gateway = new ModelGateway({ resolve: (ref) => secrets.get(ref) });
  }

  list(providerId?: string): ModelRecord[] {
    try {
      return this.models.list(providerId).map(storedModelToRecord);
    } catch (cause) {
      throw new ZeroError('DATABASE_FAILED', 'Failed to read stored models', { cause });
    }
  }

  async testConnection(
    providerId: string,
    correlationId: CorrelationId,
    signal: AbortSignal = AbortSignal.timeout(providerRequestTimeoutMs),
  ): Promise<ProviderConnectionResult> {
    this.register(providerId);
    try {
      const result = await this.gateway.testConnection(providerId, signal);
      this.logger.info({
        event: 'provider.connection_tested',
        correlationId,
        data: { providerId, latencyMs: result.latencyMs },
      });
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      this.logger.warn({
        event: 'provider.connection_failed',
        correlationId,
        data: { providerId, code: normalized.code },
      });
      throw normalized;
    }
  }

  async discover(
    providerId: string,
    correlationId: CorrelationId,
    signal: AbortSignal = AbortSignal.timeout(providerRequestTimeoutMs),
  ): Promise<ModelRecord[]> {
    this.register(providerId);
    let discovered: ModelRecord[];
    try {
      discovered = await this.gateway.discoverModels(providerId, signal);
      assertUniqueModels(discovered);
    } catch (error) {
      const normalized = normalizeError(error);
      this.logger.warn({
        event: 'provider.discovery_failed',
        correlationId,
        data: { providerId, code: normalized.code },
      });
      throw normalized;
    }

    const occurredAt = utcNow();
    try {
      this.models.replaceForProvider(
        providerId,
        discovered.map((model) => modelWrite(model, occurredAt)),
      );
    } catch (cause) {
      throw new ZeroError('DATABASE_FAILED', 'Failed to persist discovered models', {
        cause,
      });
    }

    this.logger.info({
      event: 'provider.models_discovered',
      correlationId,
      data: { providerId, modelCount: discovered.length },
    });
    return discovered;
  }

  private register(providerId: string): void {
    const provider = this.providers.findById(providerId);
    if (provider === undefined) {
      throw new ZeroError('VALIDATION_FAILED', 'Provider was not found');
    }
    this.gateway.registerProvider(this.gatewayConfig(provider), this.adapter(provider));
  }

  private gatewayConfig(provider: StoredProvider) {
    return {
      id: provider.id,
      protocol: providerProtocolSchema.parse(provider.protocol),
      baseUrl: provider.baseUrl,
      secretRef: provider.secretRef,
      headers: parseHeaders(provider.headersJson),
      privacy: {
        allowPersonal: provider.allowPersonal === 1,
        allowSensitive: provider.allowSensitive === 1,
        allowHealth: provider.allowHealth === 1,
      },
      enabled: provider.enabled === 1,
    } as const;
  }

  private adapter(provider: StoredProvider): OpenAIResponsesAdapter {
    if (provider.protocol !== 'openai') {
      throw new ZeroError(
        'MODEL_UNAVAILABLE',
        'This provider protocol is not available in the current phase',
      );
    }
    return new OpenAIResponsesAdapter(this.fetcher);
  }
}

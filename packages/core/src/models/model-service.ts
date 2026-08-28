import {
  AnthropicMessagesAdapter,
  ModelGateway,
  OllamaAdapter,
  OpenAIChatCompletionsAdapter,
  OpenAIResponsesAdapter,
  type GatewayFetch,
  type ProviderAdapter,
  type ProviderConnectionResult,
} from '@builderhelm/model-gateway';
import type { Logger } from '@builderhelm/observability';
import {
  modelCapabilitiesSchema,
  modelCapabilityOverridesSchema,
  modelRecordSchema,
  modelRequestSchema,
  providerHeaderSchema,
  providerProtocolSchema,
  type ChatStreamEvent,
  type ModelCapabilities,
  type ModelCapabilityOverrideRecord,
  type ModelCapabilityOverrides,
  type ModelRecord,
  type ModelRequest,
  type ProviderHeader,
} from '@builderhelm/protocol';
import {
  createId,
  normalizeError,
  utcNow,
  BuilderHelmError,
  type CorrelationId,
} from '@builderhelm/shared';
import type {
  ModelRepository,
  ModelWrite,
  ProviderRepository,
  StoredModel,
  StoredProvider,
} from '@builderhelm/db';

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
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Provider returned duplicate model identifiers',
      );
    }
    refs.add(model.ref);
  }
}

function applyCapabilityOverrides(
  base: ModelCapabilities,
  overrides: ModelCapabilityOverrides,
): ModelCapabilities {
  return modelCapabilitiesSchema.parse({ ...base, ...overrides });
}

function overrideRecord(
  providerId: string,
  stored: ReturnType<ModelRepository['listCapabilityOverrides']>[number],
): ModelCapabilityOverrideRecord {
  return {
    modelRef: `${providerId}:${stored.modelId}`,
    overrides: modelCapabilityOverridesSchema.parse(JSON.parse(stored.overridesJson)),
    updatedAt: stored.updatedAt,
  };
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
      throw new BuilderHelmError('DATABASE_FAILED', 'Failed to read stored models', {
        cause,
      });
    }
  }

  listCapabilityOverrides(providerId?: string): ModelCapabilityOverrideRecord[] {
    try {
      return this.models
        .listCapabilityOverrides(providerId)
        .map((stored) => overrideRecord(stored.providerId, stored));
    } catch (cause) {
      throw new BuilderHelmError(
        'DATABASE_FAILED',
        'Failed to read capability overrides',
        {
          cause,
        },
      );
    }
  }

  updateCapabilityOverride(
    modelRef: string,
    rawOverrides: ModelCapabilityOverrides,
    correlationId: CorrelationId,
  ): ModelRecord {
    const overrides = modelCapabilityOverridesSchema.parse(rawOverrides);
    const model = this.list().find((candidate) => candidate.ref === modelRef);
    if (model === undefined) {
      throw new BuilderHelmError('MODEL_UNAVAILABLE', 'The selected model is not stored');
    }
    const storedOverride = this.models
      .listCapabilityOverrides(model.providerId)
      .find((candidate) => candidate.modelId === model.modelId);
    const base =
      storedOverride === undefined
        ? model.capabilities
        : modelCapabilitiesSchema.parse(JSON.parse(storedOverride.baseCapabilitiesJson));
    const clearing = Object.keys(overrides).length === 0;
    const effective = applyCapabilityOverrides(base, clearing ? {} : overrides);
    const updatedAt = utcNow();
    const updatedModel = modelRecordSchema.parse({
      ...model,
      capabilities: effective,
    });
    const before =
      storedOverride === undefined
        ? null
        : modelCapabilityOverridesSchema.parse(JSON.parse(storedOverride.overridesJson));

    try {
      this.models.setCapabilityOverride({
        providerId: model.providerId,
        modelId: model.modelId,
        overridesJson: clearing ? null : JSON.stringify(overrides),
        baseCapabilitiesJson: JSON.stringify(base),
        effectiveCapabilities: modelWrite(updatedModel, updatedAt).capabilities,
        updatedAt,
        audit: {
          id: createId(),
          eventType: clearing
            ? 'model.capability_override_cleared'
            : 'model.capability_override_updated',
          actorType: 'user',
          actorId: null,
          correlationId,
          riskLevel: 'medium',
          resourceRefsJson: JSON.stringify([model.ref]),
          beforeJson: before === null ? null : JSON.stringify(before),
          afterJson: clearing ? null : JSON.stringify(overrides),
          approvalId: null,
          createdAt: updatedAt,
        },
      });
    } catch (cause) {
      throw new BuilderHelmError(
        'DATABASE_FAILED',
        'Failed to persist capability override',
        {
          cause,
        },
      );
    }

    this.logger.info({
      event: clearing
        ? 'model.capability_override_cleared'
        : 'model.capability_override_updated',
      correlationId,
      data: { modelRef },
    });
    return updatedModel;
  }

  async *stream(
    rawRequest: ModelRequest,
    correlationId: CorrelationId,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const request = modelRequestSchema.parse(rawRequest);
    const providerId = request.modelRef.slice(0, request.modelRef.indexOf(':'));
    try {
      this.register(providerId);
      this.gateway.replaceModels(providerId, this.list(providerId));
      this.logger.info({
        event: 'model.stream_started',
        correlationId,
        data: { providerId, modelRef: request.modelRef },
      });
      for await (const event of this.gateway.stream(request, signal)) {
        yield event;
      }
    } catch (error) {
      const normalized = normalizeError(error);
      this.logger.warn({
        event: 'model.stream_failed',
        correlationId,
        data: { providerId, modelRef: request.modelRef, code: normalized.code },
      });
      throw normalized;
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

    const storedOverrides = this.models.listCapabilityOverrides(providerId);
    const overridesByModel = new Map(
      storedOverrides.map((stored) => [
        stored.modelId,
        modelCapabilityOverridesSchema.parse(JSON.parse(stored.overridesJson)),
      ]),
    );
    const effectiveModels = discovered.map((model) => {
      const overrides = overridesByModel.get(model.modelId);
      return overrides === undefined
        ? model
        : modelRecordSchema.parse({
            ...model,
            capabilities: applyCapabilityOverrides(model.capabilities, overrides),
          });
    });
    const occurredAt = utcNow();
    try {
      this.models.replaceForProvider(
        providerId,
        effectiveModels.map((model) => modelWrite(model, occurredAt)),
        discovered
          .filter((model) => overridesByModel.has(model.modelId))
          .map((model) => ({
            modelId: model.modelId,
            capabilitiesJson: JSON.stringify(model.capabilities),
          })),
      );
    } catch (cause) {
      throw new BuilderHelmError(
        'DATABASE_FAILED',
        'Failed to persist discovered models',
        {
          cause,
        },
      );
    }

    this.logger.info({
      event: 'provider.models_discovered',
      correlationId,
      data: { providerId, modelCount: discovered.length },
    });
    return effectiveModels;
  }

  private register(providerId: string): void {
    const provider = this.providers.findById(providerId);
    if (provider === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Provider was not found');
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

  private adapter(provider: StoredProvider): ProviderAdapter {
    if (provider.protocol === 'openai') {
      return new OpenAIResponsesAdapter(this.fetcher);
    }
    if (provider.protocol === 'anthropic') {
      return new AnthropicMessagesAdapter(this.fetcher);
    }
    if (provider.protocol === 'openai-compatible') {
      if (provider.baseUrl === null) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'OpenAI-compatible providers require an explicit base URL',
        );
      }
      return new OpenAIChatCompletionsAdapter(this.fetcher);
    }
    if (provider.protocol === 'ollama') {
      return new OllamaAdapter(this.fetcher);
    }
    throw new BuilderHelmError(
      'MODEL_UNAVAILABLE',
      'This provider protocol is not available in the current phase',
    );
  }
}

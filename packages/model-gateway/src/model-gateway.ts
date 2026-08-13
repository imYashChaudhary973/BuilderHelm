import {
  chatStreamEventSchema,
  modelRecordSchema,
  modelRequestSchema,
  modelResponseSchema,
  type ChatStreamEvent,
  type DataClassification,
  type ModelRecord,
  type ModelRequest,
  type ModelResponse,
  type ProviderHeader,
  type ProviderPrivacy,
  type ProviderProtocol,
} from '@zero/protocol';
import { ZeroError } from '@zero/shared';

import type {
  CredentialResolver,
  ProviderAdapter,
  ProviderConnectionResult,
  ProviderInvocationContext,
} from './adapter.js';
import { normalizeProviderError } from './error-mapping.js';

export interface GatewayProviderConfig {
  readonly id: string;
  readonly protocol: ProviderProtocol;
  readonly baseUrl: string | null;
  readonly secretRef: string;
  readonly headers: readonly ProviderHeader[];
  readonly privacy: ProviderPrivacy;
  readonly enabled: boolean;
}

interface RegisteredProvider {
  readonly config: GatewayProviderConfig;
  readonly adapter: ProviderAdapter;
}

function providerIdFromRef(modelRef: string): string {
  return modelRef.slice(0, modelRef.indexOf(':'));
}

function classificationAllowed(
  classification: DataClassification,
  privacy: ProviderPrivacy,
): boolean {
  switch (classification) {
    case 'public':
      return true;
    case 'personal':
      return privacy.allowPersonal;
    case 'sensitive':
      return privacy.allowSensitive;
    case 'health':
      return privacy.allowHealth;
  }
}

function assertCapabilities(request: ModelRequest, model: ModelRecord): void {
  const missing: string[] = [];
  if (
    request.messages.some((message) =>
      message.content.some((part) => part.type === 'text'),
    ) &&
    !model.capabilities.text
  ) {
    missing.push('text');
  }
  if (
    request.messages.some((message) =>
      message.content.some((part) => part.type === 'image'),
    ) &&
    !model.capabilities.vision
  ) {
    missing.push('vision');
  }
  if ((request.tools?.length ?? 0) > 0 && !model.capabilities.toolCalling) {
    missing.push('toolCalling');
  }
  if (request.responseSchema !== undefined && !model.capabilities.structuredOutput) {
    missing.push('structuredOutput');
  }
  if (
    request.reasoning !== undefined &&
    request.reasoning !== 'none' &&
    !model.capabilities.reasoningControls
  ) {
    missing.push('reasoningControls');
  }
  if (request.stream && !model.capabilities.streaming) {
    missing.push('streaming');
  }
  if (
    request.maxOutputTokens !== undefined &&
    model.capabilities.maxOutputTokens !== undefined &&
    request.maxOutputTokens > model.capabilities.maxOutputTokens
  ) {
    missing.push('maxOutputTokens');
  }

  if (missing.length > 0) {
    throw new ZeroError(
      'MODEL_CAPABILITY_MISMATCH',
      'The selected model does not support this request',
      { metadata: { modelRef: model.ref, missing } },
    );
  }
}

function assertSecureBaseUrl(baseUrl: string | null): void {
  if (baseUrl === null) return;
  const parsed = new URL(baseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new ZeroError(
      'PERMISSION_DENIED',
      'Provider credentials require HTTPS or a loopback URL',
    );
  }
}

async function resolvedHeaders(
  headers: readonly ProviderHeader[],
  credentials: CredentialResolver,
): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    if (header.source === 'static') {
      result[header.name] = header.value;
      continue;
    }
    const value = await credentials.resolve(header.secretRef);
    if (value === null) {
      throw new ZeroError('AUTH_FAILED', 'Provider header credential is unavailable');
    }
    result[header.name] = value;
  }
  return result;
}

export class ModelGateway {
  private readonly providers = new Map<string, RegisteredProvider>();
  private readonly models = new Map<string, ModelRecord>();

  constructor(private readonly credentials: CredentialResolver) {}

  registerProvider(config: GatewayProviderConfig, adapter: ProviderAdapter): void {
    if (config.protocol !== adapter.protocol) {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'Provider protocol does not match adapter',
      );
    }
    this.providers.set(config.id, { config, adapter });
  }

  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
    for (const [ref, model] of this.models) {
      if (model.providerId === providerId) this.models.delete(ref);
    }
  }

  replaceModels(providerId: string, rawModels: readonly ModelRecord[]): ModelRecord[] {
    const provider = this.providers.get(providerId);
    if (provider === undefined) {
      throw new ZeroError('VALIDATION_FAILED', 'Provider is not registered');
    }
    const models = rawModels.map((model) => modelRecordSchema.parse(model));
    if (models.some((model) => model.providerId !== providerId)) {
      throw new ZeroError('VALIDATION_FAILED', 'Model belongs to a different provider');
    }
    for (const [ref, model] of this.models) {
      if (model.providerId === providerId) this.models.delete(ref);
    }
    for (const model of models) this.models.set(model.ref, model);
    return models;
  }

  listModels(providerId?: string): ModelRecord[] {
    return [...this.models.values()]
      .filter((model) => providerId === undefined || model.providerId === providerId)
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  async discoverModels(providerId: string, signal: AbortSignal): Promise<ModelRecord[]> {
    const { registered, context } = await this.context(providerId, signal);
    try {
      const models = await registered.adapter.discoverModels(context);
      return this.replaceModels(providerId, models);
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async testConnection(
    providerId: string,
    signal: AbortSignal,
  ): Promise<ProviderConnectionResult> {
    const { registered, context } = await this.context(providerId, signal);
    try {
      return await registered.adapter.testConnection(context);
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async invoke(rawRequest: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const request = modelRequestSchema.parse(rawRequest);
    const { registered, context } = await this.prepare(request, signal);
    try {
      return modelResponseSchema.parse(await registered.adapter.invoke(request, context));
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async *stream(
    rawRequest: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const request = modelRequestSchema.parse(rawRequest);
    const { registered, context } = await this.prepare(request, signal);
    try {
      for await (const rawEvent of registered.adapter.stream(request, context)) {
        yield chatStreamEventSchema.parse(rawEvent);
      }
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  private async prepare(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<{
    registered: RegisteredProvider;
    model: ModelRecord;
    context: ProviderInvocationContext;
  }> {
    const providerId = providerIdFromRef(request.modelRef);
    const registered = this.providers.get(providerId);
    const model = this.models.get(request.modelRef);
    if (registered === undefined || model === undefined) {
      throw new ZeroError('MODEL_UNAVAILABLE', 'The selected model is not registered');
    }
    if (!registered.config.enabled) {
      throw new ZeroError('MODEL_UNAVAILABLE', 'The selected provider is disabled');
    }
    const denied = request.dataClassifications.filter(
      (classification) =>
        !classificationAllowed(classification, registered.config.privacy),
    );
    if (denied.length > 0) {
      throw new ZeroError(
        'PERMISSION_DENIED',
        'Provider privacy policy blocks this request',
        {
          metadata: { providerId, denied },
        },
      );
    }
    assertCapabilities(request, model);
    const { context } = await this.context(providerId, signal);
    return { registered, model, context };
  }

  private async context(
    providerId: string,
    signal: AbortSignal,
  ): Promise<{ registered: RegisteredProvider; context: ProviderInvocationContext }> {
    if (signal.aborted) throw new ZeroError('CANCELLED', 'Model request was cancelled');
    const registered = this.providers.get(providerId);
    if (registered === undefined || !registered.config.enabled) {
      throw new ZeroError('MODEL_UNAVAILABLE', 'Provider is unavailable');
    }
    assertSecureBaseUrl(registered.config.baseUrl);
    const credential = await this.credentials.resolve(registered.config.secretRef);
    if (credential === null) {
      throw new ZeroError('AUTH_FAILED', 'Provider credential is unavailable');
    }
    return {
      registered,
      context: {
        providerId,
        baseUrl: registered.config.baseUrl,
        credential,
        headers: await resolvedHeaders(registered.config.headers, this.credentials),
        signal,
      },
    };
  }
}

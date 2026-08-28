import type {
  ChatStreamEvent,
  ModelRecord,
  ModelRequest,
  ModelResponse,
  ProviderProtocol,
} from '@builderhelm/protocol';

export interface ProviderInvocationContext {
  readonly providerId: string;
  readonly baseUrl: string | null;
  readonly credential: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface ProviderConnectionResult {
  readonly ok: true;
  readonly latencyMs: number;
}

export interface ProviderAdapter {
  readonly protocol: ProviderProtocol;
  invoke(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): Promise<ModelResponse>;
  stream(
    request: ModelRequest,
    context: ProviderInvocationContext,
  ): AsyncIterable<ChatStreamEvent>;
  discoverModels(context: ProviderInvocationContext): Promise<ModelRecord[]>;
  testConnection(context: ProviderInvocationContext): Promise<ProviderConnectionResult>;
}

export interface CredentialResolver {
  resolve(ref: string): Promise<string | null>;
}

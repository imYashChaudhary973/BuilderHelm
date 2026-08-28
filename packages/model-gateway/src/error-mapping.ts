import { BuilderHelmError } from '@builderhelm/shared';

interface StatusError {
  readonly status?: unknown;
  readonly name?: unknown;
}

export function normalizeProviderError(error: unknown): BuilderHelmError {
  if (error instanceof BuilderHelmError) return error;

  const candidate = error as StatusError | null;
  if (candidate?.name === 'AbortError') {
    return new BuilderHelmError('CANCELLED', 'Model request was cancelled');
  }
  if (candidate?.name === 'TimeoutError') {
    return new BuilderHelmError('INTEGRATION_OFFLINE', 'Provider request timed out', {
      retryable: true,
    });
  }

  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  if (status === 401 || status === 403) {
    return new BuilderHelmError('AUTH_FAILED', 'Provider authentication failed');
  }
  if (status === 408 || status === 429) {
    return new BuilderHelmError('RATE_LIMITED', 'Provider rate limit reached', {
      retryable: true,
    });
  }
  if (status === 404) {
    return new BuilderHelmError('MODEL_UNAVAILABLE', 'The selected model is unavailable');
  }
  if (status === 413) {
    return new BuilderHelmError('CONTEXT_TOO_LARGE', 'The model context is too large');
  }
  if (typeof status === 'number' && status >= 500) {
    return new BuilderHelmError(
      'MODEL_UNAVAILABLE',
      'The provider is temporarily unavailable',
      {
        retryable: true,
      },
    );
  }
  if (error instanceof TypeError) {
    return new BuilderHelmError('INTEGRATION_OFFLINE', 'Could not reach the provider', {
      retryable: true,
    });
  }

  return new BuilderHelmError('MODEL_UNAVAILABLE', 'The provider request failed');
}

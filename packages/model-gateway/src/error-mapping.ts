import { ZeroError } from '@zero/shared';

interface StatusError {
  readonly status?: unknown;
  readonly name?: unknown;
}

export function normalizeProviderError(error: unknown): ZeroError {
  if (error instanceof ZeroError) return error;

  const candidate = error as StatusError | null;
  if (candidate?.name === 'AbortError') {
    return new ZeroError('CANCELLED', 'Model request was cancelled');
  }

  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  if (status === 401 || status === 403) {
    return new ZeroError('AUTH_FAILED', 'Provider authentication failed');
  }
  if (status === 408 || status === 429) {
    return new ZeroError('RATE_LIMITED', 'Provider rate limit reached', {
      retryable: true,
    });
  }
  if (status === 404) {
    return new ZeroError('MODEL_UNAVAILABLE', 'The selected model is unavailable');
  }
  if (status === 413) {
    return new ZeroError('CONTEXT_TOO_LARGE', 'The model context is too large');
  }
  if (typeof status === 'number' && status >= 500) {
    return new ZeroError('MODEL_UNAVAILABLE', 'The provider is temporarily unavailable', {
      retryable: true,
    });
  }
  if (error instanceof TypeError) {
    return new ZeroError('INTEGRATION_OFFLINE', 'Could not reach the provider', {
      retryable: true,
    });
  }

  return new ZeroError('MODEL_UNAVAILABLE', 'The provider request failed');
}

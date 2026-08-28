export const builderHelmErrorCodes = [
  'AUTH_FAILED',
  'RATE_LIMITED',
  'MODEL_UNAVAILABLE',
  'MODEL_CAPABILITY_MISMATCH',
  'CONTEXT_TOO_LARGE',
  'TOOL_SCHEMA_INVALID',
  'TOOL_EXECUTION_FAILED',
  'PERMISSION_DENIED',
  'INTEGRATION_OFFLINE',
  'INDEX_STALE',
  'CANCELLED',
  'VALIDATION_FAILED',
  'DATABASE_FAILED',
  'MIGRATION_FAILED',
  'INTERNAL_ERROR',
] as const;

export type BuilderHelmErrorCode = (typeof builderHelmErrorCodes)[number];

export interface BuilderHelmErrorOptions {
  readonly cause?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
}

export class BuilderHelmError extends Error {
  readonly code: BuilderHelmErrorCode;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(
    code: BuilderHelmErrorCode,
    message: string,
    options: BuilderHelmErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BuilderHelmError';
    this.code = code;
    this.metadata = options.metadata ?? {};
    this.retryable = options.retryable ?? false;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      metadata: this.metadata,
    };
  }
}

export function normalizeError(
  error: unknown,
  fallbackCode: BuilderHelmErrorCode = 'INTERNAL_ERROR',
): BuilderHelmError {
  if (error instanceof BuilderHelmError) {
    return error;
  }

  if (error instanceof Error) {
    return new BuilderHelmError(fallbackCode, error.message, { cause: error });
  }

  return new BuilderHelmError(fallbackCode, 'An unknown error occurred', {
    metadata: { originalType: typeof error },
  });
}

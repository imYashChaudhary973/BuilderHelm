export const zeroErrorCodes = [
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

export type ZeroErrorCode = (typeof zeroErrorCodes)[number];

export interface ZeroErrorOptions {
  readonly cause?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
}

export class ZeroError extends Error {
  readonly code: ZeroErrorCode;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(code: ZeroErrorCode, message: string, options: ZeroErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ZeroError';
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
  fallbackCode: ZeroErrorCode = 'INTERNAL_ERROR',
): ZeroError {
  if (error instanceof ZeroError) {
    return error;
  }

  if (error instanceof Error) {
    return new ZeroError(fallbackCode, error.message, { cause: error });
  }

  return new ZeroError(fallbackCode, 'An unknown error occurred', {
    metadata: { originalType: typeof error },
  });
}

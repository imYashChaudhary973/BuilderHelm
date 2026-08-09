const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|private[-_]?key|api[-_]?key|secret|token)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const COMMON_KEY_VALUE = /\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}\b/gi;

function redactString(value: string): string {
  return value
    .replace(BEARER_VALUE, `Bearer ${REDACTED}`)
    .replace(COMMON_KEY_VALUE, REDACTED);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(entry, seen),
    ]),
  );
}

export function redact(input: unknown): unknown {
  return redactValue(input, new WeakSet<object>());
}

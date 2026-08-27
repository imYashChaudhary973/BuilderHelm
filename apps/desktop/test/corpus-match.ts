const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function matchExpected(expected: unknown, actual: unknown, path = '$'): string[] {
  if (
    expected !== null &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    !('ok' in expected) &&
    actual !== null &&
    typeof actual === 'object' &&
    'ok' in actual &&
    (actual as { ok: unknown }).ok === true &&
    'value' in actual
  ) {
    actual = (actual as { value: unknown }).value;
  }
  if (expected === '$any') return [];
  if (expected === '$uuid') {
    return typeof actual === 'string' && UUID.test(actual)
      ? []
      : [`${path}: expected uuid, got ${JSON.stringify(actual)}`];
  }
  if (expected === '$iso8601') {
    return typeof actual === 'string' && ISO.test(actual)
      ? []
      : [`${path}: expected iso8601, got ${JSON.stringify(actual)}`];
  }
  if (expected === '$redacted') {
    return actual === '$redacted' || actual === undefined || actual === null
      ? []
      : [`${path}: expected redacted, got ${JSON.stringify(actual)}`];
  }
  if (expected === null || typeof expected !== 'object') {
    return Object.is(expected, actual)
      ? []
      : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  }
  if (actual === null || typeof actual !== 'object') {
    return [`${path}: expected object, got ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array`];
    if (expected.length !== actual.length) {
      return [`${path}: expected length ${String(expected.length)}, got ${String(actual.length)}`];
    }
    return expected.flatMap((item, index) =>
      matchExpected(item, actual[index], `${path}[${String(index)}]`),
    );
  }
  const skip = new Set(['latencyMs', 'path', 'root', 'cwd', 'folderPath', 'repoPath']);
  const expectedKeys = Object.keys(expected as Record<string, unknown>);
  const actualObj = actual as Record<string, unknown>;
  const missing = expectedKeys.filter((key) => !skip.has(key) && !(key in actualObj));
  const errors: string[] = [];
  if (missing.length > 0) errors.push(`${path}: missing keys ${missing.join(', ')}`);
  for (const key of expectedKeys) {
    if (key === 'latencyMs' || key === 'path' || key === 'root' || key === 'cwd' || key === 'folderPath' || key === 'repoPath') continue;
    if (key in actualObj) {
      errors.push(
        ...matchExpected(
          (expected as Record<string, unknown>)[key],
          actualObj[key],
          `${path}.${key}`,
        ),
      );
    }
  }
  return errors;
}

export function sanitize(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (
      /(?:api[_-]?key|secret|token|password|sk-|ghp_|github_pat)/i.test(value) ||
      value === 'phase-one-secret-sentinel' ||
      value === 'gho_not-a-real-token-value'
    ) {
      return '$redacted';
    }
    if (key !== 'code' && key !== 'status' && key !== 'database' && UUID.test(value)) {
      return '$uuid';
    }
    if (ISO.test(value)) return '$iso8601';
    return value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  const out: Record<string, unknown> = {};
  for (const [next, nested] of Object.entries(value as Record<string, unknown>)) {
    out[next] = sanitize(nested, next);
  }
  return out;
}

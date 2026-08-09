import { createCorrelationId } from '@zero/shared';
import { describe, expect, it } from 'vitest';

import { createLogger, redact } from '../src/index.js';

describe('redaction', () => {
  it('redacts sensitive keys and token-shaped values recursively', () => {
    const output = redact({
      headers: { Authorization: 'Bearer highly-sensitive-token' },
      apiKey: 'sentinel-secret-value',
      note: 'received sk-live_abcdefghijk',
    });
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain('highly-sensitive-token');
    expect(serialized).not.toContain('sentinel-secret-value');
    expect(serialized).not.toContain('sk-live_abcdefghijk');
  });
});

describe('structured logger', () => {
  it('writes a parseable record with correlation metadata', () => {
    const lines: string[] = [];
    const correlationId = createCorrelationId();
    const logger = createLogger((line) => lines.push(line));

    logger.info({ event: 'core.started', correlationId, data: { status: 'ready' } });

    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      event: 'core.started',
      correlationId,
      data: { status: 'ready' },
    });
  });
});

import { describe, expect, it } from 'vitest';

import { normalizeError, toUtcTimestamp, ZeroError } from '../src/index.js';

describe('time utilities', () => {
  it('normalizes timestamps to UTC', () => {
    expect(toUtcTimestamp('2026-08-09T12:30:00+05:30')).toBe('2026-08-09T07:00:00.000Z');
  });

  it('rejects invalid timestamps', () => {
    expect(() => toUtcTimestamp('not-a-date')).toThrow(RangeError);
  });
});

describe('ZeroError', () => {
  it('preserves stable error codes without serializing the cause', () => {
    const error = new ZeroError('PERMISSION_DENIED', 'Denied', {
      cause: new Error('internal'),
      metadata: { toolId: 'task.create' },
    });

    expect(error.toJSON()).toEqual({
      name: 'ZeroError',
      code: 'PERMISSION_DENIED',
      message: 'Denied',
      retryable: false,
      metadata: { toolId: 'task.create' },
    });
  });

  it('normalizes unknown thrown values without exposing their contents', () => {
    const error = normalizeError({ apiKey: 'must-not-leak' });

    expect(error.message).toBe('An unknown error occurred');
    expect(error.metadata).toEqual({ originalType: 'object' });
  });
});

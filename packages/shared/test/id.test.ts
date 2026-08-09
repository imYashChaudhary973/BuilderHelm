import { describe, expect, it } from 'vitest';

import { createCorrelationId, createId } from '../src/index.js';

describe('createId', () => {
  it('creates an RFC 9562 version 7 UUID', () => {
    const id = createId(1_754_678_400_000);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('sorts records created in different milliseconds chronologically', () => {
    expect(createId(1_000) < createId(1_001)).toBe(true);
  });

  it('uses the same safe format for correlation IDs', () => {
    expect(createCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

import { parseReturnBody, statesEqual } from '../src/main/auth-handoff.js';

describe('auth handoff payload', () => {
  it('accepts a matching state in constant time', () => {
    const state = 'a'.repeat(64);
    expect(statesEqual(state, state)).toBe(true);
    expect(statesEqual(state, 'b'.repeat(64))).toBe(false);
    expect(statesEqual(state, 'a'.repeat(32))).toBe(false);
  });

  it('parses a fragment POST body', () => {
    const body = parseReturnBody(
      JSON.stringify({
        state: 'abc',
        access_token: 'tok',
        refresh_token: 'ref',
        expires_at: '1700000000',
      }),
    );
    expect(body).toEqual({
      state: 'abc',
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: 1_700_000_000,
    });
  });

  it('rejects a truncated body', () => {
    expect(parseReturnBody('{"state":"x"}')).toBeNull();
    expect(parseReturnBody('not-json')).toBeNull();
  });
});

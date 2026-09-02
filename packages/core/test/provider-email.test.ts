import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readProviderEmail } from '../src/accounts/accounts-service.js';

const folders: string[] = [];

afterEach(() => {
  // folders are cleaned by the accounts-service suite's shared cleanup; nothing here
});

describe('readProviderEmail system homes', () => {
  it('reads claude system email from ~/.claude/.credentials.json shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-claude-id-'));
    folders.push(dir);
    // credentials.json shape (what claude login writes inside a config dir)
    writeFileSync(
      join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'x', email: 'dev@example.com' } }),
    );
    expect(readProviderEmail('claude', dir)).toBe('dev@example.com');
  });

  it('reads codex system email by decoding the id_token email claim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-codex-'));
    folders.push(dir);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ email: 'user@example.com' })).toString(
      'base64url',
    );
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({ tokens: { id_token: `${header}.${payload}.sig` } }),
    );
    expect(readProviderEmail('codex', dir)).toBe('user@example.com');
  });

  it('returns null when no credentials exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builderhelm-empty-'));
    folders.push(dir);
    expect(readProviderEmail('claude', dir)).toBeNull();
    expect(readProviderEmail('codex', dir)).toBeNull();
  });
});

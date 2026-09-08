import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isAllowedSecretRef,
  supportsCredentialStore,
} from '../src/main/keyring-secret-store.js';

describe('release packaging contract', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
  ) as {
    scripts?: { dist?: string };
    build?: {
      mac?: { identity?: string | null; target?: unknown };
      publish?: unknown;
    };
  };

  it('packages unsigned macOS arm64 and never publishes', () => {
    expect(manifest.scripts?.dist).toContain('--mac --arm64 --publish never');
    expect(manifest.scripts?.dist).not.toContain('--win');
    expect(manifest.scripts?.dist).not.toContain('--linux');
    expect(manifest.build?.mac?.identity).toBeNull();
  });

  it('allows Keychain, Credential Manager, and Secret Service refs only', () => {
    expect(supportsCredentialStore('darwin')).toBe(true);
    expect(supportsCredentialStore('win32')).toBe(true);
    expect(supportsCredentialStore('linux')).toBe(true);
    expect(supportsCredentialStore('freebsd')).toBe(false);
    expect(isAllowedSecretRef('remote.host.ed25519')).toBe(true);
    expect(
      isAllowedSecretRef('remote.session.00000000-0000-4000-8000-000000000001.key'),
    ).toBe(true);
    expect(isAllowedSecretRef('builderhelm.session')).toBe(true);
    expect(isAllowedSecretRef('arbitrary.secret')).toBe(false);
  });
});

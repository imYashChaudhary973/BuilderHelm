import { AsyncEntry } from '@napi-rs/keyring';
import { BUILDERHELM_KEYCHAIN_SERVICE, type SecretStore } from '@builderhelm/core';
import { BuilderHelmError } from '@builderhelm/shared';

/**
 * Exact refs only. A wildcard here would let any caller name a Keychain entry,
 * so each credential the app owns is listed on purpose.
 */
const validSecretRefs: readonly RegExp[] = [
  /^builderhelm\.provider\.[0-9a-f-]{36}\.api-key$/,
  /^builderhelm\.voice\.openai\.api-key$/,
  /^builderhelm\.linear\.api-key$/,
  /^builderhelm\.session$/,
  /^builderhelm\.connection\.[0-9a-f-]{36}\.token$/,
  /^remote\.host\.ed25519$/,
  /^remote\.session\.[0-9a-f-]{36}\.key$/,
];

export function supportsCredentialStore(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32' || platform === 'linux';
}

export function isAllowedSecretRef(ref: string): boolean {
  return validSecretRefs.some((pattern) => pattern.test(ref));
}

/** Keychain has no item under this ref; every other error is a real failure. */
function isMissingEntry(error: unknown): boolean {
  return /no matching entry|not found|no such|element not found|secret service|nsosstatuserrordomain error -25300/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export class KeyringSecretStore implements SecretStore {
  private entry(ref: string): AsyncEntry {
    if (!supportsCredentialStore(process.platform)) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Secure credentials require macOS Keychain, Windows Credential Manager, or Linux Secret Service',
      );
    }
    if (!isAllowedSecretRef(ref)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Invalid secure credential reference',
      );
    }
    return new AsyncEntry(BUILDERHELM_KEYCHAIN_SERVICE, ref);
  }

  async set(ref: string, secret: string): Promise<void> {
    await this.entry(ref).setPassword(secret);
  }

  /**
   * Absent is not an error: Voice asks whether a key exists before one has ever
   * been saved. Keychain reports a missing item by throwing, so only that case
   * becomes `null` and every other failure still surfaces.
   */
  async get(ref: string): Promise<string | null> {
    try {
      return (await this.entry(ref).getPassword()) ?? null;
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw error;
    }
  }

  async delete(ref: string): Promise<void> {
    try {
      await this.entry(ref).deleteCredential();
    } catch (error) {
      if (!isMissingEntry(error)) throw error;
    }
  }
}

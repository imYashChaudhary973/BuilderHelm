import { AsyncEntry } from '@napi-rs/keyring';
import { ZERO_KEYCHAIN_SERVICE, type SecretStore } from '@zero/core';
import { ZeroError } from '@zero/shared';

const validSecretRef = /^zero\.provider\.[0-9a-f-]{36}\.api-key$/;

export class KeyringSecretStore implements SecretStore {
  private entry(ref: string): AsyncEntry {
    if (process.platform !== 'darwin') {
      throw new ZeroError(
        'INTEGRATION_OFFLINE',
        'Secure provider credentials currently require macOS Keychain',
      );
    }
    if (!validSecretRef.test(ref)) {
      throw new ZeroError('VALIDATION_FAILED', 'Invalid secure credential reference');
    }
    return new AsyncEntry(ZERO_KEYCHAIN_SERVICE, ref);
  }

  async set(ref: string, secret: string): Promise<void> {
    await this.entry(ref).setPassword(secret);
  }

  async get(ref: string): Promise<string | null> {
    return (await this.entry(ref).getPassword()) ?? null;
  }

  async delete(ref: string): Promise<void> {
    await this.entry(ref).deleteCredential();
  }
}

import { AsyncEntry } from '@napi-rs/keyring';
import { BUILDERHELM_KEYCHAIN_SERVICE, type SecretStore } from '@builderhelm/core';
import { BuilderHelmError } from '@builderhelm/shared';

const validSecretRef = /^builderhelm\.provider\.[0-9a-f-]{36}\.api-key$/;

export class KeyringSecretStore implements SecretStore {
  private entry(ref: string): AsyncEntry {
    if (process.platform !== 'darwin') {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Secure provider credentials currently require macOS Keychain',
      );
    }
    if (!validSecretRef.test(ref)) {
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

  async get(ref: string): Promise<string | null> {
    return (await this.entry(ref).getPassword()) ?? null;
  }

  async delete(ref: string): Promise<void> {
    await this.entry(ref).deleteCredential();
  }
}

export const ZERO_KEYCHAIN_SERVICE = 'app.zero-os.credentials';

export interface SecretStore {
  set(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(ref: string, secret: string): Promise<void> {
    this.values.set(ref, secret);
  }

  async get(ref: string): Promise<string | null> {
    return this.values.get(ref) ?? null;
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}

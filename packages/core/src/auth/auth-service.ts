import {
  authSessionSchema,
  type AuthSession,
  type AuthState,
} from '@builderhelm/protocol/auth';
import { utcNow } from '@builderhelm/shared';

import type { SecretStore } from '../secrets/secret-store.js';
import { verifyLicence } from './licence.js';

export const AUTH_SESSION_REF = 'builderhelm.session';
const PROFILE_KEY = 'auth.profile';

export interface AuthSettingsStore {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
}

export type AuthTokenBundle = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number | null;
  readonly licence: string;
};

const SIGNED_OUT: AuthState = { status: 'signed-out', session: null, error: null };

function parseBundle(raw: string): AuthTokenBundle | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.accessToken !== 'string' ||
      typeof record.refreshToken !== 'string'
    ) {
      return null;
    }
    if (typeof record.licence !== 'string') return null;
    return {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : null,
      licence: record.licence,
    };
  } catch {
    return null;
  }
}

export class AuthService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly settings: AuthSettingsStore,
  ) {}

  async read(error: string | null = null): Promise<AuthState> {
    const session = await this.sessionFromStore();
    if (session === null) return { ...SIGNED_OUT, error };
    return { status: 'signed-in', session, error };
  }

  async rawBundle(): Promise<AuthTokenBundle | null> {
    const raw = await this.secrets.get(AUTH_SESSION_REF);
    if (raw === null) return null;
    return parseBundle(raw);
  }

  async bundle(): Promise<AuthTokenBundle | null> {
    const stored = await this.rawBundle();
    if (stored === null) return null;
    if (verifyLicence(stored.licence) === null) return null;
    return stored;
  }

  async apply(
    bundle: AuthTokenBundle,
    profile?: { readonly name?: string | null; readonly avatarUrl?: string | null },
  ): Promise<AuthState> {
    const claims = verifyLicence(bundle.licence);
    if (claims === null) {
      await this.clear();
      return { status: 'signed-out', session: null, error: 'This licence is not valid.' };
    }
    const session: AuthSession = {
      email: claims.email,
      name: profile?.name ?? this.nameFromSettings(),
      avatarUrl: profile?.avatarUrl ?? this.avatarFromSettings(),
      plan: claims.plan,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
    await this.secrets.set(AUTH_SESSION_REF, JSON.stringify(bundle));
    this.settings.write(PROFILE_KEY, JSON.stringify(session), utcNow());
    return { status: 'signed-in', session, error: null };
  }
  rememberProfile(input: { name?: string | null; avatarUrl?: string | null }): void {
    const current = this.profile();
    if (current === null) return;
    const next = {
      ...current,
      name: input.name === undefined ? current.name : input.name,
      avatarUrl: input.avatarUrl === undefined ? current.avatarUrl : input.avatarUrl,
    };
    this.settings.write(PROFILE_KEY, JSON.stringify(next), utcNow());
  }

  async signOut(error: string | null = null): Promise<AuthState> {
    await this.clear();
    return { ...SIGNED_OUT, error };
  }

  private async sessionFromStore(): Promise<AuthSession | null> {
    const bundle = await this.bundle();
    if (bundle === null) return null;
    const claims = verifyLicence(bundle.licence);
    if (claims === null) {
      await this.clear();
      return null;
    }
    const cached = this.profile();
    return {
      email: claims.email,
      name: cached?.name ?? null,
      avatarUrl: cached?.avatarUrl ?? null,
      plan: claims.plan,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  private profile(): AuthSession | null {
    const raw = this.settings.read(PROFILE_KEY);
    if (raw === undefined) return null;
    try {
      const parsed = authSessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private nameFromSettings(): string | null {
    return this.profile()?.name ?? null;
  }

  private avatarFromSettings(): string | null {
    return this.profile()?.avatarUrl ?? null;
  }

  private async clear(): Promise<void> {
    await this.secrets.delete(AUTH_SESSION_REF);
    this.settings.write(PROFILE_KEY, 'null', utcNow());
  }
}

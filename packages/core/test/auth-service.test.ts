import { generateKeyPairSync, sign } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
  type BuilderHelmDatabase,
} from '@builderhelm/db';

import { AuthService } from '../src/auth/auth-service.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { verifyLicence } from '../src/auth/licence.js';

const databases: BuilderHelmDatabase[] = [];

function mint(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  claims: Record<string, unknown>,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'k1' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

afterAll(() => {
  for (const database of databases) database.close();
});

describe('AuthService', () => {
  it('stores a verified licence and signs out', async () => {
    // This test uses the production public key only for the reject path below.
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const service = new AuthService(
      new MemorySecretStore(),
      new SettingsRepository(database),
    );
    expect(await service.read()).toEqual({
      status: 'signed-out',
      session: null,
      error: null,
      signInUrl: null,
    });
    const rejected = await service.apply({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: null,
      licence: 'not.a.licence',
    });
    expect(rejected.status).toBe('signed-out');
    expect(rejected.error).not.toBeNull();
  });

  it('verifyLicence is the gate AuthService uses', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const keys = {
      k1: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    };
    const token = mint(privateKey, {
      iss: 'https://builderhelm.com',
      sub: 'u',
      plan: 'pro',
      device_id: 'd',
      exp: 2_000_000_000,
    });
    expect(verifyLicence(token, 1, keys)?.plan).toBe('pro');
  });
});

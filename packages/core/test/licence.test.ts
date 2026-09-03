import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyLicence } from '../src/auth/licence.js';

function mint(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  claims: Record<string, unknown>,
  kid = 'test',
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

describe('verifyLicence', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keys = {
    test: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const validClaims = {
    iss: 'https://builderhelm.com',
    sub: 'user-1',
    email: 'a@b.c',
    plan: 'plus',
    device_id: 'dev-1',
    iat: 1_700_000_000,
    exp: 2_000_000_000,
  };

  it('accepts a valid EdDSA licence', () => {
    const token = mint(privateKey, validClaims);
    expect(verifyLicence(token, 1_700_000_000_000, keys)).toEqual({
      sub: 'user-1',
      email: 'a@b.c',
      plan: 'plus',
      deviceId: 'dev-1',
      exp: 2_000_000_000,
    });
  });

  it('rejects a tampered payload', () => {
    const token = mint(privateKey, validClaims);
    const [header, payload, signature] = token.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ ...validClaims, plan: 'ultra' }),
    ).toString('base64url');
    expect(
      verifyLicence(`${header}.${tampered}.${signature}`, 1_700_000_000_000, keys),
    ).toBeNull();
    expect(payload).not.toBe(tampered);
  });

  it('rejects an expired licence', () => {
    const token = mint(privateKey, { ...validClaims, exp: 10 });
    expect(verifyLicence(token, 11_000, keys)).toBeNull();
  });

  it('rejects plan none', () => {
    const token = mint(privateKey, { ...validClaims, plan: 'none' });
    expect(verifyLicence(token, 1_700_000_000_000, keys)).toBeNull();
  });
});

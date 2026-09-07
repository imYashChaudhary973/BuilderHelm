import { createPublicKey, verify } from 'node:crypto';

/** Current signing key. Previous kids stay here so a rotation does not lock users out. */
export const LICENCE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  k1: 'MCowBQYDK2VwAyEAtyhJQDWA34nV6dEkmgJk2Z+NKEARPrOsXLRDpv3JRy0=',
};

export const LICENCE_ISSUER = 'https://builderhelm.com';

export type LicenceClaims = {
  readonly sub: string;
  readonly email: string | null;
  readonly plan: 'plus' | 'pro' | 'ultra';
  readonly deviceId: string;
  readonly exp: number;
};

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * Verify an EdDSA licence. Returns null on any failure — tamper, unknown kid,
 * lapsed exp, or a plan that is not entitled. The app never decides entitlement
 * from a value it can write.
 */
export function verifyLicence(
  token: string,
  nowMs = Date.now(),
  keys: Readonly<Record<string, string>> = LICENCE_PUBLIC_KEYS,
): LicenceClaims | null {
  const parts = token.split('.');
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (
    parts.length !== 3 ||
    headerPart === undefined ||
    payloadPart === undefined ||
    signaturePart === undefined
  ) {
    return null;
  }
  let decodedHeader: unknown;
  try {
    decodedHeader = decodeSegment(headerPart);
  } catch {
    return null;
  }
  if (typeof decodedHeader !== 'object' || decodedHeader === null) return null;
  const alg = 'alg' in decodedHeader ? decodedHeader.alg : undefined;
  const kid =
    'kid' in decodedHeader && typeof decodedHeader.kid === 'string'
      ? decodedHeader.kid
      : 'k1';
  if (alg !== 'EdDSA') return null;
  const spki = keys[kid];
  if (spki === undefined) return null;
  let signature: Buffer;
  try {
    signature = Buffer.from(signaturePart, 'base64url');
  } catch {
    return null;
  }
  const key = createPublicKey({
    key: Buffer.from(spki, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (!verify(null, Buffer.from(`${headerPart}.${payloadPart}`), key, signature)) {
    return null;
  }
  let decodedPayload: unknown;
  try {
    decodedPayload = decodeSegment(payloadPart);
  } catch {
    return null;
  }
  if (typeof decodedPayload !== 'object' || decodedPayload === null) return null;
  const payload = decodedPayload as Record<string, unknown>; // JSON object; fields checked below
  if (payload.iss !== LICENCE_ISSUER) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
  if (payload.plan !== 'plus' && payload.plan !== 'pro' && payload.plan !== 'ultra') {
    return null;
  }
  if (typeof payload.device_id !== 'string') return null;
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    plan: payload.plan,
    deviceId: payload.device_id,
    exp: payload.exp,
  };
}

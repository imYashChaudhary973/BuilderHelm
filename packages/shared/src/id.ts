import { randomBytes } from 'node:crypto';

const MAX_UUID_TIMESTAMP = 0xffffffffffff;

export type BuilderHelmId = string & { readonly __builderHelmId: unique symbol };
export type CorrelationId = string & { readonly __correlationId: unique symbol };

function toUuidString(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function createId(timestamp = Date.now()): BuilderHelmId {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > MAX_UUID_TIMESTAMP
  ) {
    throw new RangeError('UUIDv7 timestamp must be a non-negative 48-bit integer');
  }

  const bytes = randomBytes(16);
  let remainingTimestamp = timestamp;

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remainingTimestamp & 0xff;
    remainingTimestamp = Math.floor(remainingTimestamp / 256);
  }

  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  return toUuidString(bytes) as BuilderHelmId;
}

export function createCorrelationId(timestamp = Date.now()): CorrelationId {
  return createId(timestamp) as string as CorrelationId;
}

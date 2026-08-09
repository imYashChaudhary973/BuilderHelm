export function utcNow(): string {
  return new Date().toISOString();
}

export function toUtcTimestamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Timestamp must be a valid date');
  }

  return date.toISOString();
}

export interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
}

export function eventMatchesAccelerator(
  event: KeyLike,
  accelerator: string,
  platform = defaultPlatform(),
): boolean {
  const parts = accelerator.split('+').filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1] ?? '';
  const mods = new Set(parts.slice(0, -1));
  const mac = platform.toLowerCase().includes('mac');
  const wantMeta =
    mods.has('Meta') ||
    mods.has('Super') ||
    mods.has('Command') ||
    (mac && mods.has('CommandOrControl'));
  const wantCtrl =
    mods.has('Control') || mods.has('Ctrl') || (!mac && mods.has('CommandOrControl'));
  const wantAlt = mods.has('Alt') || mods.has('Option');
  const wantShift = mods.has('Shift');
  if (event.metaKey !== wantMeta) return false;
  if (event.ctrlKey !== wantCtrl) return false;
  if (event.altKey !== wantAlt) return false;
  if (event.shiftKey !== wantShift) return false;
  return keyMatches(event, key);
}

function keyMatches(event: KeyLike, key: string): boolean {
  if (key === 'Space') return event.code === 'Space' || event.key === ' ';
  if (key.length === 1) {
    return event.key.toLowerCase() === key.toLowerCase();
  }
  return event.key === key || event.code === `Key${key}`;
}

function defaultPlatform(): string {
  return typeof navigator === 'undefined' ? 'mac' : navigator.platform;
}

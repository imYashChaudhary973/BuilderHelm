import type { BrowserSettings } from '@builderhelm/protocol/browser';

/**
 * Matches bare http(s) links in terminal output. Trailing punctuation is left
 * out so a URL at the end of a sentence, or inside parentheses, still resolves
 * to the address the tool printed.
 */
export const TERMINAL_LINK_PATTERN =
  /https?:\/\/[^\s"'`<>()[\]{}]+[^\s"'`<>()[\]{}.,;:!?]/g;

export type TerminalLinkTarget = 'app' | 'system' | 'ask';

/**
 * Where a clicked terminal link should go.
 *
 * ⇧⌘-click is an unconditional escape hatch to the system browser, matching the
 * settings copy. Otherwise the action sheet wins when it is enabled, because
 * asking is strictly safer than guessing; only when it is off does the routing
 * preference decide on its own.
 */
export function resolveTerminalLinkTarget(
  settings: BrowserSettings | null,
  event: {
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
  },
): TerminalLinkTarget {
  const modifier = event.metaKey || event.ctrlKey;
  if (settings === null) return 'system';
  if (modifier && event.shiftKey) {
    return settings.linkRouting || !settings.shiftOpensInApp ? 'system' : 'app';
  }
  if (settings.terminalLinkActions) return 'ask';
  return settings.linkRouting ? 'app' : 'system';
}

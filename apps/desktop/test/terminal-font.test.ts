import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * xterm.js measures one cell from its configured font and lays every glyph on
 * that grid. With a proportional family a space and U+2500 differ by 4x, so
 * every bordered CLI panel tears while the terminal buffer stays correct. The
 * font is therefore a rendering contract, not a cosmetic choice.
 */
const renderer = readFileSync(
  resolve(import.meta.dirname, '../src/renderer/src/components/terminal-pane.tsx'),
  'utf8',
);
const styles = readFileSync(
  resolve(import.meta.dirname, '../src/renderer/src/styles.css'),
  'utf8',
);

const proportionalFamilies = [
  'Inter',
  'ui-sans-serif',
  'system-ui',
  'sans-serif',
  'serif',
];

describe('terminal font', () => {
  it('gives xterm an explicit monospace stack', () => {
    const configured = /fontFamily:\s*([A-Z_]+|'[^']*')/.exec(renderer)?.[1];
    expect(configured, 'terminal-pane must pass fontFamily to Terminal').toBeDefined();

    const stack = /const TERMINAL_FONT_FAMILY = '([^']+)'/.exec(renderer)?.[1] ?? '';
    expect(stack).toContain('monospace');
    for (const family of proportionalFamilies) {
      expect(stack, `${family} would break cell alignment`).not.toContain(family);
    }
  });

  it('stays in step with the --font-mono design token', () => {
    const stack = /const TERMINAL_FONT_FAMILY = '([^']+)'/.exec(renderer)?.[1] ?? '';
    const token = /--font-mono:\s*([^;]+);/.exec(styles)?.[1]?.trim() ?? '';
    expect(token.length).toBeGreaterThan(0);
    // Drift here means the terminal and the rest of the product disagree about
    // what monospace means, which is how the sans-serif inheritance crept in.
    expect(stack).toBe(token);
  });
});

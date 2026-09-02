import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildFocusedDocument } from '../src/renderer/src/shaders/elements/ElementsBackground.js';

const canonicalPath = resolve(
  import.meta.dirname,
  '../src/renderer/src/shaders/elements/sources/elemental-marks.html',
);

/**
 * `buildFocusedDocument` shapes the launch animation entirely with
 * `String.replace` against the vendored ThreeUI source. A replacement whose
 * anchor no longer matches is silently a no-op, so an upstream refresh could
 * drop the detail shaders, the pause gate, or the panel focus without any
 * error. These assertions fail instead.
 */
describe('elemental-lightning document', () => {
  it('carries the registered ThreeUI source revision', () => {
    const digest = createHash('sha256').update(readFileSync(canonicalPath)).digest('hex');

    expect(digest).toBe('7a6871fe99fa5e1551b27b2601f2a22dd23320ea2c90b5432c9c8e071f0b1d1d');
  });

  it('focuses the lightning panel and strips remote fonts', () => {
    const document = buildFocusedDocument('lightning', 1, 1);

    expect(document).toContain('.panel[data-fx="lightning"] {');
    expect(document).toContain('<style data-elements-focus>');
    expect(document).not.toContain('fonts.googleapis.com');
    expect(document).not.toContain('fonts.gstatic.com');
  });

  it('installs the speed and pause controls the host drives by postMessage', () => {
    const document = buildFocusedDocument('lightning', 1, 1);

    expect(document).toContain('<script data-elements-controls>');
    expect(document).toContain("event.data.type !== 'elements-controls'");
    expect(document).toContain(
      'if (!window.__ELEMENTS_PAUSED) for (const p of panels) p.draw(t);',
    );
    expect(document).not.toContain('\nfor (const p of panels) p.draw(t);');
  });

  it('applies the higher-detail arc shader in place of the source version', () => {
    const document = buildFocusedDocument('lightning', 1, 1);

    // From DETAIL_PATCHES: five layered contour arcs replace the source's three.
    expect(document).toContain('for (int i = 0; i < 5; i++){');
    expect(document).toContain('float branchLife = smoothstep(0.35, 0.92,');
    expect(document).toContain('const SDF_SIZE = 768;');
    expect(document).toContain('const SDF_SIZE = 768;\nconst SDF_SPREAD = 192;');
    expect(document).not.toContain('// fBm zigzag arcs crawling the contour');
  });

  it('resolves zoom and particle count from the size and amount props', () => {
    const document = buildFocusedDocument('lightning', 1, 1);

    expect(document).toContain('zoom: 1.6600');
    expect(document).toContain('count: 360');
    expect(document).not.toContain('zoom: 1.10');

    const denser = buildFocusedDocument('lightning', 1.5, 2);

    expect(denser).toContain('zoom: 1.1067');
    expect(denser).toContain('count: 720');
  });
});

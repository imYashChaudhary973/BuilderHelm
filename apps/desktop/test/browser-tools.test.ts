import type { BrowserSettings } from '@builderhelm/protocol/browser';
import { describe, expect, it } from 'vitest';

import { toCapturePoint } from '../src/renderer/src/draw-geometry.js';
import {
  resolveTerminalLinkTarget,
  TERMINAL_LINK_PATTERN,
} from '../src/renderer/src/terminal-links.js';

const settings: BrowserSettings = {
  homePage: '',
  searchEngine: 'google',
  zoomPercent: 100,
  linkRouting: false,
  shiftOpensInApp: false,
  terminalLinkActions: false,
  localhostWorktreeLabels: false,
  activeProfileId: '00000000-0000-4000-8000-000000000001',
  profiles: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Default',
      isDefault: true,
      cookieDomains: [],
      cookieCount: 0,
      createdAt: '2026-08-30T00:00:00.000Z',
    },
  ],
};

const plain = { metaKey: false, ctrlKey: false, shiftKey: false };
const superShift = { metaKey: true, ctrlKey: false, shiftKey: true };

describe('terminal link routing', () => {
  it('follows the routing preference on a plain click', () => {
    expect(resolveTerminalLinkTarget(settings, plain)).toBe('system');
    expect(resolveTerminalLinkTarget({ ...settings, linkRouting: true }, plain)).toBe(
      'app',
    );
  });

  it('always escapes to the system browser on shift-super click', () => {
    expect(
      resolveTerminalLinkTarget({ ...settings, linkRouting: true }, superShift),
    ).toBe('system');
  });

  it('honours the shift override only while routing is off', () => {
    expect(
      resolveTerminalLinkTarget({ ...settings, shiftOpensInApp: true }, superShift),
    ).toBe('app');
    expect(
      resolveTerminalLinkTarget(
        { ...settings, linkRouting: true, shiftOpensInApp: true },
        superShift,
      ),
    ).toBe('system');
  });

  it('asks first when link actions are enabled', () => {
    const asking = { ...settings, terminalLinkActions: true, linkRouting: true };
    expect(resolveTerminalLinkTarget(asking, plain)).toBe('ask');
    // The escape hatch must not be swallowed by the action sheet.
    expect(resolveTerminalLinkTarget(asking, superShift)).toBe('system');
  });

  it('falls back to the system browser before settings have loaded', () => {
    expect(resolveTerminalLinkTarget(null, plain)).toBe('system');
  });

  it('matches printed URLs without trailing punctuation', () => {
    const line = 'Local: http://127.0.0.1:5173/ (press h), docs at https://a.test/x.';
    expect([...line.matchAll(TERMINAL_LINK_PATTERN)].map((match) => match[0])).toEqual([
      'http://127.0.0.1:5173/',
      'https://a.test/x',
    ]);
  });
});

describe('screenshot markup geometry', () => {
  it('scales pointer positions into capture pixels', () => {
    // A 2x capture shown at half size: the centre of the box is the centre of
    // the bitmap, not a quarter of the way in.
    expect(
      toCapturePoint(
        { x: 100, y: 60 },
        { left: 50, top: 10, width: 200, height: 100 },
        { width: 800, height: 400 },
      ),
    ).toEqual({ x: 200, y: 200 });
  });

  it('never divides by a collapsed box', () => {
    expect(
      toCapturePoint(
        { x: 5, y: 5 },
        { left: 0, top: 0, width: 0, height: 0 },
        { width: 100, height: 100 },
      ),
    ).toEqual({ x: 500, y: 500 });
  });
});

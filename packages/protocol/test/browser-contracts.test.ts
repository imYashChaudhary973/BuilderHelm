import { describe, expect, it } from 'vitest';

import {
  BROWSER_SEARCH_ENGINES,
  browserCommandInputSchema,
  browserCookieImportFileSchema,
  browserMenuInputSchema,
  browserProfilePartition,
  browserSettingsSchema,
  browserSettingsUpdateInputSchema,
  formatAnnotationDetail,
  previewDrawSaveInputSchema,
  previewPickSchema,
  resolveOmniboxTarget,
  stepBrowserZoom,
  toBrowserCookieWrite,
  type PreviewPick,
} from '../src/browser.js';

const pick: PreviewPick = {
  locator: 'main>section:nth-of-type(2)>button',
  role: 'button',
  name: 'Checkout',
  rect: { x: 40, y: 120, width: 180, height: 44 },
  url: 'http://127.0.0.1:3000/cart',
  viewport: 'desktop',
  pngBase64: null,
};

describe('omnibox resolution', () => {
  it('navigates to host-shaped input and searches everything else', () => {
    expect(resolveOmniboxTarget('example.com/pricing', 'google')).toBe(
      'http://example.com/pricing',
    );
    expect(resolveOmniboxTarget('localhost:5173', 'google')).toBe(
      'http://localhost:5173/',
    );
    expect(resolveOmniboxTarget('127.0.0.1:8080/app', 'google')).toBe(
      'http://127.0.0.1:8080/app',
    );
    // A phrase must never be guessed into a hostname.
    expect(resolveOmniboxTarget('how to center a div', 'google')).toBe(
      `${BROWSER_SEARCH_ENGINES.google.query}how%20to%20center%20a%20div`,
    );
    expect(resolveOmniboxTarget('builderhelm', 'duckduckgo')).toBe(
      `${BROWSER_SEARCH_ENGINES.duckduckgo.query}builderhelm`,
    );
    expect(resolveOmniboxTarget('   ', 'bing')).toBeNull();
  });

  it('encodes query characters that would otherwise change the URL', () => {
    expect(resolveOmniboxTarget('a&b=c #tag', 'bing')).toBe(
      `${BROWSER_SEARCH_ENGINES.bing.query}a%26b%3Dc%20%23tag`,
    );
  });

  it('sends non-web schemes to search instead of opening them', () => {
    // Reaching the navigation path with these would hand the shell a target.
    for (const raw of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
      expect(resolveOmniboxTarget(raw, 'google')).toBe(
        `${BROWSER_SEARCH_ENGINES.google.query}${encodeURIComponent(raw)}`,
      );
    }
  });
});

describe('browser settings contract', () => {
  it('rejects unknown fields and out-of-range zoom', () => {
    expect(browserSettingsUpdateInputSchema.safeParse({ zoomPercent: 137 }).success).toBe(
      false,
    );
    expect(
      browserSettingsUpdateInputSchema.safeParse({ searchEngine: 'yandex' }).success,
    ).toBe(false);
    expect(browserSettingsUpdateInputSchema.safeParse({ profiles: [] }).success).toBe(
      false,
    );
    expect(browserSettingsUpdateInputSchema.parse({ zoomPercent: 125 })).toEqual({
      zoomPercent: 125,
    });
  });

  it('requires at least one profile and a uuid active profile', () => {
    const base = {
      homePage: '',
      searchEngine: 'google',
      zoomPercent: 100,
      linkRouting: false,
      shiftOpensInApp: false,
      terminalLinkActions: true,
      localhostWorktreeLabels: false,
      activeProfileId: '00000000-0000-4000-8000-000000000001',
      profiles: [],
    };
    expect(browserSettingsSchema.safeParse(base).success).toBe(false);
    expect(
      browserSettingsSchema.safeParse({
        ...base,
        activeProfileId: 'default',
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
      }).success,
    ).toBe(false);
  });

  it('gives every profile its own persistent partition', () => {
    expect(browserProfilePartition('abc')).toBe('persist:builderhelm-browser:abc');
    expect(browserProfilePartition('abc')).not.toBe(browserProfilePartition('abd'));
  });
});

describe('cookie import validation', () => {
  it('accepts a Cookie-Editor export and drops unknown keys', () => {
    const parsed = browserCookieImportFileSchema.parse([
      {
        domain: '.example.com',
        name: 'session',
        value: 'abc',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        hostOnly: false,
        storeId: '0',
      },
    ]);
    expect(parsed[0]).not.toHaveProperty('storeId');
    const write = toBrowserCookieWrite(parsed[0]!);
    expect(write).toMatchObject({
      url: 'https://example.com/',
      domain: '.example.com',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  it('refuses domains and paths that would write to another origin', () => {
    expect(
      toBrowserCookieWrite({ domain: 'evil.com/../good.com', name: 'a', value: 'b' }),
    ).toBeNull();
    expect(
      toBrowserCookieWrite({
        domain: 'example.com',
        name: 'a',
        value: 'b',
        path: '../x',
      }),
    ).toBeNull();
    expect(
      toBrowserCookieWrite({ domain: 'exam ple.com', name: 'a', value: 'b' }),
    ).toBeNull();
    expect(toBrowserCookieWrite({ domain: '', name: 'a', value: 'b' })).toBeNull();
  });

  it('bounds the number of cookies one file can carry', () => {
    const many = Array.from({ length: 2001 }, (_, index) => ({
      domain: 'example.com',
      name: `c${String(index)}`,
      value: 'v',
    }));
    expect(browserCookieImportFileSchema.safeParse(many).success).toBe(false);
    expect(browserCookieImportFileSchema.safeParse([]).success).toBe(false);
  });
});

describe('tool contracts', () => {
  it('keeps markup and field values out of a selection', () => {
    expect(previewPickSchema.parse(pick)).toEqual(pick);
    expect(
      previewPickSchema.safeParse({ ...pick, html: '<input value="hunter2">' }).success,
    ).toBe(false);
    expect(previewPickSchema.safeParse({ ...pick, locator: '' }).success).toBe(false);
  });

  it('describes an annotation without markup', () => {
    const detail = formatAnnotationDetail({ index: 3, note: 'label is cut off', pick });
    expect(detail).toBe(
      '#3 label is cut off — button "Checkout" @40,120 180x44 ' +
        '[main>section:nth-of-type(2)>button]',
    );
    expect(detail.length).toBeLessThanOrEqual(2000);
  });

  it('accepts binary markup and rejects a base64 payload', () => {
    expect(
      previewDrawSaveInputSchema.safeParse({ png: new ArrayBuffer(8) }).success,
    ).toBe(true);
    expect(previewDrawSaveInputSchema.safeParse({ png: 'iVBORw0KGgo=' }).success).toBe(
      false,
    );
  });

  it('takes only a menu kind and a position from the renderer', () => {
    expect(browserMenuInputSchema.parse({ kind: 'overflow', x: 10, y: 20 })).toEqual({
      kind: 'overflow',
      x: 10,
      y: 20,
    });
    // Items are built in main; a renderer-supplied list would be a target it chose.
    expect(
      browserMenuInputSchema.safeParse({ kind: 'overflow', x: 0, y: 0, items: [] })
        .success,
    ).toBe(false);
    expect(
      browserMenuInputSchema.safeParse({ kind: 'history', x: 0, y: 0 }).success,
    ).toBe(false);
  });

  it('validates the toolbar commands the renderer may send', () => {
    expect(browserCommandInputSchema.parse({ action: 'devtools' })).toEqual({
      action: 'devtools',
    });
    expect(
      browserCommandInputSchema.parse({ action: 'external', url: 'http://a.test/' }),
    ).toEqual({ action: 'external', url: 'http://a.test/' });
    expect(
      browserCommandInputSchema.parse({ action: 'visible', visible: false }),
    ).toEqual({ action: 'visible', visible: false });
    expect(
      browserCommandInputSchema.safeParse({ action: 'zoom', percent: 137 }).success,
    ).toBe(false);
    expect(browserCommandInputSchema.safeParse({ action: 'eval' }).success).toBe(false);
  });
});

describe('zoom stops', () => {
  it('steps through the allowed percents and clamps at the ends', () => {
    expect(stepBrowserZoom(100, 1)).toBe(110);
    expect(stepBrowserZoom(110, 1)).toBe(125);
    expect(stepBrowserZoom(150, 1)).toBe(150);
    expect(stepBrowserZoom(100, -1)).toBe(90);
    expect(stepBrowserZoom(75, -1)).toBe(75);
    expect(stepBrowserZoom(137, 1)).toBe(110);
  });
});

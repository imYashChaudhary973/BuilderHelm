import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  isAllowedNavigation,
  secureWebPreferences,
} from '../src/main/security.js';

describe('Electron security boundary', () => {
  it('keeps the renderer sandboxed and unprivileged', () => {
    expect(secureWebPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });

  it('denies scripts, frames, objects, and forms by default', () => {
    const policy = buildContentSecurityPolicy();

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it('allows Vite-injected styles in dev without loosening script eval', () => {
    const policy = buildContentSecurityPolicy({ dev: true });

    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('allows only same-document navigation for the app shell', () => {
    const shell = 'file:///Applications/BuilderHelm.app/out/renderer/index.html';

    expect(isAllowedNavigation(shell, `${shell}?x=1`)).toBe(true);
    expect(isAllowedNavigation(shell, `${shell}#/settings`)).toBe(true);
    // Every file:// URL shares the origin "null", so a stray in-app anchor
    // would otherwise navigate the shell away and blank the app.
    expect(isAllowedNavigation(shell, 'file:///settings/browser')).toBe(false);
    expect(isAllowedNavigation(shell, 'https://example.com/')).toBe(false);
    expect(isAllowedNavigation(shell, 'not a url')).toBe(false);
  });
  it('declares microphone use for the packaged Mac app', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      build?: { mac?: { extendInfo?: { NSMicrophoneUsageDescription?: string } } };
    };
    expect(manifest.build?.mac?.extendInfo?.NSMicrophoneUsageDescription).toMatch(
      /microphone/i,
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
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
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../electron.vite.config.js';

function localFlag(command: 'build' | 'serve', mode = 'development'): unknown {
  const resolved = config({ command, mode });
  const renderer = resolved.renderer;
  if (renderer === undefined || typeof renderer === 'function') {
    throw new Error('Expected a renderer configuration');
  }
  return renderer.define?.__LOCAL_DEVELOPMENT__;
}

afterEach(() => vi.unstubAllEnvs());

describe('local development entry', () => {
  it('requires an explicit dev-server opt-in', () => {
    vi.stubEnv('BUILDERHELM_LOCAL_DEVELOPMENT', undefined);
    expect(localFlag('serve')).toBe('false');
    vi.stubEnv('BUILDERHELM_LOCAL_DEVELOPMENT', 'true');
    expect(localFlag('serve')).toBe('false');
    vi.stubEnv('BUILDERHELM_LOCAL_DEVELOPMENT', '1');
    expect(localFlag('serve')).toBe('true');
  });

  it('disables local entry in every build even with the flag set', () => {
    vi.stubEnv('BUILDERHELM_LOCAL_DEVELOPMENT', '1');
    expect(localFlag('build', 'production')).toBe('false');
    expect(localFlag('build', 'development')).toBe('false');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('preload bridge boundary', () => {
  it('does not expose raw privileged Electron or Node primitives', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../apps/desktop/src/preload/index.ts'),
      'utf8',
    );
    const exposedValue = source
      .match(/exposeInMainWorld\([^,]+,\s*([^)]+)\)/)?.[1]
      ?.trim();

    expect(exposedValue).toBe('api');
    expect(source).not.toMatch(
      /exposeInMainWorld\([^)]*(?:ipcRenderer|node:fs|child_process)/,
    );
    expect(source).not.toContain('send(');
    expect(source).not.toContain('sendSync(');
    expect(source).not.toContain("from 'node:");
    expect(source).not.toContain("from '@zero/shared'");
  });

  it('builds the sandboxed preload as self-contained CommonJS', () => {
    const config = readFileSync(
      resolve(import.meta.dirname, '../../apps/desktop/electron.vite.config.ts'),
      'utf8',
    );

    expect(config).toContain("format: 'cjs'");
    expect(config).toContain("entryFileNames: '[name].cjs'");
    expect(config).toMatch(/exclude: \[[^\]]*'zod'[^\]]*\]/s);
  });
});

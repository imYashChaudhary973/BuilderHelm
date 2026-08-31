import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BROWSER_COOKIE_FILE_MAX_BYTES } from '@builderhelm/protocol/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

import { readCookieExport } from '../src/main/browser-cookies.js';

/**
 * The picker itself needs a human, but everything it hands to the import does
 * not: these cover the size limit, the JSON parse, and the shape check that
 * decide whether a file is allowed to touch a cookie store.
 */
describe('cookie export reading', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'builderhelm-cookies-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function file(name: string, contents: string): Promise<string> {
    const path = join(directory, name);
    await writeFile(path, contents, 'utf8');
    return path;
  }

  it('returns the validated rows of a supported export', async () => {
    const path = await file(
      'cookies.json',
      JSON.stringify([
        { name: 'session', value: 'abc', domain: 'app.test', path: '/', secure: true },
      ]),
    );

    const items = await readCookieExport(path);

    expect(items).toHaveLength(1);
    expect(items[0]?.domain).toBe('app.test');
  });

  it('refuses a file past the size limit before parsing it', async () => {
    const path = await file('big.json', 'x'.repeat(BROWSER_COOKIE_FILE_MAX_BYTES + 1));

    await expect(readCookieExport(path)).rejects.toThrow(/too large/i);
  });

  it('refuses a file that is not JSON', async () => {
    const path = await file('broken.json', '{ not json');

    await expect(readCookieExport(path)).rejects.toThrow(/valid JSON/i);
  });

  it('refuses JSON that is not a cookie export', async () => {
    const path = await file('wrong.json', JSON.stringify({ cookies: 'nope' }));

    await expect(readCookieExport(path)).rejects.toThrow(/supported cookie export/i);
  });

  it('refuses an empty array rather than importing nothing', async () => {
    const path = await file('empty.json', '[]');

    await expect(readCookieExport(path)).rejects.toThrow(/supported cookie export/i);
  });
});

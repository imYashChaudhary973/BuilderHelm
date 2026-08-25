import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}));

import { readEditorFile } from '../src/main/file-reader.js';

describe('readEditorFile', () => {
  it('reads utf-8 text and rejects files over 1 MB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zero-editor-'));
    try {
      const small = join(dir, 'note.txt');
      writeFileSync(small, 'hello');
      const file = readEditorFile(dir, small);
      expect(file.name).toBe('note.txt');
      expect(file.text).toBe('hello');
      expect(file.path.endsWith('note.txt')).toBe(true);

      const big = join(dir, 'big.txt');
      writeFileSync(big, Buffer.alloc(1_000_001));
      expect(() => readEditorFile(big)).toThrow(/larger than 1 MB/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

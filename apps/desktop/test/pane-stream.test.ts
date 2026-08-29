import { describe, expect, it } from 'vitest';

import { chunkTailAfter } from '../src/renderer/src/pane-stream.js';

/**
 * On reconnect a pane subscribes before its snapshot arrives, so live chunks and
 * the snapshot overlap. Writing a chunk the snapshot already contains is the
 * duplicate-output bug this arithmetic exists to prevent.
 */
describe('pane stream reconciliation', () => {
  it('drops a chunk the snapshot already contains', () => {
    // Chunk covers [10, 15); snapshot ends at 20.
    expect(chunkTailAfter('abcde', 15, 20)).toBe('');
  });

  it('keeps a chunk produced after the snapshot', () => {
    // Chunk covers [20, 25); snapshot ends at 20.
    expect(chunkTailAfter('abcde', 25, 20)).toBe('abcde');
  });

  it('keeps only the new tail when a chunk straddles the boundary', () => {
    // Chunk covers [18, 23); snapshot ends at 20, so 'a' and 'b' are already on
    // screen and only 'cde' is new.
    expect(chunkTailAfter('abcde', 23, 20)).toBe('cde');
  });

  it('treats the exact boundary as fully new', () => {
    expect(chunkTailAfter('abcde', 25, 25)).toBe('');
    expect(chunkTailAfter('abcde', 26, 21)).toBe('abcde');
  });

  it('writes everything when there is no snapshot to reconcile against', () => {
    expect(chunkTailAfter('abcde', 5, 0)).toBe('abcde');
  });

  it('never duplicates across a sequence of chunks', () => {
    const chunks = [
      { text: 'hello ', offset: 6 },
      { text: 'world', offset: 11 },
      { text: '!', offset: 12 },
    ];
    // Snapshot captured mid-stream, inside the second chunk.
    const snapshotEnd = 8;
    const written = chunks
      .map((c) => chunkTailAfter(c.text, c.offset, snapshotEnd))
      .join('');
    // 'hello wo' is in the snapshot; the stream continues exactly once from there.
    expect(written).toBe('rld!');
    expect('hello wo' + written).toBe('hello world!');
  });
});

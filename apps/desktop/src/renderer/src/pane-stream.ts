/**
 * Reconciles live pane output against the drain snapshot on reconnect.
 *
 * A pane subscribes before its snapshot arrives, because unsubscribing would
 * drop whatever the process writes while the drain is in flight. The snapshot is
 * the pane's whole history, so any chunk written before it lands would be shown
 * twice. Every data chunk therefore carries the stream offset it ends at, and
 * the snapshot carries the offset it ends at, which is enough to write each
 * chunk exactly once.
 */

/**
 * The part of a chunk that falls at or after `from`.
 *
 * `offset` is the stream position just past the chunk, so the chunk covers
 * `[offset - text.length, offset)`. A chunk can straddle the snapshot boundary,
 * in which case only its tail is new.
 */
export function chunkTailAfter(text: string, offset: number, from: number): string {
  const start = offset - text.length;
  if (start >= from) return text;
  const skip = from - start;
  return skip >= text.length ? '' : text.slice(skip);
}

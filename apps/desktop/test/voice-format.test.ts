import { describe, expect, it } from 'vitest';

import { formatDictation } from '../src/renderer/src/voice/format.js';

describe('formatDictation', () => {
  it('turns spoken numbers into digits and decimals', () => {
    expect(formatDictation('meet at four')).toBe('Meet at 4');
    expect(formatDictation('twenty four')).toBe('24');
    expect(formatDictation('four point five')).toBe('4.5');
  });

  it('applies spoken punctuation', () => {
    expect(formatDictation('hello period next line')).toBe('Hello. Next line');
    expect(formatDictation('one comma two')).toBe('1, 2');
  });

  it('keeps the correction after actually', () => {
    expect(formatDictation("let's meet at 5... actually 6pm")).toBe("Let's meet at 6pm");
    expect(formatDictation('meet at five actually six')).toBe('Meet at 6');
  });
});

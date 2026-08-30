import { describe, expect, it } from 'vitest';

import { formatDictation } from '../src/renderer/src/voice/format.js';
import { splitOnSilence } from '../src/renderer/src/voice/pcm.js';

describe('formatDictation', () => {
  it('turns spoken numbers into digits and decimals', () => {
    expect(formatDictation('meet at four')).toBe('Meet at 4');
    expect(formatDictation('twenty three')).toBe('23');
    expect(formatDictation('twenty four')).toBe('24');
    expect(formatDictation('four point five')).toBe('4.5');
    expect(formatDictation('meet at five pm')).toBe('Meet at 5pm');
  });

  it('applies spoken punctuation', () => {
    expect(formatDictation('hello period next line')).toBe('Hello. Next line');
    expect(formatDictation('one comma two')).toBe('1, 2');
    expect(formatDictation('ready question mark')).toBe('Ready?');
    expect(formatDictation('go exclamation')).toBe('Go!');
    expect(formatDictation('label colon value')).toBe('Label: value');
  });

  it('replaces the previous time or number on spoken corrections', () => {
    expect(formatDictation("Let's Meet at 5pm, no actually 6pm")).toBe(
      "Let's Meet at 6pm",
    );
    expect(formatDictation("let's meet at 5... actually 6pm")).toBe("Let's meet at 6pm");
    expect(formatDictation('meet at five actually six')).toBe('Meet at 6');
    expect(formatDictation('start at 5 I mean 7')).toBe('Start at 7');
    expect(formatDictation("see you at 5 no wait, 8 o'clock")).toBe('See you at 8:00');
  });
});

describe('splitOnSilence', () => {
  it('keeps a continuous clip as one part', () => {
    const samples = new Float32Array(1600).fill(0.2);
    expect(splitOnSilence(samples).length).toBe(1);
  });
});

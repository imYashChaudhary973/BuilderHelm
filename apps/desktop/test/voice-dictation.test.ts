import { describe, expect, it, vi } from 'vitest';

import { VoiceHotkeys } from '../src/main/voice-hotkeys.js';
import { createDictation } from '../src/renderer/src/voice/dictation.js';
import { eventMatchesAccelerator } from '../src/renderer/src/voice/hotkey.js';
import {
  insertTranscript,
  lastTerminalFocus,
  resolveInsertTarget,
  setTerminalFocus,
} from '../src/renderer/src/voice/insert.js';
import {
  bytesToBase64,
  downsample,
  encodeWavPcm16,
  peakRms,
  rms,
} from '../src/renderer/src/voice/pcm.js';

function settings(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    dictationMode: 'toggle' as const,
    hotkey: 'CommandOrControl+Shift+V',
    microphoneId: null,
    modelId: 'whisper-tiny',
    ...over,
  };
}

function tone(amplitude = 0.4, samples = 1600): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) out[i] = amplitude;
  return out;
}

describe('voice pcm', () => {
  it('downsamples to 16 kHz and writes a PCM WAV', () => {
    const input = new Float32Array(48_000);
    input[0] = 0.5;
    const out = downsample(input, 48_000, 16_000);
    expect(out.length).toBe(16_000);
    const wav = encodeWavPcm16(out, 16_000);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
    expect(bytesToBase64(wav).length).toBeGreaterThan(40);
  });

  it('treats a quiet buffer as silence', () => {
    expect(rms(new Float32Array(1600))).toBe(0);
    expect(peakRms(tone(0.4))).toBeGreaterThan(0.3);
  });
});

describe('voice hotkey match', () => {
  const event = {
    key: 'v',
    code: 'KeyV',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  };

  it('matches CommandOrControl+Shift+V on mac', () => {
    expect(eventMatchesAccelerator(event, 'CommandOrControl+Shift+V', 'MacIntel')).toBe(
      true,
    );
    expect(
      eventMatchesAccelerator(
        { ...event, metaKey: false, ctrlKey: true },
        'CommandOrControl+Shift+V',
        'Win32',
      ),
    ).toBe(true);
    expect(
      eventMatchesAccelerator(
        { ...event, shiftKey: false },
        'CommandOrControl+Shift+V',
        'MacIntel',
      ),
    ).toBe(false);
  });
});

describe('voice insert target', () => {
  it('falls back to the last focused terminal pane', () => {
    setTerminalFocus(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    );
    expect(lastTerminalFocus()?.paneId).toBe('22222222-2222-2222-2222-222222222222');
    expect(resolveInsertTarget(null).kind).toBe('pane');
  });

  it('writes dictated text to the focused pane through board.write', () => {
    const write = vi.fn(async () => ({ written: true as const }));
    vi.stubGlobal('window', { builderHelm: { board: { write } } });
    vi.stubGlobal('crypto', {
      randomUUID: () => '33333333-3333-3333-3333-333333333333',
    });
    expect(
      insertTranscript('hello helm', {
        kind: 'pane',
        pane: {
          sessionId: '11111111-1111-1111-1111-111111111111',
          paneId: '22222222-2222-2222-2222-222222222222',
        },
      }),
    ).toBe('pane');
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '11111111-1111-1111-1111-111111111111',
        paneId: '22222222-2222-2222-2222-222222222222',
        data: 'hello helm',
      }),
    );
  });
});

describe('voice hotkeys', () => {
  it('registers toggle mode and unregisters hold mode', () => {
    const register = vi.fn(() => true);
    const unregister = vi.fn();
    const broadcastPress = vi.fn();
    const hotkeys = new VoiceHotkeys({ register, unregister, broadcastPress });
    const base = {
      enabled: true,
      dictationMode: 'toggle' as const,
      hotkey: 'CommandOrControl+Shift+V',
      microphoneId: null,
      modelId: 'whisper-tiny' as const,
    };
    hotkeys.sync(base);
    expect(register).toHaveBeenCalledOnce();
    hotkeys.sync({ ...base, dictationMode: 'hold' });
    expect(unregister).toHaveBeenCalledOnce();
    hotkeys.dispose();
  });
});

describe('dictation machine', () => {
  it('toggle start/stop transcribes speech and inserts', async () => {
    const insert = vi.fn(() => 'field' as const);
    const transcribe = vi.fn(async () => ({ text: 'hello helm' }));
    const dictation = createDictation({
      capture: async ({ onLevel }) => {
        onLevel(0.4);
        return { stop: () => tone() };
      },
      transcribe,
      insert,
      settings: async () => settings(),
    });
    await dictation.handleHotkeyPress();
    expect(dictation.getHud().phase).toBe('listening');
    await dictation.handleHotkeyPress();
    expect(transcribe).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith('hello helm', expect.anything());
    expect(dictation.getHud().phase).toBe('idle');
  });

  it('skips transcribe on silence', async () => {
    const transcribe = vi.fn(async () => ({ text: 'nope' }));
    const dictation = createDictation({
      capture: async () => ({ stop: () => new Float32Array(1600) }),
      transcribe,
      insert: vi.fn(() => 'none'),
      settings: async () => settings(),
    });
    await dictation.start();
    await dictation.stop();
    expect(transcribe).not.toHaveBeenCalled();
    expect(dictation.getHud().error).toMatch(/hear/i);
  });

  it('hold mode starts on keydown and stops on keyup', async () => {
    const transcribe = vi.fn(async () => ({ text: 'held' }));
    const insert = vi.fn(() => 'pane' as const);
    const dictation = createDictation({
      capture: async () => ({ stop: () => tone() }),
      transcribe,
      insert,
      settings: async () => settings({ dictationMode: 'hold' }),
    });
    const key = {
      key: 'v',
      code: 'KeyV',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    };
    await dictation.handleKeyDown(key);
    expect(dictation.getHud().phase).toBe('listening');
    await dictation.handleKeyUp(key);
    expect(insert).toHaveBeenCalledWith('held', expect.anything());
  });

  it('cancel drops an in-flight transcript', async () => {
    const { promise, resolve } = Promise.withResolvers<{ text: string }>();
    const insert = vi.fn(() => 'field' as const);
    const dictation = createDictation({
      capture: async () => ({ stop: () => tone() }),
      transcribe: () => promise,
      insert,
      settings: async () => settings(),
    });
    await dictation.start();
    const stopping = dictation.stop();
    dictation.cancel();
    resolve({ text: 'late' });
    await stopping;
    expect(insert).not.toHaveBeenCalled();
    expect(dictation.getHud().phase).toBe('idle');
    expect(dictation.getHud().partial).toBe('');
  });
});

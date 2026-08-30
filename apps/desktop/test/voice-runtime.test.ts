import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VoiceModelManager } from '../src/main/voice-models.js';
import { VoiceRuntime } from '../src/main/voice-runtime.js';

const fixtureWav = fileURLToPath(new URL('./fixtures/voice/0.wav', import.meta.url));

const EXPECTED =
  'AFTER EARLY NIGHTFALL THE YELLOW LAMPS WOULD LIGHT UP HERE AND THERE THE SQUALID QUARTER OF THE BROTHELS';

const extracted =
  process.env.BUILDERHELM_VOICE_MODELS ??
  '/tmp/builderhelm-voice-models/sherpa-onnx-whisper-tiny.en';

function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('voice runtime', () => {
  it.skipIf(!existsSync(join(extracted, 'tiny.en-encoder.int8.onnx')))(
    'transcribes the fixture wav offline with whisper-tiny',
    async () => {
      const encoder = join(extracted, 'tiny.en-encoder.int8.onnx');
      const decoder = join(extracted, 'tiny.en-decoder.int8.onnx');
      const tokens = join(extracted, 'tiny.en-tokens.txt');
      const root = mkdtempSync(join(tmpdir(), 'voice-rt-'));
      const dest = join(root, 'whisper-tiny');
      mkdirSync(dest);
      symlinkSync(encoder, join(dest, 'tiny.en-encoder.int8.onnx'));
      symlinkSync(decoder, join(dest, 'tiny.en-decoder.int8.onnx'));
      symlinkSync(tokens, join(dest, 'tiny.en-tokens.txt'));

      const manager = new VoiceModelManager(root, async () => {
        throw new Error('network disabled');
      });
      expect(manager.installed('whisper-tiny')).toBe(true);

      const runtime = new VoiceRuntime(manager);
      const text = await runtime.transcribeWav('whisper-tiny', fixtureWav);
      expect(normalize(text)).toBe(EXPECTED);
    },
  );
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BuilderHelmError } from '@builderhelm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  OpenAITranscriptionAdapter,
  VOICE_MAX_AUDIO_BYTES,
  wavDurationSeconds,
  type GatewayFetch,
} from '../src/index.js';

const KEY = 'sk-test-transcription-sentinel-key';

function pcmWav(seconds: number, sampleRate = 16_000): Uint8Array {
  const samples = seconds * sampleRate;
  const dataBytes = samples * 2;
  const bytes = new Uint8Array(44 + Math.min(dataBytes, 2));
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

describe('wav duration', () => {
  it('reads PCM WAVE duration from the RIFF header', () => {
    expect(wavDurationSeconds(pcmWav(2))).toBeCloseTo(2, 5);
  });
});

describe('OpenAI transcription adapter', () => {
  it('posts multipart audio and returns the transcript text', async () => {
    const audio = pcmWav(1);
    const fetcher = vi.fn<GatewayFetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.openai.com/v1/audio/transcriptions');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${KEY}`);
      expect(headers.get('Content-Type') ?? '').not.toMatch(/application\/json/);
      const body = init?.body as FormData;
      expect(body.get('model')).toBe('gpt-4o-mini-transcribe');
      const file = body.get('file');
      expect(file).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ text: 'hello from the cloud' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await new OpenAITranscriptionAdapter(fetcher).transcribe({
      model: 'gpt-4o-mini-transcribe',
      apiKey: KEY,
      filename: 'clip.wav',
      bytes: audio,
    });

    expect(result).toEqual({ text: 'hello from the cloud' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('maps 401, 429, 413, and timeout without leaking the key', async () => {
    const audio = pcmWav(1);
    const cases = [
      { status: 401, code: 'AUTH_FAILED' },
      { status: 429, code: 'RATE_LIMITED' },
      { status: 413, code: 'CONTEXT_TOO_LARGE' },
    ] as const;

    for (const row of cases) {
      const adapter = new OpenAITranscriptionAdapter(
        async () => new Response('nope', { status: row.status }),
      );
      const error = await adapter
        .transcribe({
          model: 'gpt-4o-transcribe',
          apiKey: KEY,
          filename: 'clip.wav',
          bytes: audio,
        })
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(BuilderHelmError);
      expect((error as BuilderHelmError).code).toBe(row.code);
      expect(JSON.stringify(error)).not.toContain(KEY);
    }

    const timeout = new OpenAITranscriptionAdapter(async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    });
    const timed = await timeout
      .transcribe({
        model: 'gpt-4o-transcribe',
        apiKey: KEY,
        filename: 'clip.wav',
        bytes: audio,
      })
      .catch((cause: unknown) => cause);
    expect((timed as BuilderHelmError).code).toBe('INTEGRATION_OFFLINE');
    expect(JSON.stringify(timed)).not.toContain(KEY);
  });

  it('refuses oversized audio before any request', async () => {
    const fetcher = vi.fn<GatewayFetch>(async () => new Response('{}'));
    const bytes = new Uint8Array(VOICE_MAX_AUDIO_BYTES + 1);
    await expect(
      new OpenAITranscriptionAdapter(fetcher).transcribe({
        model: 'gpt-4o-transcribe',
        apiKey: KEY,
        filename: 'huge.wav',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_TOO_LARGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses overlong WAV audio before any request', async () => {
    const fetcher = vi.fn<GatewayFetch>(async () => new Response('{}'));
    await expect(
      new OpenAITranscriptionAdapter(fetcher).transcribe({
        model: 'gpt-4o-transcribe',
        apiKey: KEY,
        filename: 'long.wav',
        bytes: pcmWav(25 * 60 + 1),
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_TOO_LARGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.skipIf(process.env.OPENAI_API_KEY === undefined)(
    'transcribes the fixture wav with a live OpenAI key',
    async () => {
      const wav = new Uint8Array(
        readFileSync(
          resolve(import.meta.dirname, '../../../apps/desktop/test/fixtures/voice/0.wav'),
        ),
      );
      const result = await new OpenAITranscriptionAdapter().transcribe({
        model: 'gpt-4o-mini-transcribe',
        apiKey: process.env.OPENAI_API_KEY ?? '',
        filename: '0.wav',
        bytes: wav,
      });
      expect(result.text.toLowerCase()).toMatch(/nightfall|yellow|lamps/);
    },
  );
});

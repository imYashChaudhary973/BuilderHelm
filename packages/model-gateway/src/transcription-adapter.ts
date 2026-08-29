import { z } from 'zod';

import { BuilderHelmError } from '@builderhelm/shared';

import { normalizeProviderError } from './error-mapping.js';
import { ProviderHttpError, providerEndpoint, type GatewayFetch } from './http.js';

/** OpenAI file-transcription limit. */
export const VOICE_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Refuse recordings longer than this even when they fit in 25 MB. */
export const VOICE_MAX_AUDIO_SECONDS = 25 * 60;
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 60_000;

export const openaiTranscriptionModels = [
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
] as const;
export type OpenAITranscriptionModel = (typeof openaiTranscriptionModels)[number];

export interface TranscriptionInput {
  readonly model: OpenAITranscriptionModel;
  readonly apiKey: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
  readonly signal?: AbortSignal;
  readonly baseUrl?: string | null;
}

const transcriptionResponseSchema = z.object({ text: z.string() }).passthrough();

export class OpenAITranscriptionAdapter {
  constructor(private readonly fetcher: GatewayFetch = fetch) {}

  async transcribe(input: TranscriptionInput): Promise<{ text: string }> {
    if (input.bytes.byteLength === 0) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Audio is empty.');
    }
    if (input.bytes.byteLength > VOICE_MAX_AUDIO_BYTES) {
      throw new BuilderHelmError(
        'CONTEXT_TOO_LARGE',
        'Audio is larger than the 25 MB transcription limit.',
      );
    }
    const seconds = wavDurationSeconds(input.bytes);
    if (seconds !== null && seconds > VOICE_MAX_AUDIO_SECONDS) {
      throw new BuilderHelmError(
        'CONTEXT_TOO_LARGE',
        'Audio is longer than the 25 minute transcription limit.',
      );
    }

    const form = new FormData();
    form.append('model', input.model);
    const payload = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(payload).set(input.bytes);
    form.append(
      'file',
      new Blob([payload], { type: input.mimeType ?? 'audio/wav' }),
      input.filename,
    );
    const signal = transcribeSignal(input.signal);
    try {
      const response = await this.fetcher(
        providerEndpoint(
          input.baseUrl ?? 'https://api.openai.com/v1',
          'audio/transcriptions',
        ),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.apiKey}` },
          body: form,
          signal,
        },
      );
      if (!response.ok) throw new ProviderHttpError(response.status);
      const body = transcriptionResponseSchema.parse(await response.json());
      return { text: body.text };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }
}

function transcribeSignal(user?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(VOICE_TRANSCRIBE_TIMEOUT_MS);
  return user === undefined ? timeout : AbortSignal.any([user, timeout]);
}

function readFour(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/** PCM/WAVE duration from a RIFF header; null when the container is unknown. */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  if (readFour(bytes, 0) !== 'RIFF' || readFour(bytes, 8) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataBytes = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = readFour(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === 'fmt ' && size >= 16 && start + 16 <= bytes.byteLength) {
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === 'data') {
      dataBytes = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (sampleRate <= 0 || channels <= 0 || bits <= 0 || dataBytes <= 0) return null;
  return dataBytes / (sampleRate * channels * (bits / 8));
}

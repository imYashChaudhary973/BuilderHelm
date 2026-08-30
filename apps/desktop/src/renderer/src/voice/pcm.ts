export const VOICE_CAPTURE_RATE = 16_000;
export const SILENCE_RMS = 0.02;
export const LISTEN_MAX_MS = 60_000;

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function peakRms(samples: ArrayLike<number>, window = 1600): number {
  if (samples.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += window) {
    const end = Math.min(samples.length, i + window);
    let sum = 0;
    for (let j = i; j < end; j += 1) {
      const value = samples[j] ?? 0;
      sum += value * value;
    }
    peak = Math.max(peak, Math.sqrt(sum / (end - i)));
  }
  return peak;
}

/** Split 16 kHz PCM on gaps of low energy. Used as pause → period. */
export function splitOnSilence(
  samples: Float32Array,
  gapMs = 400,
  sampleRate = VOICE_CAPTURE_RATE,
  floor = SILENCE_RMS,
): Float32Array[] {
  const gap = Math.max(1, Math.floor((sampleRate * gapMs) / 1000));
  const frame = Math.max(1, Math.floor(sampleRate / 50));
  const parts: Float32Array[] = [];
  let start = 0;
  let silent = 0;
  for (let i = 0; i < samples.length; i += frame) {
    const slice = samples.subarray(i, Math.min(samples.length, i + frame));
    if (rms(slice) < floor) {
      silent += slice.length;
      if (silent >= gap && i + frame - silent > start) {
        const part = samples.subarray(start, i + frame - silent);
        if (part.length >= frame) parts.push(Float32Array.from(part));
        start = i + frame;
      }
    } else {
      silent = 0;
    }
  }
  const tail = samples.subarray(start);
  if (tail.length >= frame) parts.push(Float32Array.from(tail));
  return parts.length > 0 ? parts : [samples];
}

export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate = VOICE_CAPTURE_RATE,
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) return input;
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    const span = Math.max(1, end - start);
    for (let j = start; j < start + span; j += 1) sum += input[j] ?? 0;
    out[i] = sum / span;
  }
  return out;
}

export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate = VOICE_CAPTURE_RATE,
): Uint8Array {
  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    bytes[offset + i] = text.charCodeAt(i);
  }
}

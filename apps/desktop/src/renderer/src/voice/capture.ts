import { downsample, rms, VOICE_CAPTURE_RATE } from './pcm.js';

export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone access was declined. Allow it in System Settings → Privacy & Security → Microphone.';
  }
  if (name === 'NotFoundError') {
    return 'No microphone found.';
  }
  return 'Microphone unavailable.';
}

export async function startMicCapture(input: {
  deviceId: string | null;
  onLevel: (level: number) => void;
}): Promise<{ stop: () => Float32Array }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio:
      input.deviceId === null
        ? { channelCount: 1, echoCancellation: true, noiseSuppression: true }
        : {
            deviceId: { exact: input.deviceId },
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
  });
  const ctx = new AudioContext({ sampleRate: VOICE_CAPTURE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    const raw = event.inputBuffer.getChannelData(0);
    input.onLevel(rms(raw));
    chunks.push(
      downsample(
        Float32Array.from(raw),
        event.inputBuffer.sampleRate,
        VOICE_CAPTURE_RATE,
      ),
    );
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);
  return {
    stop() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
      let total = 0;
      for (const chunk of chunks) total += chunk.length;
      const out = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    },
  };
}

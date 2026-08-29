import { createRequire } from 'node:module';

import type { VoiceModelId } from '@builderhelm/protocol/voice';
import { BuilderHelmError } from '@builderhelm/shared';

import type { VoiceModelManager, VoiceModelPaths } from './voice-models.js';

const require = createRequire(import.meta.url);

interface SherpaWave {
  readonly sampleRate: number;
  readonly samples: Float32Array;
}

interface SherpaStream {
  acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { text?: string };
}

interface SherpaAddon {
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
  readWave(path: string): SherpaWave;
}

/**
 * Loads one local speech model at a time in the Electron main process.
 * Load and transcribe never touch the network.
 */
export class VoiceRuntime {
  private loaded: {
    readonly id: VoiceModelId;
    readonly recognizer: SherpaRecognizer;
  } | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly models: VoiceModelManager) {}

  unload(): void {
    this.loaded = null;
  }

  async transcribeWav(id: VoiceModelId, wavPath: string): Promise<string> {
    const recognizer = await this.load(id);
    const sherpa = loadSherpa();
    const stream = recognizer.createStream();
    const wave = sherpa.readWave(wavPath);
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    recognizer.decode(stream);
    return (recognizer.getResult(stream).text ?? '').trim();
  }

  private async load(id: VoiceModelId): Promise<SherpaRecognizer> {
    while (this.loading !== null) await this.loading;
    if (this.loaded?.id === id) return this.loaded.recognizer;

    const paths = this.models.paths(id);
    if (paths === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Install this speech model before using it.',
      );
    }

    let release: () => void = () => {};
    this.loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const sherpa = loadSherpa();
      const recognizer = new sherpa.OfflineRecognizer(recognizerConfig(id, paths));
      this.loaded = { id, recognizer };
      return recognizer;
    } finally {
      this.loading = null;
      release();
    }
  }
}
function loadSherpa(): SherpaAddon {
  return require('sherpa-onnx-node') as SherpaAddon;
}

function recognizerConfig(id: VoiceModelId, paths: VoiceModelPaths): unknown {
  const featConfig = { sampleRate: 16000, featureDim: 80 };
  if (id === 'whisper-tiny') {
    return {
      featConfig,
      modelConfig: {
        whisper: { encoder: paths.encoder, decoder: paths.decoder },
        tokens: paths.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    };
  }
  throw new BuilderHelmError(
    'MODEL_UNAVAILABLE',
    'This local engine is not wired for transcription yet.',
  );
}

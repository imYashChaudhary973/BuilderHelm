import type { CorrelationId } from '@builderhelm/shared';
import { z } from 'zod';

import { modelErrorSchema } from './model.js';

const correlationIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as CorrelationId);

/**
 * Speech-to-text engines behind the shipped models. `openai` is the only cloud
 * engine; the rest run on the local runtime and never leave the device.
 */
export const voiceEngines = ['parakeet', 'zipformer', 'whisper', 'openai'] as const;
export const voiceEngineSchema = z.enum(voiceEngines);
export type VoiceEngine = z.infer<typeof voiceEngineSchema>;

export const voiceRuntimes = ['local', 'cloud'] as const;
export const voiceRuntimeSchema = z.enum(voiceRuntimes);
export type VoiceRuntime = z.infer<typeof voiceRuntimeSchema>;

export const voiceModelIds = [
  'parakeet-tdt-v3',
  'parakeet-tdt-v2',
  'zipformer-bilingual',
  'whisper-tiny',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
] as const;
export const voiceModelIdSchema = z.enum(voiceModelIds);
export type VoiceModelId = z.infer<typeof voiceModelIdSchema>;

export interface VoiceModelCatalogEntry {
  readonly id: VoiceModelId;
  readonly label: string;
  readonly engine: VoiceEngine;
  readonly runtime: VoiceRuntime;
  /** Cloud models cannot run without a stored credential. */
  readonly requiresApiKey: boolean;
  readonly languages: string;
  readonly detail: string;
  /** Surfaced as the suggested pick; there is deliberately no default model. */
  readonly recommended: boolean;
  /** Approximate on-disk size once installed; null for cloud models. */
  readonly downloadBytes: number | null;
}

/**
 * The shipped speech models. Sizes are approximate and only drive the download
 * copy; the installer records the real byte count once a model is on disk.
 */
export const VOICE_MODEL_CATALOG: readonly VoiceModelCatalogEntry[] = [
  {
    id: 'parakeet-tdt-v3',
    label: 'Parakeet TDT v3',
    engine: 'parakeet',
    runtime: 'local',
    requiresApiKey: false,
    languages: 'Multilingual',
    detail: 'Highest accuracy on device. Largest download.',
    recommended: true,
    downloadBytes: 1_200_000_000,
  },
  {
    id: 'parakeet-tdt-v2',
    label: 'Parakeet TDT v2',
    engine: 'parakeet',
    runtime: 'local',
    requiresApiKey: false,
    languages: 'English',
    detail: 'Fast English dictation on device.',
    recommended: false,
    downloadBytes: 700_000_000,
  },
  {
    id: 'zipformer-bilingual',
    label: 'Zipformer Bilingual',
    engine: 'zipformer',
    runtime: 'local',
    requiresApiKey: false,
    languages: 'Chinese and English',
    detail: 'Streaming bilingual recognition on device.',
    recommended: false,
    downloadBytes: 350_000_000,
  },
  {
    id: 'whisper-tiny',
    label: 'Whisper Tiny',
    engine: 'whisper',
    runtime: 'local',
    requiresApiKey: false,
    languages: 'Multilingual',
    detail: 'Smallest download. Runs on any machine.',
    recommended: false,
    downloadBytes: 75_000_000,
  },
  {
    id: 'gpt-4o-transcribe',
    label: 'GPT-4o Transcribe',
    engine: 'openai',
    runtime: 'cloud',
    requiresApiKey: true,
    languages: 'Multilingual',
    detail: 'Sends audio to OpenAI. Needs an API key.',
    recommended: false,
    downloadBytes: null,
  },
  {
    id: 'gpt-4o-mini-transcribe',
    label: 'GPT-4o Mini Transcribe',
    engine: 'openai',
    runtime: 'cloud',
    requiresApiKey: true,
    languages: 'Multilingual',
    detail: 'Cheaper cloud transcription. Needs an API key.',
    recommended: false,
    downloadBytes: null,
  },
];

export function voiceModelCatalogEntry(id: VoiceModelId): VoiceModelCatalogEntry {
  const entry = VOICE_MODEL_CATALOG.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`Unknown voice model ${id}`);
  return entry;
}

/** Press the hotkey to start and again to stop, or hold it while speaking. */
export const voiceDictationModes = ['toggle', 'hold'] as const;
export const voiceDictationModeSchema = z.enum(voiceDictationModes);
export type VoiceDictationMode = z.infer<typeof voiceDictationModeSchema>;

/**
 * Accelerator in Electron's form, e.g. `CommandOrControl+Shift+V`.
 * Toggle mode registers it with `globalShortcut`. Hold mode matches
 * keydown/keyup on the focused window.
 */
export const voiceHotkeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9+]+$/, 'Use an accelerator such as CommandOrControl+Shift+V');

export const VOICE_DEFAULT_HOTKEY = 'CommandOrControl+Shift+V';

export const voiceSettingsSchema = z
  .object({
    enabled: z.boolean(),
    dictationMode: voiceDictationModeSchema,
    hotkey: voiceHotkeySchema,
    /** `null` follows the system default input device. */
    microphoneId: z.string().trim().min(1).max(200).nullable(),
    /** `null` until the user picks a model; there is no default. */
    modelId: voiceModelIdSchema.nullable(),
  })
  .strict();
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const voiceSettingsUpdateInputSchema = voiceSettingsSchema.partial().strict();
export type VoiceSettingsUpdateInput = z.infer<typeof voiceSettingsUpdateInputSchema>;

/** Per-model availability: catalog facts plus what this machine has. */
export const voiceModelStateSchema = z
  .object({
    id: voiceModelIdSchema,
    label: z.string().min(1).max(80),
    engine: voiceEngineSchema,
    runtime: voiceRuntimeSchema,
    languages: z.string().min(1).max(80),
    detail: z.string().min(1).max(200),
    recommended: z.boolean(),
    requiresApiKey: z.boolean(),
    downloadBytes: z.number().int().nonnegative().nullable(),
    /** Local models are installed on demand; cloud models are never installed. */
    installed: z.boolean(),
    /** True when this host can fetch the model archive. */
    downloadable: z.boolean(),
    /** Actual bytes on disk after install; null when missing. */
    bytesOnDisk: z.number().int().nonnegative().nullable(),
    /** True while a download for this model is in flight. */
    downloading: z.boolean(),
    /** False when a cloud model has no stored credential yet. */
    selectable: z.boolean(),
  })
  .strict();
export type VoiceModelState = z.infer<typeof voiceModelStateSchema>;

export const voiceStatusSchema = z
  .object({
    settings: voiceSettingsSchema,
    models: z.array(voiceModelStateSchema),
    openAiKeyPresent: z.boolean(),
  })
  .strict();
export type VoiceStatus = z.infer<typeof voiceStatusSchema>;

export const voiceKeySaveInputSchema = z
  .object({ apiKey: z.string().trim().min(20).max(400) })
  .strict();
export type VoiceKeySaveInput = z.infer<typeof voiceKeySaveInputSchema>;

export const voiceStatusRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();
export const voiceSettingsUpdateRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: voiceSettingsUpdateInputSchema })
  .strict();

/**
 * Installable archives for local engines. Only models listed here can be
 * downloaded; the rest of the catalog is still shown, but cannot be fetched
 * until a package is recorded.
 */
export const VOICE_MODEL_PACKAGES: Partial<
  Record<
    VoiceModelId,
    {
      readonly url: string;
      readonly sha256: string;
      readonly bytes: number;
      readonly archiveRoot: string;
      readonly kind: 'whisper' | 'nemo' | 'zipformer';
      readonly files: {
        readonly encoder: string;
        readonly decoder: string;
        readonly tokens: string;
        readonly joiner?: string;
      };
    }
  >
> = {
  'whisper-tiny': {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2',
    sha256: '2bd6cf965c8bb3e068ef9fa2191387ee63a9dfa2a4e37582a8109641c20005dd',
    bytes: 118_071_777,
    archiveRoot: 'sherpa-onnx-whisper-tiny.en',
    kind: 'whisper',
    files: {
      encoder: 'tiny.en-encoder.int8.onnx',
      decoder: 'tiny.en-decoder.int8.onnx',
      tokens: 'tiny.en-tokens.txt',
    },
  },
  'parakeet-tdt-v3': {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
    sha256: '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf',
    bytes: 487_170_055,
    archiveRoot: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    kind: 'nemo',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      joiner: 'joiner.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  'parakeet-tdt-v2': {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
    sha256: '157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad',
    bytes: 482_468_385,
    archiveRoot: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    kind: 'nemo',
    files: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      joiner: 'joiner.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  'zipformer-bilingual': {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2',
    sha256: '27ffbd9ee24ad186d99acc2f6354d7992b27bcab490812510665fa8f9389c5f8',
    bytes: 511_274_346,
    archiveRoot: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    kind: 'zipformer',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
};

export function voiceModelPackage(id: VoiceModelId) {
  return VOICE_MODEL_PACKAGES[id];
}

export const voiceModelEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('download.progress'),
      modelId: voiceModelIdSchema,
      receivedBytes: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('download.done'),
      modelId: voiceModelIdSchema,
      bytesOnDisk: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('download.error'),
      modelId: voiceModelIdSchema,
      message: z.string().min(1).max(400),
    })
    .strict(),
  z
    .object({
      type: z.literal('download.cancelled'),
      modelId: voiceModelIdSchema,
    })
    .strict(),
]);
export type VoiceModelEvent = z.infer<typeof voiceModelEventSchema>;

export const voiceModelIdInputSchema = z.object({ modelId: voiceModelIdSchema }).strict();
export type VoiceModelIdInput = z.infer<typeof voiceModelIdInputSchema>;

export const voiceTranscribeInputSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+$/),
    audioBase64: z.string().min(1).max(34_000_000),
  })
  .strict();
export type VoiceTranscribeInput = z.infer<typeof voiceTranscribeInputSchema>;

export const voiceHotkeyEventSchema = z.object({ type: z.literal('press') }).strict();
export type VoiceHotkeyEvent = z.infer<typeof voiceHotkeyEventSchema>;

export const voiceTranscribeResultSchema = z.object({ text: z.string() }).strict();
export type VoiceTranscribeResult = z.infer<typeof voiceTranscribeResultSchema>;

export const voiceModelDownloadRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: voiceModelIdInputSchema })
  .strict();
export const voiceModelCancelRequestSchema = voiceModelDownloadRequestSchema;
export const voiceModelDeleteRequestSchema = voiceModelDownloadRequestSchema;
export const voiceTranscribeRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: voiceTranscribeInputSchema })
  .strict();
export const voiceKeySaveRequestSchema = z
  .object({ correlationId: correlationIdSchema, input: voiceKeySaveInputSchema })
  .strict();
export const voiceKeyDeleteRequestSchema = z
  .object({ correlationId: correlationIdSchema })
  .strict();

function ipcResult<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: modelErrorSchema }).strict(),
  ]);
}

export const voiceStatusIpcResponseSchema = ipcResult(voiceStatusSchema);
export const voiceKeyDeleteIpcResponseSchema = ipcResult(voiceStatusSchema);
export const voiceTranscribeIpcResponseSchema = ipcResult(voiceTranscribeResultSchema);

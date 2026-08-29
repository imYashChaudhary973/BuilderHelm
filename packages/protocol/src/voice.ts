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
 * Accelerator in Electron's form, e.g. `CommandOrControl+Shift+V`. Dictation is
 * in-app only, so this is matched against key events in the focused window
 * rather than registered as a system-wide shortcut.
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

import type { BuilderHelmDatabase } from './database.js';

export interface StoredVoiceSettings extends Record<string, unknown> {
  enabled: number;
  dictationMode: string;
  hotkey: string;
  microphoneId: string | null;
  modelId: string | null;
  updatedAt: string;
}

export interface VoiceSettingsWrite {
  readonly enabled: boolean;
  readonly dictationMode: string;
  readonly hotkey: string;
  readonly microphoneId: string | null;
  readonly modelId: string | null;
  readonly updatedAt: string;
}

const voiceColumns = `
  enabled,
  dictation_mode AS dictationMode,
  hotkey,
  microphone_id AS microphoneId,
  model_id AS modelId,
  updated_at AS updatedAt
`;

/**
 * Single-row store for the dictation settings. `read` returning undefined means
 * the user has never opened Voice, which the service answers with defaults
 * rather than writing a row nobody asked for.
 */
export class VoiceRepository {
  constructor(private readonly database: BuilderHelmDatabase) {}

  read(): StoredVoiceSettings | undefined {
    return this.database.queryOne<StoredVoiceSettings>(
      `SELECT ${voiceColumns} FROM voice_settings WHERE id = 1`,
    );
  }

  write(settings: VoiceSettingsWrite): void {
    this.database.run(
      `INSERT INTO voice_settings (
        id, enabled, dictation_mode, hotkey, microphone_id, model_id, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        enabled = excluded.enabled,
        dictation_mode = excluded.dictation_mode,
        hotkey = excluded.hotkey,
        microphone_id = excluded.microphone_id,
        model_id = excluded.model_id,
        updated_at = excluded.updated_at`,
      [
        Number(settings.enabled),
        settings.dictationMode,
        settings.hotkey,
        settings.microphoneId,
        settings.modelId,
        settings.updatedAt,
      ],
    );
  }
}

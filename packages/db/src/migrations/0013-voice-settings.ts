import type { Migration } from '../migration-runner.js';

/**
 * Voice dictation settings. One row, enforced by the primary-key check: the
 * feature is per-install, not per-project. `model_id` stays NULL until the user
 * picks a speech model, because there is deliberately no default.
 */
export const voiceSettingsMigration: Migration = {
  version: 13,
  name: 'voice-settings',
  up(database) {
    database.execute(`
      CREATE TABLE voice_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        dictation_mode TEXT NOT NULL CHECK (dictation_mode IN ('toggle', 'hold')),
        hotkey TEXT NOT NULL CHECK (length(trim(hotkey)) BETWEEN 1 AND 64),
        microphone_id TEXT CHECK (
          microphone_id IS NULL OR length(trim(microphone_id)) BETWEEN 1 AND 200
        ),
        model_id TEXT CHECK (
          model_id IS NULL OR model_id IN (
            'parakeet-tdt-v3',
            'parakeet-tdt-v2',
            'zipformer-bilingual',
            'whisper-tiny',
            'gpt-4o-transcribe',
            'gpt-4o-mini-transcribe'
          )
        ),
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  },
};

import { describe, expect, it } from 'vitest';

import {
  VOICE_DEFAULT_HOTKEY,
  VOICE_MODEL_CATALOG,
  voiceHotkeySchema,
  voiceModelCatalogEntry,
  voiceModelIds,
  voiceSettingsSchema,
  voiceSettingsUpdateInputSchema,
  voiceStatusSchema,
} from '../src/voice.js';

describe('voice model catalog', () => {
  it('covers every declared model id exactly once', () => {
    expect(VOICE_MODEL_CATALOG.map((entry) => entry.id)).toEqual([...voiceModelIds]);
  });

  it('ties the credential requirement to the cloud runtime', () => {
    for (const entry of VOICE_MODEL_CATALOG) {
      // A local model that demanded a key, or a cloud model that did not, would
      // let the service authorise the wrong thing.
      expect(entry.requiresApiKey).toBe(entry.runtime === 'cloud');
      expect(entry.downloadBytes === null).toBe(entry.runtime === 'cloud');
    }
  });

  it('recommends Parakeet TDT v3 and nothing else', () => {
    expect(VOICE_MODEL_CATALOG.filter((entry) => entry.recommended)).toHaveLength(1);
    expect(voiceModelCatalogEntry('parakeet-tdt-v3').recommended).toBe(true);
  });

  it('rejects an unknown model id', () => {
    // @ts-expect-error the catalog lookup is exhaustive over VoiceModelId
    expect(() => voiceModelCatalogEntry('parakeet-tdt-v9')).toThrow(
      /Unknown voice model/,
    );
  });
});

describe('voice settings contract', () => {
  const settings = {
    enabled: true,
    dictationMode: 'hold' as const,
    hotkey: VOICE_DEFAULT_HOTKEY,
    microphoneId: null,
    modelId: 'whisper-tiny' as const,
  };

  it('accepts a null model, because there is no default', () => {
    expect(voiceSettingsSchema.parse({ ...settings, modelId: null }).modelId).toBeNull();
  });

  it('rejects an unknown dictation mode', () => {
    expect(() =>
      voiceSettingsSchema.parse({ ...settings, dictationMode: 'push-to-talk' }),
    ).toThrow();
  });

  it('rejects unknown keys so drift cannot ride along', () => {
    expect(() => voiceSettingsSchema.parse({ ...settings, language: 'en' })).toThrow();
    expect(() =>
      voiceSettingsUpdateInputSchema.parse({ microphoneLabel: 'MacBook Mic' }),
    ).toThrow();
  });

  it('accepts an empty update patch', () => {
    expect(voiceSettingsUpdateInputSchema.parse({})).toEqual({});
  });

  it('takes accelerators and refuses free text', () => {
    expect(voiceHotkeySchema.parse('CommandOrControl+Shift+V')).toBe(
      'CommandOrControl+Shift+V',
    );
    expect(() => voiceHotkeySchema.parse('press the mic button')).toThrow();
  });
});

describe('voice status contract', () => {
  it('requires per-model availability alongside the settings', () => {
    const status = voiceStatusSchema.parse({
      settings: {
        enabled: false,
        dictationMode: 'toggle',
        hotkey: VOICE_DEFAULT_HOTKEY,
        microphoneId: null,
        modelId: null,
      },
      openAiKeyPresent: false,
      models: VOICE_MODEL_CATALOG.map((entry) => ({
        id: entry.id,
        label: entry.label,
        engine: entry.engine,
        runtime: entry.runtime,
        languages: entry.languages,
        detail: entry.detail,
        recommended: entry.recommended,
        requiresApiKey: entry.requiresApiKey,
        downloadBytes: entry.downloadBytes,
        installed: false,
        selectable: entry.runtime === 'local',
      })),
    });

    expect(status.models).toHaveLength(voiceModelIds.length);
    expect(status.openAiKeyPresent).toBe(false);
  });
});

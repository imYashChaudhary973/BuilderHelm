import {
  migrations,
  openDatabase,
  runMigrations,
  VoiceRepository,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import { createLogger } from '@builderhelm/observability';
import { createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MemorySecretStore,
  VoiceService,
  VOICE_OPENAI_SECRET_REF,
} from '../src/index.js';

const open = new Set<BuilderHelmDatabase>();

function setup(): {
  repository: VoiceRepository;
  secrets: MemorySecretStore;
  service: VoiceService;
  logs: string[];
} {
  const database = openDatabase(':memory:');
  open.add(database);
  runMigrations(database, migrations);
  const repository = new VoiceRepository(database);
  const secrets = new MemorySecretStore();
  const logs: string[] = [];
  return {
    repository,
    secrets,
    service: new VoiceService(
      repository,
      secrets,
      createLogger((line) => logs.push(line)),
    ),
    logs,
  };
}

afterEach(() => {
  for (const database of open) database.close();
  open.clear();
});

describe('voice settings', () => {
  it('starts disabled with no model chosen', async () => {
    const { service, repository } = setup();

    const status = await service.status();

    expect(status.settings).toEqual({
      enabled: false,
      dictationMode: 'toggle',
      hotkey: 'CommandOrControl+Shift+V',
      microphoneId: null,
      modelId: null,
    });
    // Reading must not write: an untouched install has no row.
    expect(repository.read()).toBeUndefined();
  });

  it('persists a local model, mode, hotkey and microphone', async () => {
    const { service, repository } = setup();

    const status = await service.updateSettings(
      {
        enabled: true,
        dictationMode: 'hold',
        hotkey: 'Alt+Space',
        microphoneId: 'usb-mic-1',
        modelId: 'parakeet-tdt-v3',
      },
      createCorrelationId(),
    );

    expect(status.settings.modelId).toBe('parakeet-tdt-v3');
    expect(status.settings.dictationMode).toBe('hold');
    expect(repository.read()).toMatchObject({
      enabled: 1,
      dictationMode: 'hold',
      hotkey: 'Alt+Space',
      microphoneId: 'usb-mic-1',
      modelId: 'parakeet-tdt-v3',
    });
  });

  it('merges a partial update instead of resetting the rest', async () => {
    const { service } = setup();
    await service.updateSettings(
      { enabled: true, modelId: 'whisper-tiny' },
      createCorrelationId(),
    );

    const status = await service.updateSettings(
      { dictationMode: 'hold' },
      createCorrelationId(),
    );

    expect(status.settings).toMatchObject({
      enabled: true,
      modelId: 'whisper-tiny',
      dictationMode: 'hold',
    });
  });
});

describe('voice cloud credential', () => {
  it('refuses a cloud model until a key is stored', async () => {
    const { service, repository } = setup();

    await expect(
      service.updateSettings({ modelId: 'gpt-4o-transcribe' }, createCorrelationId()),
    ).rejects.toThrow(/API key/i);
    // A rejected selection must not leave a half-written row behind.
    expect(repository.read()).toBeUndefined();
  });

  it('accepts a cloud model once the key is saved', async () => {
    const { service, secrets } = setup();

    const saved = await service.saveOpenAiKey(
      { apiKey: 'sk-phase-one-voice-sentinel-key' },
      createCorrelationId(),
    );
    expect(saved.openAiKeyPresent).toBe(true);
    expect(await secrets.get(VOICE_OPENAI_SECRET_REF)).toBe(
      'sk-phase-one-voice-sentinel-key',
    );

    const status = await service.updateSettings(
      { modelId: 'gpt-4o-mini-transcribe' },
      createCorrelationId(),
    );
    expect(status.settings.modelId).toBe('gpt-4o-mini-transcribe');
  });

  it('clears a cloud selection when its key is deleted', async () => {
    const { service } = setup();
    await service.saveOpenAiKey(
      { apiKey: 'sk-phase-one-voice-sentinel-key' },
      createCorrelationId(),
    );
    await service.updateSettings({ modelId: 'gpt-4o-transcribe' }, createCorrelationId());

    const status = await service.deleteOpenAiKey(createCorrelationId());

    // Leaving the model selected would strand dictation on an unusable model.
    expect(status.settings.modelId).toBeNull();
    expect(status.openAiKeyPresent).toBe(false);
  });

  it('keeps a local selection when the key is deleted', async () => {
    const { service } = setup();
    await service.saveOpenAiKey(
      { apiKey: 'sk-phase-one-voice-sentinel-key' },
      createCorrelationId(),
    );
    await service.updateSettings({ modelId: 'whisper-tiny' }, createCorrelationId());

    const status = await service.deleteOpenAiKey(createCorrelationId());

    expect(status.settings.modelId).toBe('whisper-tiny');
  });

  it('never logs the key', async () => {
    const { service, logs } = setup();

    await service.saveOpenAiKey(
      { apiKey: 'sk-phase-one-voice-sentinel-key' },
      createCorrelationId(),
    );

    expect(logs.join('\n')).not.toContain('sk-phase-one-voice-sentinel-key');
  });
});

describe('voice model availability', () => {
  it('marks cloud models unselectable until a key exists', async () => {
    const { service } = setup();

    const before = await service.status();
    const cloudBefore = before.models.filter((model) => model.runtime === 'cloud');
    expect(cloudBefore).toHaveLength(2);
    expect(cloudBefore.every((model) => model.selectable)).toBe(false);
    expect(before.models.filter((model) => model.runtime === 'local').length).toBe(4);
    expect(
      before.models
        .filter((model) => model.runtime === 'local')
        .every((m) => m.selectable),
    ).toBe(true);

    const after = await service.saveOpenAiKey(
      { apiKey: 'sk-phase-one-voice-sentinel-key' },
      createCorrelationId(),
    );

    expect(
      after.models
        .filter((model) => model.runtime === 'cloud')
        .every((m) => m.selectable),
    ).toBe(true);
  });

  it('recommends exactly one model and installs none yet', async () => {
    const { service } = setup();

    const status = await service.status();

    expect(status.models.filter((model) => model.recommended).map((m) => m.id)).toEqual([
      'parakeet-tdt-v3',
    ]);
    // Local engines arrive with the model installer; nothing may claim to be
    // installed before then.
    expect(status.models.some((model) => model.installed)).toBe(false);
  });
});

import type { VoiceRepository, StoredVoiceSettings } from '@builderhelm/db';
import type { OpenAITranscriptionAdapter } from '@builderhelm/model-gateway';
import type { Logger } from '@builderhelm/observability';
import {
  VOICE_DEFAULT_HOTKEY,
  VOICE_MODEL_CATALOG,
  voiceModelCatalogEntry,
  voiceSettingsSchema,
  voiceSettingsUpdateInputSchema,
  voiceStatusSchema,
  voiceKeySaveInputSchema,
  type VoiceKeySaveInput,
  type VoiceModelId,
  type VoiceSettings,
  type VoiceSettingsUpdateInput,
  type VoiceStatus,
} from '@builderhelm/protocol';
import { BuilderHelmError, utcNow, type CorrelationId } from '@builderhelm/shared';

import type { SecretStore } from '../secrets/secret-store.js';
/** Disk facts the desktop host owns; core never downloads or loads models. */
export interface VoiceModelInventory {
  installed(id: VoiceModelId): boolean;
  bytesOnDisk(id: VoiceModelId): number | null;
  downloading(id: VoiceModelId): boolean;
  downloadable(id: VoiceModelId): boolean;
}

export const VOICE_OPENAI_SECRET_REF = 'builderhelm.voice.openai.api-key';

const defaultSettings: VoiceSettings = {
  enabled: false,
  dictationMode: 'toggle',
  hotkey: VOICE_DEFAULT_HOTKEY,
  microphoneId: null,
  modelId: null,
  cloudConsent: false,
};

function toSettings(row: StoredVoiceSettings | undefined): VoiceSettings {
  if (row === undefined) return defaultSettings;
  return voiceSettingsSchema.parse({
    enabled: row.enabled === 1,
    dictationMode: row.dictationMode,
    hotkey: row.hotkey,
    microphoneId: row.microphoneId,
    modelId: row.modelId,
    cloudConsent: row.cloudConsent === 1,
  });
}

/**
 * Owns the dictation settings and the cloud credential behind them.
 *
 * The invariant this service exists to hold: a cloud model can only be the
 * selected model while a key is stored. Selecting one without a key fails, and
 * deleting the key clears the selection instead of leaving a model that cannot
 * transcribe.
 */
export class VoiceService {
  constructor(
    private readonly repository: VoiceRepository,
    private readonly secrets: SecretStore,
    private readonly logger: Logger,
    private readonly inventory: VoiceModelInventory | null = null,
    private readonly transcription: OpenAITranscriptionAdapter | null = null,
  ) {}

  async status(): Promise<VoiceStatus> {
    return this.describe(toSettings(this.repository.read()));
  }

  async updateSettings(
    input: VoiceSettingsUpdateInput,
    correlationId: CorrelationId,
  ): Promise<VoiceStatus> {
    const patch = voiceSettingsUpdateInputSchema.parse(input);
    const current = toSettings(this.repository.read());
    const next = voiceSettingsSchema.parse({ ...current, ...patch });
    if (next.modelId !== null) {
      const entry = voiceModelCatalogEntry(next.modelId);
      if (entry.requiresApiKey && !(await this.hasOpenAiKey())) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          `${entry.label} sends audio to OpenAI. Add an API key before selecting it.`,
        );
      }
      if (
        entry.runtime === 'local' &&
        this.inventory !== null &&
        !this.inventory.installed(entry.id)
      ) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          `Install ${entry.label} before selecting it.`,
        );
      }
    }

    this.persist(next);
    this.logger.info({
      event: 'voice.settings_updated',
      correlationId,
      data: {
        enabled: next.enabled,
        dictationMode: next.dictationMode,
        modelId: next.modelId,
        // The device id is user hardware, not a secret, but the label is not
        // ours to log, so only the selection shape is recorded.
        microphoneSelected: next.microphoneId !== null,
      },
    });
    return this.describe(next);
  }

  async saveOpenAiKey(
    input: VoiceKeySaveInput,
    correlationId: CorrelationId,
  ): Promise<VoiceStatus> {
    const { apiKey } = voiceKeySaveInputSchema.parse(input);
    await this.secrets.set(VOICE_OPENAI_SECRET_REF, apiKey);
    this.logger.info({
      event: 'voice.openai_key_saved',
      correlationId,
      data: { ref: VOICE_OPENAI_SECRET_REF },
    });
    return this.status();
  }

  /**
   * Removes the credential and, with it, any cloud selection that depended on
   * it. Leaving the selection would strand dictation on a model that cannot run.
   */
  async deleteOpenAiKey(correlationId: CorrelationId): Promise<VoiceStatus> {
    await this.secrets.delete(VOICE_OPENAI_SECRET_REF);
    const current = toSettings(this.repository.read());
    const cleared =
      current.modelId !== null && voiceModelCatalogEntry(current.modelId).requiresApiKey;
    if (cleared) this.persist({ ...current, modelId: null });
    this.logger.info({
      event: 'voice.openai_key_deleted',
      correlationId,
      data: { clearedModelSelection: cleared },
    });
    return this.status();
  }

  /**
   * Cloud path only. Resolves the stored OpenAI key and never sends audio when
   * the key or a cloud model is missing.
   */
  async transcribe(
    input: { readonly bytes: Uint8Array; readonly filename: string },
    correlationId: CorrelationId,
  ): Promise<{ text: string }> {
    const settings = toSettings(this.repository.read());
    if (settings.modelId === null) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Select a speech model first.');
    }
    const entry = voiceModelCatalogEntry(settings.modelId);
    if (entry.runtime !== 'cloud') {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        `${entry.label} runs on this device, not OpenAI.`,
      );
    }
    const apiKey = await this.secrets.get(VOICE_OPENAI_SECRET_REF);
    if (apiKey === null) {
      this.logger.warn({
        event: 'voice.transcribe_blocked',
        correlationId,
        data: { modelId: entry.id, reason: 'missing_key' },
      });
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        `${entry.label} sends audio to OpenAI. Add an API key first.`,
      );
    }
    if (!settings.cloudConsent) {
      this.logger.warn({
        event: 'voice.transcribe_blocked',
        correlationId,
        data: { modelId: entry.id, reason: 'missing_consent' },
      });
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Confirm that audio may be sent to OpenAI before using a cloud model.',
      );
    }
    if (this.transcription === null) {
      throw new BuilderHelmError(
        'INTEGRATION_OFFLINE',
        'Cloud transcription is not attached to this host.',
      );
    }
    const model =
      entry.id === 'gpt-4o-mini-transcribe'
        ? 'gpt-4o-mini-transcribe'
        : 'gpt-4o-transcribe';
    const result = await this.transcription.transcribe({
      model,
      apiKey,
      filename: input.filename,
      bytes: input.bytes,
    });
    this.logger.info({
      event: 'voice.transcribed',
      correlationId,
      data: { modelId: entry.id, bytes: input.bytes.byteLength },
    });
    return result;
  }

  private persist(settings: VoiceSettings): void {
    this.repository.write({
      enabled: settings.enabled,
      dictationMode: settings.dictationMode,
      hotkey: settings.hotkey,
      microphoneId: settings.microphoneId,
      modelId: settings.modelId,
      cloudConsent: settings.cloudConsent,
      updatedAt: utcNow(),
    });
  }

  private async hasOpenAiKey(): Promise<boolean> {
    return (await this.secrets.get(VOICE_OPENAI_SECRET_REF)) !== null;
  }

  private async describe(settings: VoiceSettings): Promise<VoiceStatus> {
    const openAiKeyPresent = await this.hasOpenAiKey();
    return voiceStatusSchema.parse({
      settings,
      openAiKeyPresent,
      models: VOICE_MODEL_CATALOG.map((entry) => {
        const installed = this.inventory?.installed(entry.id) ?? false;
        return {
          id: entry.id,
          label: entry.label,
          engine: entry.engine,
          runtime: entry.runtime,
          languages: entry.languages,
          detail: entry.detail,
          recommended: entry.recommended,
          requiresApiKey: entry.requiresApiKey,
          downloadBytes: entry.downloadBytes,
          installed,
          downloadable: this.inventory?.downloadable(entry.id) ?? false,
          bytesOnDisk: this.inventory?.bytesOnDisk(entry.id) ?? null,
          downloading: this.inventory?.downloading(entry.id) ?? false,
          selectable: entry.requiresApiKey
            ? openAiKeyPresent
            : this.inventory === null
              ? true
              : installed,
        };
      }),
    });
  }
}

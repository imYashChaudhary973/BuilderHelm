import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  VoiceKeySaveInput,
  VoiceSettingsUpdateInput,
} from '@builderhelm/protocol/voice';
import { useState } from 'react';

type Microphone = { readonly id: string; readonly label: string };

const KEY_MODAL_COPY = {
  title: 'OpenAI Transcription',
  notice:
    'Audio is sent to OpenAI only when an OpenAI speech model is selected. Local models never leave this device.',
  storageNote:
    'Stored securely on this device. It is never written to disk by BuilderHelm or included in logs.',
} as const;

export function VoicePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState(false);

  const voice = useQuery({
    queryKey: ['voice-status'],
    queryFn: () => window.builderHelm.voice.status(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['voice-status'] });
  };

  const update = useMutation({
    mutationFn: (input: VoiceSettingsUpdateInput) =>
      window.builderHelm.voice.updateSettings(input),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const saveKey = useMutation({
    mutationFn: (input: VoiceKeySaveInput) =>
      window.builderHelm.voice.saveOpenAiKey(input),
    onSuccess: async () => {
      setError(null);
      setKeyModal(false);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const deleteKey = useMutation({
    mutationFn: () => window.builderHelm.voice.deleteOpenAiKey(),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const settings = voice.data?.settings ?? null;
  const models = voice.data?.models ?? [];

  return (
    <>
      <header className="settingsHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Voice</h1>
          <p className="lede">
            Dictate into any field or terminal. Local models run offline; cloud models
            require an API key.
          </p>
        </div>
      </header>
      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}
      <div className="settingsLayout">
        <section className="voiceSection" aria-labelledby="voice-general-title">
          <div className="sectionTitle">
            <h2 id="voice-general-title">Dictation</h2>
          </div>
          <div className="voiceRow">
            <div>
              <strong>Voice dictation</strong>
              <p className="voiceHint">
                {settings?.enabled === true
                  ? 'On. The hotkey works inside BuilderHelm.'
                  : 'Off. Turn on to dictate.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.enabled ?? false}
              className={settings?.enabled ? 'voiceSwitch voiceSwitchOn' : 'voiceSwitch'}
              disabled={update.isPending || voice.isLoading}
              onClick={() =>
                settings !== null && update.mutate({ enabled: !settings.enabled })
              }
            >
              <span />
            </button>
          </div>

          <div className="voiceRow">
            <div>
              <strong>Dictation mode</strong>
              <p className="voiceHint">
                Toggle presses the hotkey once to start and again to stop. Hold dictates
                while the hotkey is held.
              </p>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Dictation mode">
              <button
                type="button"
                role="radio"
                aria-checked={settings?.dictationMode === 'toggle'}
                className={
                  settings?.dictationMode === 'toggle'
                    ? 'segmentBtn segmentBtnActive'
                    : 'segmentBtn'
                }
                disabled={update.isPending}
                onClick={() => update.mutate({ dictationMode: 'toggle' })}
              >
                Toggle
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings?.dictationMode === 'hold'}
                className={
                  settings?.dictationMode === 'hold'
                    ? 'segmentBtn segmentBtnOn'
                    : 'segmentBtn'
                }
                disabled={update.isPending}
                onClick={() => update.mutate({ dictationMode: 'hold' })}
              >
                Hold
              </button>
            </div>
          </div>

          <div className="voiceRow">
            <div>
              <strong>Hotkey</strong>
              <p className="voiceHint">Set inside BuilderHelm. Example: Alt+Space.</p>
            </div>
            <input
              className="hotkeyField"
              defaultValue={settings?.hotkey ?? ''}
              disabled={update.isPending}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const next = event.currentTarget.value.trim();
                if (next.length > 0 && next !== settings?.hotkey) {
                  update.mutate({ hotkey: next });
                }
              }}
            />
          </div>

          <MicrophoneRow
            selected={settings?.microphoneId ?? null}
            onSave={(microphoneId) => update.mutate({ microphoneId })}
            onUseDefault={() => update.mutate({ microphoneId: null })}
            busy={update.isPending}
          />
        </section>

        <section className="voiceSection" aria-labelledby="voice-model-title">
          <div className="sectionTitle">
            <h2 id="voice-model-title">Speech model</h2>
            <span>
              Select a speech model. Local models run offline; cloud models require an API
              key.
            </span>
          </div>
          {voice.isLoading && <p className="emptyState">Loading models…</p>}
          <div className="voiceModels">
            {models.map((model) => {
              const selected = settings?.modelId === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  className={selected ? 'voiceModel voiceModelSelected' : 'voiceModel'}
                  aria-pressed={selected}
                  disabled={update.isPending}
                  onClick={() => {
                    // A cloud model without a stored key opens the key dialog
                    // instead of mutating settings: picking it *means* the user
                    // intends to provide one.
                    if (model.requiresApiKey && voice.data?.openAiKeyPresent === false) {
                      setError(null);
                      setKeyModal(true);
                      return;
                    }
                    if (settings !== null) update.mutate({ modelId: model.id });
                  }}
                >
                  <span
                    className={
                      selected ? 'voiceModelDot voiceModelDotOn' : 'voiceModelDot'
                    }
                    aria-hidden="true"
                  />
                  <span className="voiceModelCopy">
                    <strong>
                      {model.label}
                      {model.recommended && <em className="voiceTag">Recommended</em>}
                      {model.runtime === 'cloud' && <em className="voiceTag">Cloud</em>}
                      {model.runtime === 'local' && <em className="voiceTag">Local</em>}
                    </strong>
                    <small>
                      {model.detail}
                      {model.downloadBytes !== null &&
                        ` · ~${Math.max(1, Math.round(model.downloadBytes / 1_000_000))} MB`}
                      {model.requiresApiKey && voice.data?.openAiKeyPresent === false
                        ? ' · Add an API key to use'
                        : model.requiresApiKey && ' · API key stored'}
                    </small>
                  </span>
                  {selected && (
                    <span className="voiceModelCheck" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="voiceRow voiceKeyRow">
            <div>
              <strong>OpenAI API key</strong>
              <p className="voiceHint">
                {voice.data?.openAiKeyPresent === true
                  ? 'A key is stored securely on this device.'
                  : 'No key stored. Cloud models stay locked until one is saved.'}
              </p>
            </div>
            <div className="voiceKeyActions">
              {!voice.data?.openAiKeyPresent && (
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={saveKey.isPending}
                  onClick={() => setKeyModal(true)}
                >
                  Add key
                </button>
              )}
              {voice.data?.openAiKeyPresent === true && (
                <button
                  type="button"
                  className="dangerText"
                  disabled={deleteKey.isPending}
                  onClick={() => deleteKey.mutate()}
                >
                  {deleteKey.isPending ? 'Removing…' : 'Remove key'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {keyModal && (
        <div className="dialogBackdrop" role="presentation">
          <section
            className="confirmDialog voiceKeyDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-dialog-title"
          >
            <button
              type="button"
              className="iconButton voiceKeyClose"
              onClick={() => {
                setKeyModal(false);
                setError(null);
              }}
              title="Close"
            >
              ×
            </button>
            <h2 id="key-dialog-title">{KEY_MODAL_COPY.title}</h2>
            <p>{KEY_MODAL_COPY.notice}</p>
            <label className="wizardLabel" htmlFor="voice-key-input">
              API Key
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget)
                  .get('apiKey')
                  ?.toString()
                  ?.trim();
                if (typeof value === 'string' && value.length > 0) {
                  saveKey.mutate({ apiKey: value });
                }
              }}
            >
              <input
                id="voice-key-input"
                name="apiKey"
                type="password"
                placeholder="sk-..."
                autoComplete="off"
                autoFocus
                disabled={saveKey.isPending}
              />
              <p className="voiceKeyStorage">
                <span aria-hidden="true">🔒</span> {KEY_MODAL_COPY.storageNote}
              </p>
              {error !== null && (
                <p className="cdError" role="alert">
                  {error}
                </p>
              )}
              <div className="formActions">
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => setKeyModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primaryButton"
                  disabled={saveKey.isPending}
                >
                  {saveKey.isPending ? 'Saving…' : 'Save key'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

/** Real microphone enumeration. The app's own permission grant is what makes
 * labels readable; the settings toggle does not capture audio, so it stays
 * unaffected when a user declines. */
function MicrophoneRow(props: {
  readonly selected: string | null;
  readonly onSave: (deviceId: string) => void;
  readonly onUseDefault: () => void;
  readonly busy: boolean;
}): React.JSX.Element {
  const [denied, setDenied] = useState(false);
  const microphones = useQuery({
    queryKey: ['voice-microphones'],
    queryFn: async (): Promise<readonly Microphone[]> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        setDenied(false);
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices
          .filter((device) => device.kind === 'audioinput' && device.deviceId !== '')
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label === '' ? `Microphone ${index + 1}` : device.label,
          }));
        return inputs;
      } catch {
        setDenied(true);
        return [];
      }
    },
    staleTime: 60_000,
  });

  const options = microphones.data ?? [];
  return (
    <div className="voiceRow">
      <div>
        <strong>Microphone</strong>
        <p className="voiceHint">
          {denied
            ? 'Microphone access was declined. Allow it in System Settings to pick a device.'
            : 'System default follows your input device; a named mic pins this list.'}
        </p>
      </div>
      <div className="voiceMicCol">
        <select
          value={props.selected ?? 'default'}
          disabled={props.busy || microphones.isLoading}
          onChange={(event) =>
            event.currentTarget.value === 'default'
              ? props.onUseDefault()
              : props.onSave(event.currentTarget.value)
          }
        >
          <option value="default">System default</option>
          {options.map((microphone) => (
            <option key={microphone.id} value={microphone.id}>
              {microphone.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

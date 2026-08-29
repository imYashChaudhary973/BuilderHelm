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

/** Renders an accelerator the way a Mac menu shows it, e.g. ⌘E. */
function hotkeyLabel(hotkey: string | undefined): string {
  if (hotkey === undefined) return 'the hotkey';
  return hotkey
    .split('+')
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'commandorcontrol':
        case 'command':
          return '⌘';
        case 'option':
        case 'alt':
          return '⌥';
        case 'control':
          return '⌃';
        case 'shift':
          return '⇧';
        default:
          return part;
      }
    })
    .join('');
}

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

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const settings = voice.data?.settings ?? null;
  const models = voice.data?.models ?? [];
  const selectedModel = models.find((model) => model.id === settings?.modelId) ?? null;

  return (
    <>
      <header className="settingsHeader voiceHeader">
        <div>
          <h1>Voice</h1>
          <p className="voiceLede">
            Local speech-to-text dictation with on-device models.
          </p>
        </div>
      </header>
      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}
      <div className="settingsLayout voiceLayout">
        <section className="voiceCard" aria-labelledby="voice-general-title">
          <div className="voiceRow">
            <div>
              <strong>Enable Voice Dictation</strong>
              <p className="voiceHint">
                Press {hotkeyLabel(settings?.hotkey)} to dictate text into any focused
                pane.
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

          <div className="voiceRow voiceSeparator">
            <div>
              <strong>Dictation Mode</strong>
              <p className="voiceHint">
                Toggle: press {hotkeyLabel(settings?.hotkey)} once to start, again to
                stop. Hold: dictate while {hotkeyLabel(settings?.hotkey)} is held.
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

        <div className="voiceRow voiceSeparator" id="voice-model-row">
          <div>
            <strong>Speech Model</strong>
            <p className="voiceHint">
              Select a speech model. Local models run offline; cloud models require an API
              key.
            </p>
          </div>
          <div className="voiceModelPicker">
            <button
              type="button"
              className="voiceModelTrigger"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen((open) => !open)}
            >
              {selectedModel?.label ?? 'Select Model'}
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  d="m7 10 5 5 5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {modelMenuOpen && (
              <div className="voiceModelMenu" role="listbox">
                {models.map((model) => {
                  const selected = settings?.modelId === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? 'voiceModelOption voiceModelOptionOn'
                          : 'voiceModelOption'
                      }
                      onClick={() => {
                        setModelMenuOpen(false);
                        // A cloud model without a stored key opens the key
                        // dialog instead of mutating settings: picking it
                        // *means* the user intends to provide one.
                        if (
                          model.requiresApiKey &&
                          voice.data?.openAiKeyPresent === false
                        ) {
                          setError(null);
                          setKeyModal(true);
                          return;
                        }
                        if (settings !== null) update.mutate({ modelId: model.id });
                      }}
                    >
                      <span className="voiceModelOptionHead">
                        <strong>{model.label}</strong>
                        {!model.recommended && !model.requiresApiKey && (
                          <em className="voiceTag">
                            {model.runtime === 'cloud' ? 'cloud' : 'offline'}
                          </em>
                        )}
                        {model.engine === 'zipformer' && (
                          <em className="voiceTag">streaming</em>
                        )}
                        {model.recommended && <em className="voiceTag">recommended</em>}
                        {model.requiresApiKey && <em className="voiceTag">cloud</em>}
                        {model.downloadBytes !== null && (
                          <span className="voiceSize">
                            {Math.round(model.downloadBytes / 1_000_000)}{' '}
                            {model.downloadBytes >= 100_000_000 ? 'MB' : 'MB'}
                          </span>
                        )}
                      </span>
                      <span className="voiceModelOptionCopy">{model.detail}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="voiceRow voiceSeparator voiceKeyRow">
          <div>
            <strong>OpenAI API Key</strong>
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

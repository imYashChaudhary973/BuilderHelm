import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  VoiceKeySaveInput,
  VoiceModelId,
  VoiceSettingsUpdateInput,
} from '@builderhelm/protocol/voice';
import { useState } from 'react';

type Microphone = { readonly id: string; readonly label: string };
const KEY_MODAL_COPY = {
  title: 'OpenAI Transcription',
  notice: 'Audio is sent to OpenAI only when an OpenAI speech model is selected.',
  storageNote:
    'Local runtime keys are stored in ~/.orca using Electron encrypted storage when available.',
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
  const [pendingCloudModelId, setPendingCloudModelId] = useState<VoiceModelId | null>(
    null,
  );

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
      const modelId = pendingCloudModelId;
      setError(null);
      setKeyModal(false);
      setPendingCloudModelId(null);
      await refresh();
      if (modelId !== null) {
        await window.builderHelm.voice.updateSettings({ modelId });
        await refresh();
      }
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [dictationMode, setDictationMode] = useState<'toggle' | 'hold' | null>(null);
  const settings = voice.data?.settings ?? null;
  const models = voice.data?.models ?? [];
  const selectedModel = models.find((model) => model.id === settings?.modelId) ?? null;
  const mode = dictationMode ?? settings?.dictationMode ?? 'toggle';

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
            <div
              className={mode === 'hold' ? 'segmented segmentedHold' : 'segmented'}
              role="radiogroup"
              aria-label="Dictation mode"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'toggle'}
                className={mode === 'toggle' ? 'segmentBtn segmentBtnOn' : 'segmentBtn'}
                onClick={() => {
                  setDictationMode('toggle');
                  update.mutate({ dictationMode: 'toggle' });
                }}
              >
                Toggle
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'hold'}
                className={mode === 'hold' ? 'segmentBtn segmentBtnOn' : 'segmentBtn'}
                onClick={() => {
                  setDictationMode('hold');
                  update.mutate({ dictationMode: 'hold' });
                }}
              >
                Hold
              </button>
            </div>
          </div>

          <MicrophoneRow
            selected={settings?.microphoneId ?? null}
            onSave={(microphoneId) => update.mutate({ microphoneId })}
            onUseDefault={() => update.mutate({ microphoneId: null })}
            busy={update.isPending}
          />
          <div className="voiceRow voiceSeparator" id="voice-model-row">
            <div>
              <strong>Speech Model</strong>
              <p className="voiceHint">
                Select a speech model. Local models run offline; cloud models require an
                API key.
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
                            setPendingCloudModelId(model.id);
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
        </section>
      </div>

      {keyModal && (
        <div className="dialogBackdrop" role="presentation">
          <section
            className="voiceKeyDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-dialog-title"
          >
            <button
              type="button"
              className="iconButton voiceKeyClose"
              onClick={() => {
                setKeyModal(false);
                setPendingCloudModelId(null);
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
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <rect
                    x="5"
                    y="11"
                    width="14"
                    height="10"
                    rx="2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M8 11V8a4 4 0 0 1 8 0v3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                {KEY_MODAL_COPY.storageNote}
              </p>
              {error !== null && (
                <p className="cdError" role="alert">
                  {error}
                </p>
              )}
              <div className="formActions">
                <button
                  type="submit"
                  className="voiceKeySave"
                  disabled={saveKey.isPending}
                >
                  {saveKey.isPending ? 'Saving…' : 'Save Key'}
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
            : 'Input device used for voice dictation. System default follows the OS microphone setting.'}
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

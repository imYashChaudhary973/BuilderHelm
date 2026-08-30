import { microphoneErrorMessage, startMicCapture } from './capture.js';
import { eventMatchesAccelerator, type KeyLike } from './hotkey.js';
import { insertTranscript, resolveInsertTarget, type InsertTarget } from './insert.js';
import {
  bytesToBase64,
  encodeWavPcm16,
  LISTEN_MAX_MS,
  peakRms,
  SILENCE_RMS,
} from './pcm.js';

export type DictationPhase = 'idle' | 'listening' | 'transcribing' | 'inserting';

export interface DictationHud {
  readonly phase: DictationPhase;
  readonly level: number;
  readonly partial: string;
  readonly error: string | null;
}

export interface DictationDeps {
  capture: typeof startMicCapture;
  transcribe: (input: {
    filename: string;
    audioBase64: string;
  }) => Promise<{ text: string }>;
  insert: (text: string, target: InsertTarget) => 'field' | 'pane' | 'none';
  settings: () => Promise<{
    enabled: boolean;
    dictationMode: 'toggle' | 'hold';
    hotkey: string;
    microphoneId: string | null;
    modelId: string | null;
  }>;
  listenMaxMs?: number;
  silenceRms?: number;
}

const idleHud: DictationHud = {
  phase: 'idle',
  level: 0,
  partial: '',
  error: null,
};

export function createDictation(deps: DictationDeps) {
  let hud: DictationHud = idleHud;
  let generation = 0;
  let holdArmed = false;
  let target: InsertTarget = { kind: 'none' };
  let capture: { stop: () => Float32Array } | null = null;
  let listenTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSettings: Awaited<ReturnType<DictationDeps['settings']>> | null = null;
  const listeners = new Set<() => void>();
  function emit(next: DictationHud): void {
    hud = next;
    for (const listener of listeners) listener();
  }

  function clearListenTimer(): void {
    if (listenTimer !== null) {
      clearTimeout(listenTimer);
      listenTimer = null;
    }
  }

  async function loadSettings() {
    lastSettings = await deps.settings();
    return lastSettings;
  }

  async function start(): Promise<void> {
    if (hud.phase !== 'idle' && hud.phase !== 'inserting') return;
    const settings = await loadSettings();
    if (!settings.enabled) {
      emit({ ...idleHud, error: 'Turn on voice dictation in Settings.' });
      return;
    }
    if (settings.modelId === null) {
      emit({ ...idleHud, error: 'Select a speech model in Settings.' });
      return;
    }
    generation += 1;
    const mine = generation;
    target = resolveInsertTarget(
      typeof document === 'undefined' ? null : document.activeElement,
    );
    emit({ phase: 'listening', level: 0, partial: '', error: null });
    try {
      capture = await deps.capture({
        deviceId: settings.microphoneId,
        onLevel: (level) => {
          if (generation !== mine || hud.phase !== 'listening') return;
          emit({ ...hud, level });
        },
      });
    } catch (error) {
      emit({ ...idleHud, error: microphoneErrorMessage(error) });
      return;
    }
    if (generation !== mine) {
      capture.stop();
      capture = null;
      return;
    }
    clearListenTimer();
    listenTimer = setTimeout(() => {
      void stop();
    }, deps.listenMaxMs ?? LISTEN_MAX_MS);
  }

  async function stop(): Promise<void> {
    if (hud.phase !== 'listening') return;
    if (capture === null) {
      cancel();
      return;
    }
    clearListenTimer();
    const mine = generation;
    const samples = capture.stop();
    capture = null;
    const silence = deps.silenceRms ?? SILENCE_RMS;
    if (peakRms(samples) < silence) {
      emit({ ...idleHud, error: "Didn't hear anything." });
      return;
    }
    emit({ phase: 'transcribing', level: 0, partial: '', error: null });
    let text = '';
    try {
      const result = await deps.transcribe({
        filename: 'clip.wav',
        audioBase64: bytesToBase64(encodeWavPcm16(samples)),
      });
      text = result.text.trim();
    } catch (error) {
      if (generation !== mine) return;
      emit({
        ...idleHud,
        error: error instanceof Error ? error.message : 'Transcription failed.',
      });
      return;
    }
    if (generation !== mine) return;
    if (text.length === 0) {
      emit({ ...idleHud, error: "Didn't hear anything." });
      return;
    }
    emit({ phase: 'inserting', level: 0, partial: text, error: null });
    deps.insert(text, target);
    emit(idleHud);
  }

  function cancel(): void {
    generation += 1;
    holdArmed = false;
    clearListenTimer();
    if (capture !== null) {
      capture.stop();
      capture = null;
    }
    emit(idleHud);
  }

  async function handleHotkeyPress(): Promise<void> {
    const settings = await loadSettings();
    if (!settings.enabled || settings.dictationMode !== 'toggle') return;
    if (hud.phase === 'idle' || hud.phase === 'inserting') {
      await start();
      return;
    }
    if (hud.phase === 'listening') {
      await stop();
      return;
    }
    cancel();
  }

  async function handleKeyDown(event: KeyLike): Promise<void> {
    if (event.key === 'Escape' && hud.phase !== 'idle') {
      cancel();
      return;
    }
    const settings = await loadSettings();
    if (!settings.enabled || settings.dictationMode !== 'hold') return;
    if (!eventMatchesAccelerator(event, settings.hotkey)) return;
    if (event.repeat === true || holdArmed) return;
    holdArmed = true;
    await start();
  }

  async function handleKeyUp(event: KeyLike): Promise<void> {
    const settings = await loadSettings();
    if (!holdArmed) return;
    if (!eventMatchesAccelerator(event, settings.hotkey)) return;
    holdArmed = false;
    await stop();
  }

  function handleBlur(): void {
    if (!holdArmed) return;
    holdArmed = false;
    void stop();
  }

  return {
    start,
    stop,
    cancel,
    handleHotkeyPress,
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    peekSettings: () => lastSettings,
    getHud: () => hud,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type DictationController = ReturnType<typeof createDictation>;

let bootstrapped: DictationController | null = null;

export function bootDictation(): DictationController {
  if (bootstrapped !== null) return bootstrapped;
  const controller = createDictation({
    capture: startMicCapture,
    transcribe: (input) => window.builderHelm.voice.transcribe(input),
    insert: insertTranscript,
    settings: async () => {
      const status = await window.builderHelm.voice.status();
      return status.settings;
    },
  });
  window.builderHelm.voice.onHotkey(() => {
    void controller.handleHotkeyPress();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const settings = controller.peekSettings();
    if (
      settings?.enabled === true &&
      settings.dictationMode === 'hold' &&
      eventMatchesAccelerator(event, settings.hotkey)
    ) {
      event.preventDefault();
    }
    if (event.key === 'Escape' && controller.getHud().phase !== 'idle') {
      event.preventDefault();
    }
    void controller.handleKeyDown(event);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    void controller.handleKeyUp(event);
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', controller.handleBlur);
  bootstrapped = controller;
  return controller;
}

export function subscribeDictation(listener: () => void): () => void {
  return bootDictation().subscribe(listener);
}

export function getDictationHud(): DictationHud {
  return bootDictation().getHud();
}

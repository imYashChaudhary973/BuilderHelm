import { useEffect, useSyncExternalStore } from 'react';

import {
  bootDictation,
  getDictationHud,
  subscribeDictation,
} from '../voice/dictation.js';

const WAVE_BARS = 18;

export function DictationHud(): React.JSX.Element | null {
  const hud = useSyncExternalStore(subscribeDictation, getDictationHud);

  useEffect(() => {
    bootDictation();
  }, []);

  if (hud.phase === 'idle' && hud.error === null) return null;

  const label =
    hud.error ??
    (hud.phase === 'listening'
      ? 'Listening'
      : hud.phase === 'transcribing'
        ? 'Transcribing'
        : hud.partial);

  return (
    <div
      className="dictationHud"
      role="status"
      aria-live={hud.error === null ? 'polite' : 'assertive'}
      aria-atomic="true"
      data-phase={hud.phase}
      style={{ ['--level' as string]: String(Math.min(1, hud.level * 3)) }}
    >
      <span className="dictationOrb" aria-hidden="true" />
      <div className="dictationWave" aria-hidden="true">
        {Array.from({ length: WAVE_BARS }, (_, index) => (
          <i key={index} style={{ ['--i' as string]: index }} />
        ))}
      </div>
      <p className="dictationCopy">{label}</p>
      {hud.phase !== 'idle' ? (
        <button
          type="button"
          className="dictationCancel"
          aria-label="Cancel dictation"
          onClick={() => bootDictation().cancel()}
        >
          Esc
        </button>
      ) : null}
    </div>
  );
}

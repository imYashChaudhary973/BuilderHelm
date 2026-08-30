import { useEffect, useSyncExternalStore } from 'react';

import {
  bootDictation,
  getDictationHud,
  subscribeDictation,
} from '../voice/dictation.js';

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
    >
      <div className="dictationMeter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.round(hud.level * 220))}%` }} />
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

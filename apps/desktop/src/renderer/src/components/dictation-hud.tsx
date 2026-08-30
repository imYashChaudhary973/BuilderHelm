import { useEffect, useSyncExternalStore, useState } from 'react';

import {
  bootDictation,
  getDictationHud,
  subscribeDictation,
} from '../voice/dictation.js';

const WAVE_BARS = 24;

export function DictationHud(): React.JSX.Element | null {
  const hud = useSyncExternalStore(subscribeDictation, getDictationHud);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    bootDictation();
  }, []);

  useEffect(() => {
    if (hud.phase !== 'listening') return;
    let frame = 0;
    const loop = (): void => {
      setTick((value) => value + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [hud.phase]);

  if (hud.phase === 'idle' && hud.error === null) return null;

  const energy = hud.phase === 'listening' ? hud.level : 0;
  const label =
    hud.error !== null
      ? hud.error
      : hud.phase === 'transcribing'
        ? 'Transcribing'
        : hud.phase === 'inserting'
          ? hud.partial
          : '';

  return (
    <div
      className="dictationHud"
      role="status"
      aria-live={hud.error === null ? 'polite' : 'assertive'}
      aria-atomic="true"
      data-phase={hud.phase}
      tabIndex={-1}
    >
      <span className="dictationOrb" aria-hidden="true" />
      <div className="dictationWave" aria-hidden="true">
        {Array.from({ length: WAVE_BARS }, (_, index) => {
          const motion =
            energy <= 0.02
              ? 0.12
              : 0.2 +
                energy * (0.35 + 0.65 * Math.abs(Math.sin(tick * 0.22 + index * 0.45)));
          return (
            <i
              key={index}
              style={{
                height: `${4 + motion * 20}px`,
                opacity: energy <= 0.02 ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>
      {label !== '' ? <p className="dictationCopy">{label}</p> : null}
      {hud.phase !== 'idle' ? (
        <button
          type="button"
          className="dictationCancel"
          tabIndex={-1}
          aria-label="Cancel dictation"
          onClick={() => bootDictation().cancel()}
        >
          Esc
        </button>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';

import { ElementsCollection } from '../shaders/elements/ElementsBackground.js';

/** How long the storm holds at full opacity before it starts to leave. */
const HOLD_MS = 2600;

/** Must match the `.splashLeaving` transition in styles.css. */
const FADE_MS = 700;

/**
 * The launch animation is decoration. A reader who asked for less motion gets
 * the shell immediately instead of a shortened storm.
 */
export function splashEnabled(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Opening animation: ThreeUI's `elemental-lightning` element, held over the
 * shell while the window settles, then faded out. Any key skips the rest of
 * the hold; pointer events are left to the shader, which pulls the arcs toward
 * the cursor.
 */
export function SplashScreen({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    const hold = window.setTimeout(leave, HOLD_MS);
    window.addEventListener('keydown', leave);
    return () => {
      window.clearTimeout(hold);
      window.removeEventListener('keydown', leave);
    };
  }, [leave]);

  useEffect(() => {
    if (!leaving) return undefined;
    const fade = window.setTimeout(onDone, FADE_MS);
    return () => window.clearTimeout(fade);
  }, [leaving, onDone]);

  return (
    <div className={leaving ? 'splash splashLeaving' : 'splash'} role="presentation">
      <div className="shader-frame">
        <ElementsCollection
          variant="lightning"
          speed={1.0}
          size={1.0}
          particleAmount={1.0}
          hue={0}
          saturation={1.0}
          brightness={1.0}
          opacity={1.0}
        />
      </div>
      <div className="splashMark">
        <span className="splashName">BuilderHelm</span>
        <span className="splashHint">Press any key</span>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

/**
 * Dependency-free ports of React Bits effects (reactbits.dev), adapted for
 * this renderer's strict CSP (no inline styles, no GSAP/motion):
 * Aurora background, SpotlightCard hover glow, SplitText staggered reveal,
 * and CountUp eased counter. Shiny text / glare / star-border are pure CSS
 * classes in styles.css (.shinyText, .glare, .starBorder).
 */

export function Aurora(): React.JSX.Element {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="auroraBlob auroraA" />
      <span className="auroraBlob auroraB" />
      <span className="auroraBlob auroraC" />
    </div>
  );
}

type SpotlightProps<T extends HTMLElement> = {
  ref: React.RefObject<T | null>;
  onMouseMove: (event: React.MouseEvent<T>) => void;
};

/** Spread onto any element to give it the React Bits spotlight-follow glow. */
export function useSpotlight<T extends HTMLElement>(): SpotlightProps<T> {
  const ref = useRef<T>(null);
  function onMouseMove(event: React.MouseEvent<T>): void {
    const node = ref.current;
    if (node === null) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`);
  }
  return { ref, onMouseMove };
}

const SPLIT_WORD_LIMIT = 10;

/** Word-by-word rise-in reveal, CSS-staggered (see .splitWord nth-child delays). */
export function SplitText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}): React.JSX.Element {
  const words = text.split(' ').slice(0, SPLIT_WORD_LIMIT);
  return (
    <span className={className === undefined ? 'splitText' : `splitText ${className}`}>
      <span className="srOnly">{text}</span>
      {words.map((word, index) => (
        <span aria-hidden="true" className="splitWord" key={`${word}-${index}`}>
          {word}
        </span>
      ))}
    </span>
  );
}

const COUNT_DURATION_MS = 900;

/** Eased count-up number (React Bits CountUp, rAF instead of motion springs). */
export function CountUp({ value }: { readonly value: number }): React.JSX.Element {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let frame: number;
    const start = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / COUNT_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}

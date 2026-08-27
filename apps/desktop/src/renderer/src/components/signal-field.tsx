import { useEffect, useRef } from 'react';

const SPACING = 16;
const DOT_RADIUS = 1.5;

export function SignalField(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = ref.current;
    const draw = node?.getContext('2d');
    if (node === null || draw === null || draw === undefined) return;

    const surface = node;
    const ctx = draw;
    let raf = 0;
    let running = true;
    let time = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = (): void => {
      surface.width = surface.offsetWidth;
      surface.height = surface.offsetHeight;
    };

    const frame = (): void => {
      if (!running) return;
      const width = surface.width;
      const height = surface.height;
      ctx.clearRect(0, 0, width, height);

      const cols = Math.floor(width / SPACING);
      const rows = Math.floor(height / SPACING);
      const offsetX = (width - cols * SPACING) / 2;
      const offsetY = (height - rows * SPACING) / 2;

      for (let i = 0; i <= cols; i += 1) {
        for (let j = 0; j <= rows; j += 1) {
          const x = offsetX + i * SPACING;
          const y = offsetY + j * SPACING;
          const nx = i * 0.1;
          const ny = j * 0.1;
          const wave1 = Math.sin(nx + time * 0.5) * Math.cos(ny - time * 0.3);
          const wave2 = Math.sin(nx * 0.5 - ny * 0.5 + time * 0.8);
          const value = wave1 + wave2;
          if (value <= 0.1) continue;

          ctx.beginPath();
          ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
          const highlight = Math.sin(i * 12.34) * Math.cos(j * 56.78);
          if (highlight > 0.98) {
            ctx.fillStyle = '#3b82f6';
          } else if (highlight < -0.98) {
            ctx.fillStyle = '#8b5cf6';
          } else {
            const alpha = Math.min(0.6, (value - 0.1) * 0.8);
            ctx.fillStyle = `rgba(148, 163, 184, ${alpha})`;
          }
          ctx.fill();
        }
      }

      if (!reduce && !document.hidden) time += 0.02;
      if (!reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    // Observe the canvas itself: the bitmap has to track the box it is painted
    // into, and setting width/height does not feed back into layout here.
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    frame();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="signalField" aria-hidden="true" />;
}

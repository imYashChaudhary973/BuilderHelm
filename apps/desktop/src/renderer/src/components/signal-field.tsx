import { useEffect, useRef } from 'react';

const GAP = 18;

type Pulse = {
  readonly i: number;
  readonly j: number;
  t: number;
  readonly life: number;
  readonly dir: 0 | 1;
};

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
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pulses: Pulse[] = [];

    const resize = (): void => {
      const parent = surface.parentElement;
      if (parent === null) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      surface.width = Math.max(1, Math.floor(width * dpr));
      surface.height = Math.max(1, Math.floor(height * dpr));
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = (): void => {
      if (!running) return;
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      const cols = Math.ceil(width / GAP) + 1;
      const rows = Math.ceil(height / GAP) + 1;
      if (!reduce && !document.hidden && pulses.length < 16 && Math.random() < 0.1) {
        pulses.push({
          i: Math.floor(Math.random() * cols),
          j: Math.floor(Math.random() * rows),
          t: 0,
          life: 70 + Math.random() * 90,
          dir: Math.random() < 0.5 ? 0 : 1,
        });
      }

      const glow = new Map<string, number>();
      for (const pulse of pulses) {
        pulse.t += 1;
        const amount = Math.sin((pulse.t / pulse.life) * Math.PI);
        const key = `${pulse.i},${pulse.j}`;
        glow.set(key, Math.max(glow.get(key) ?? 0, amount));
      }
      let index = pulses.length;
      while (index > 0) {
        index -= 1;
        const pulse = pulses[index];
        if (pulse !== undefined && pulse.t > pulse.life) pulses.splice(index, 1);
      }

      ctx.lineWidth = 1;
      for (const pulse of pulses) {
        const amount = Math.sin((pulse.t / pulse.life) * Math.PI);
        if (amount < 0.2) continue;
        const nextI = pulse.i + (pulse.dir === 0 ? 1 : 0);
        const nextJ = pulse.j + (pulse.dir === 1 ? 1 : 0);
        ctx.strokeStyle = `rgba(150, 180, 255, ${amount * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(pulse.i * GAP, pulse.j * GAP);
        ctx.lineTo(nextI * GAP, nextJ * GAP);
        ctx.stroke();
      }

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const amount = glow.get(`${col},${row}`) ?? 0;
          const x = col * GAP;
          const y = row * GAP;
          if (amount > 0) {
            ctx.fillStyle = `rgba(170, 195, 255, ${0.16 + amount * 0.75})`;
            ctx.beginPath();
            ctx.arc(x, y, 1.1 + amount * 1.15, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(x, y, 1.15, 1.15);
          }
        }
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (surface.parentElement !== null) observer.observe(surface.parentElement);
    frame();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="signalField" aria-hidden="true" />;
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { toCapturePoint, type CanvasPoint } from '../draw-geometry.js';

interface Stroke {
  readonly color: string;
  readonly width: number;
  readonly points: { x: number; y: number }[];
}

const COLORS = ['#fbbf24', '#f87171', '#7dd3fc', '#ffffff'] as const;
const WIDTHS = [2, 4, 8] as const;

/**
 * Marks up a captured screenshot. The canvas keeps the capture's native pixel
 * size while CSS scales it to the panel, so pointer coordinates are converted
 * through the displayed-to-natural ratio rather than assuming 1:1 — otherwise
 * every stroke lands offset on a Retina capture.
 *
 * Strokes are retained as geometry, not baked into the bitmap, which is what
 * makes undo and clear a redraw instead of an image diff.
 */
export function ScreenshotEditor({
  pngBase64,
  busy,
  onCancel,
  onSave,
}: {
  readonly pngBase64: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (png: ArrayBuffer) => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [ready, setReady] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas === null || image === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.beginPath();
      const [first, ...rest] = stroke.points;
      if (first === undefined) continue;
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      if (rest.length === 0) context.lineTo(first.x + 0.1, first.y + 0.1);
      context.stroke();
    }
  }, []);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      imageRef.current = image;
      setReady(true);
      redraw();
    };
    image.src = `data:image/png;base64,${pngBase64}`;
    return () => {
      image.onload = null;
      imageRef.current = null;
    };
  }, [pngBase64, redraw]);

  const undo = useCallback(() => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
  }, [redraw]);

  const clear = useCallback(() => {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  }, [redraw]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, undo]);

  function toCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>): CanvasPoint {
    const canvas = event.currentTarget;
    return toCapturePoint(
      { x: event.clientX, y: event.clientY },
      canvas.getBoundingClientRect(),
      { width: canvas.width, height: canvas.height },
    );
  }

  function save(): void {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      void blob.arrayBuffer().then(onSave);
    }, 'image/png');
  }

  return (
    <div className="drawEditor" role="group" aria-label="Screenshot markup">
      <div className="drawTools">
        <span className="drawToolsLabel">Pen</span>
        {COLORS.map((option) => (
          <button
            key={option}
            type="button"
            className={color === option ? 'drawSwatch drawSwatchOn' : 'drawSwatch'}
            style={{ background: option }}
            aria-label={`Pen colour ${option}`}
            aria-pressed={color === option}
            onClick={() => setColor(option)}
          />
        ))}
        {WIDTHS.map((option) => (
          <button
            key={option}
            type="button"
            className={width === option ? 'drawChip drawChipOn' : 'drawChip'}
            aria-label={`Stroke width ${String(option)}`}
            aria-pressed={width === option}
            onClick={() => setWidth(option)}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          className="drawChip"
          disabled={strokeCount === 0}
          onClick={undo}
        >
          Undo
        </button>
        <button
          type="button"
          className="drawChip"
          disabled={strokeCount === 0}
          onClick={clear}
        >
          Clear
        </button>
        <button
          type="button"
          className="drawChip drawChipPrimary"
          disabled={!ready || busy}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="drawChip" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="drawCanvas"
        aria-label="Screenshot markup canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawingRef.current = true;
          strokesRef.current = [
            ...strokesRef.current,
            { color, width, points: [toCanvasPoint(event)] },
          ];
          setStrokeCount(strokesRef.current.length);
          redraw();
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          const stroke = strokesRef.current.at(-1);
          if (stroke === undefined) return;
          stroke.points.push(toCanvasPoint(event));
          redraw();
        }}
        onPointerUp={(event) => {
          drawingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drawingRef.current = false;
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { toCapturePoint, type CanvasPoint } from '../draw-geometry.js';
import {
  IconArrow,
  IconCheck,
  IconCircle,
  IconClose,
  IconHighlighter,
  IconPen,
  IconRedo,
  IconSquare,
  IconText,
  IconTrash,
  IconUndo,
} from './browser-icons.js';

const TOOLS = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'text'] as const;
type Tool = (typeof TOOLS)[number];

const COLORS = ['#ef4444', '#fbbf24', '#22c55e', '#38bdf8', '#ffffff'] as const;
const TEXT_SIZES = [14, 18, 24, 32] as const;
interface PenMark {
  readonly kind: 'pen';
  readonly color: string;
  readonly width: number;
  readonly points: CanvasPoint[];
}

interface HighlighterMark {
  readonly kind: 'highlighter';
  readonly color: string;
  readonly width: number;
  readonly points: CanvasPoint[];
}

interface ArrowMark {
  readonly kind: 'arrow';
  readonly color: string;
  readonly width: number;
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
}

interface RectMark {
  readonly kind: 'rect';
  readonly color: string;
  readonly width: number;
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
}

interface EllipseMark {
  readonly kind: 'ellipse';
  readonly color: string;
  readonly width: number;
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
}

interface Label {
  readonly kind: 'text';
  readonly color: string;
  readonly size: number;
  readonly at: CanvasPoint;
  readonly text: string;
}

type Mark = PenMark | HighlighterMark | ArrowMark | RectMark | EllipseMark | Label;

const TOOL_META: Record<
  Tool,
  { readonly label: string; readonly Icon: () => React.JSX.Element }
> = {
  pen: { label: 'Pen', Icon: IconPen },
  highlighter: { label: 'Highlighter', Icon: IconHighlighter },
  arrow: { label: 'Arrow', Icon: IconArrow },
  rect: { label: 'Rectangle', Icon: IconSquare },
  ellipse: { label: 'Ellipse', Icon: IconCircle },
  text: { label: 'Text', Icon: IconText },
};

/** Head strokes for an arrow, sized from its own length so short arrows stay legible. */
function arrowHead(
  from: CanvasPoint,
  to: CanvasPoint,
): readonly [CanvasPoint, CanvasPoint] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(
    14,
    Math.min(34, Math.hypot(to.x - from.x, to.y - from.y) * 0.24),
  );
  const spread = 0.42;
  return [
    {
      x: to.x - length * Math.cos(angle - spread),
      y: to.y - length * Math.sin(angle - spread),
    },
    {
      x: to.x - length * Math.cos(angle + spread),
      y: to.y - length * Math.sin(angle + spread),
    },
  ];
}

function paint(context: CanvasRenderingContext2D, mark: Mark): void {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = mark.color;
  if (mark.kind === 'text') {
    context.fillStyle = mark.color;
    context.font = `600 ${String(mark.size)}px system-ui, -apple-system, sans-serif`;
    context.textBaseline = 'top';
    context.fillText(mark.text, mark.at.x, mark.at.y);
    context.restore();
    return;
  }
  context.lineWidth = mark.width;
  if (mark.kind === 'highlighter') {
    // Translucent and multiplied so it reads as ink over the page, not paint
    // covering it.
    context.globalAlpha = 0.35;
    context.globalCompositeOperation = 'multiply';
    context.lineWidth = mark.width * 3.5;
  }
  if (mark.kind === 'pen' || mark.kind === 'highlighter') {
    const [first, ...rest] = mark.points;
    if (first !== undefined) {
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      if (rest.length === 0) context.lineTo(first.x + 0.1, first.y + 0.1);
      context.stroke();
    }
    context.restore();
    return;
  }
  if (mark.kind === 'rect') {
    context.beginPath();
    context.rect(
      Math.min(mark.from.x, mark.to.x),
      Math.min(mark.from.y, mark.to.y),
      Math.abs(mark.to.x - mark.from.x),
      Math.abs(mark.to.y - mark.from.y),
    );
    context.stroke();
    context.restore();
    return;
  }
  if (mark.kind === 'ellipse') {
    context.beginPath();
    context.ellipse(
      (mark.from.x + mark.to.x) / 2,
      (mark.from.y + mark.to.y) / 2,
      Math.abs(mark.to.x - mark.from.x) / 2,
      Math.abs(mark.to.y - mark.from.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
    context.restore();
    return;
  }
  const [left, right] = arrowHead(mark.from, mark.to);
  context.beginPath();
  context.moveTo(mark.from.x, mark.from.y);
  context.lineTo(mark.to.x, mark.to.y);
  context.moveTo(left.x, left.y);
  context.lineTo(mark.to.x, mark.to.y);
  context.lineTo(right.x, right.y);
  context.stroke();
  context.restore();
}

/**
 * Marks up a captured screenshot.
 *
 * The canvas keeps the capture's native pixel size while CSS scales it to the
 * panel, so pointer positions are converted through the displayed-to-natural
 * ratio — otherwise every mark lands offset on a Retina capture. Marks are kept
 * as geometry rather than baked into the bitmap, which is what makes undo, redo,
 * and clear a redraw instead of an image diff.
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
  const marksRef = useRef<Mark[]>([]);
  const undoneRef = useRef<Mark[]>([]);
  const draftRef = useRef<Mark | null>(null);
  const drawingRef = useRef(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [textSize, setTextSize] = useState<number>(TEXT_SIZES[1]);
  const [swatches, setSwatches] = useState(false);
  const [marks, setMarks] = useState(0);
  const [undone, setUndone] = useState(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<{
    readonly at: CanvasPoint;
    readonly left: number;
    readonly top: number;
    readonly text: string;
  } | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas === null || image === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    for (const mark of marksRef.current) paint(context, mark);
    if (draftRef.current !== null) paint(context, draftRef.current);
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

  const commit = useCallback(
    (mark: Mark) => {
      marksRef.current = [...marksRef.current, mark];
      undoneRef.current = [];
      setMarks(marksRef.current.length);
      setUndone(0);
      redraw();
    },
    [redraw],
  );

  const undo = useCallback(() => {
    const last = marksRef.current.at(-1);
    if (last === undefined) return;
    marksRef.current = marksRef.current.slice(0, -1);
    undoneRef.current = [...undoneRef.current, last];
    setMarks(marksRef.current.length);
    setUndone(undoneRef.current.length);
    redraw();
  }, [redraw]);

  const redo = useCallback(() => {
    const next = undoneRef.current.at(-1);
    if (next === undefined) return;
    undoneRef.current = undoneRef.current.slice(0, -1);
    marksRef.current = [...marksRef.current, next];
    setMarks(marksRef.current.length);
    setUndone(undoneRef.current.length);
    redraw();
  }, [redraw]);

  const clear = useCallback(() => {
    undoneRef.current = [...undoneRef.current, ...marksRef.current].slice(-50);
    marksRef.current = [];
    setMarks(0);
    setUndone(undoneRef.current.length);
    redraw();
  }, [redraw]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (pending !== null) {
          setPending(null);
          return;
        }
        onCancel();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending, redo, undo]);

  function at(event: React.PointerEvent<HTMLCanvasElement>): CanvasPoint {
    const canvas = event.currentTarget;
    return toCapturePoint(
      { x: event.clientX, y: event.clientY },
      canvas.getBoundingClientRect(),
      { width: canvas.width, height: canvas.height },
    );
  }

  function startText(event: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    setPending({
      at: at(event),
      left: event.clientX - box.left,
      top: event.clientY - box.top,
      text: '',
    });
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
      <div className="drawSurface">
        <canvas
          ref={canvasRef}
          className="drawCanvas"
          aria-label="Screenshot markup canvas"
          onPointerDown={(event) => {
            if (pending !== null) return;
            if (tool === 'text') {
              startText(event);
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            drawingRef.current = true;
            const point = at(event);
            draftRef.current =
              tool === 'pen' || tool === 'highlighter'
                ? { kind: tool, color, width: 4, points: [point] }
                : { kind: tool, color, width: 4, from: point, to: point };
            redraw();
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) return;
            const draft = draftRef.current;
            if (draft === null) return;
            const point = at(event);
            if (draft.kind === 'pen' || draft.kind === 'highlighter') {
              draftRef.current = { ...draft, points: [...draft.points, point] };
            } else if (draft.kind !== 'text') {
              draftRef.current = { ...draft, to: point };
            }
            redraw();
          }}
          onPointerUp={(event) => {
            if (!drawingRef.current) return;
            drawingRef.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
            const draft = draftRef.current;
            draftRef.current = null;
            if (draft !== null) commit(draft);
            else redraw();
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
            draftRef.current = null;
            redraw();
          }}
        />
        {pending !== null && (
          <input
            className="drawTextInput"
            aria-label="Markup text"
            autoFocus
            style={{
              left: pending.left,
              top: pending.top,
              color,
              fontSize: `${String(textSize)}px`,
            }}
            value={pending.text}
            onChange={(event) => setPending({ ...pending, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              event.currentTarget.blur();
            }}
            onBlur={() => {
              const text = pending.text.trim();
              setPending(null);
              if (text.length === 0) return;
              commit({ kind: 'text', color, size: textSize, at: pending.at, text });
            }}
          />
        )}
      </div>

      <div className="drawDock">
        <div className="drawTools" role="toolbar" aria-label="Markup tools">
          {TOOLS.map((id) => {
            const { label, Icon } = TOOL_META[id];
            return (
              <button
                key={id}
                type="button"
                className={tool === id ? 'drawTool drawToolOn' : 'drawTool'}
                aria-label={label}
                aria-pressed={tool === id}
                title={label}
                onClick={() => setTool(id)}
              >
                <Icon />
              </button>
            );
          })}
          <span className="drawDivider" role="presentation" />
          <div className="drawColor">
            <button
              type="button"
              className="drawSwatch"
              style={{ background: color }}
              aria-label={`Colour ${color}`}
              aria-expanded={swatches}
              title="Colour"
              onClick={() => setSwatches((open) => !open)}
            />
            {swatches && (
              <div className="drawSwatches" role="group" aria-label="Markup colour">
                {COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={
                      option === color ? 'drawSwatch drawSwatchOn' : 'drawSwatch'
                    }
                    style={{ background: option }}
                    aria-label={`Colour ${option}`}
                    onClick={() => {
                      setColor(option);
                      setSwatches(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="drawTool drawSize"
            aria-label={`Text size ${String(textSize)}`}
            title="Text size"
            onClick={() => {
              const index = TEXT_SIZES.findIndex((size) => size === textSize);
              setTextSize(TEXT_SIZES[(index + 1) % TEXT_SIZES.length] ?? 18);
            }}
          >
            <IconText />
            <span>{textSize}</span>
          </button>
          <span className="drawDivider" role="presentation" />
          <button
            type="button"
            className="drawTool"
            disabled={marks === 0}
            aria-label="Undo"
            title="Undo"
            onClick={undo}
          >
            <IconUndo />
          </button>
          <button
            type="button"
            className="drawTool"
            disabled={undone === 0}
            aria-label="Redo"
            title="Redo"
            onClick={redo}
          >
            <IconRedo />
          </button>
          <button
            type="button"
            className="drawTool"
            disabled={marks === 0}
            aria-label="Delete all markup"
            title="Delete all markup"
            onClick={clear}
          >
            <IconTrash />
          </button>
        </div>

        <div className="drawBar">
          <p>Draw on the page, then copy the markup to paste into your agent.</p>
          <button type="button" className="drawGhost" onClick={onCancel}>
            <IconClose />
            Cancel
          </button>
          <button
            type="button"
            className="drawPrimary"
            disabled={!ready || busy}
            onClick={save}
          >
            <IconCheck />
            {busy ? 'Copying…' : 'Copy Markup'}
          </button>
        </div>
      </div>
    </div>
  );
}

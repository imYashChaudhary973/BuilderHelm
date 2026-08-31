export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Converts a pointer position into capture pixels.
 *
 * The canvas keeps the screenshot's native size while CSS scales it to the
 * panel, so the displayed box and the backing store disagree — on a Retina
 * capture by a factor of two. Without this conversion every stroke lands at a
 * fraction of where it was drawn.
 */
export function toCapturePoint(
  client: CanvasPoint,
  displayed: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  capture: { readonly width: number; readonly height: number },
): CanvasPoint {
  return {
    x: ((client.x - displayed.left) * capture.width) / Math.max(1, displayed.width),
    y: ((client.y - displayed.top) * capture.height) / Math.max(1, displayed.height),
  };
}

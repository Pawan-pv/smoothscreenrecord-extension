import type { BoundingBox, TelemetryData } from '../types/telemetry';

/**
 * Page telemetry is measured in the page's viewport. A window or entire-screen
 * recording shows the whole window / screen, so its picture has a different
 * coordinate space: the page is a rectangle somewhere inside it. This moves the
 * page's coordinates onto the recorded frame, using where the page sat on the
 * screen (`metadata.screenLayout`, in screen CSS pixels).
 *
 * Returns the converted telemetry (coordinates normalized to the frame,
 * `metadata.width/height` = the frame's size, `coordinateSpace: 'capture'`), the
 * telemetry itself when it was already converted, or null when it cannot be
 * placed reliably: not a window/screen capture, no layout recorded, or a picture
 * whose shape is not the screen/window the page was on (another monitor or app).
 */
export function toCaptureSpace(
  data: TelemetryData,
  displaySurface: string | undefined,
  frameWidth?: number,
  frameHeight?: number
): TelemetryData | null {
  if (displaySurface !== 'window' && displaySurface !== 'monitor') return null;
  if (data.metadata?.coordinateSpace === 'capture') return data;

  const layout = data.metadata?.screenLayout;
  const vw = data.metadata?.width;
  const vh = data.metadata?.height;
  if (!layout || !(Number(vw) > 0) || !(Number(vh) > 0)) return null;

  const frame = displaySurface === 'monitor'
    ? { left: layout.screenLeft, top: layout.screenTop, width: layout.screenWidth, height: layout.screenHeight }
    : { left: layout.windowLeft, top: layout.windowTop, width: layout.windowWidth, height: layout.windowHeight };
  if (![frame.left, frame.top, frame.width, frame.height, layout.viewportLeft, layout.viewportTop].every(Number.isFinite)) return null;
  if (!(frame.width > 0) || !(frame.height > 0)) return null;

  if (Number(frameWidth) > 0 && Number(frameHeight) > 0) {
    const pictureAspect = (frameWidth as number) / (frameHeight as number);
    const frameAspect = frame.width / frame.height;
    if (Math.abs(pictureAspect - frameAspect) / frameAspect > 0.05) return null;
  }

  const zoom = Number.isFinite(layout.zoom) && layout.zoom > 0 ? layout.zoom : 1;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  // Telemetry coordinates are normalized (0..1) or, in older recordings, CSS pixels.
  const cssX = (v: number) => (v >= 0 && v <= 1 ? v * (vw as number) : v);
  const cssY = (v: number) => (v >= 0 && v <= 1 ? v * (vh as number) : v);
  /** Page CSS pixel -> frame pixel (screen CSS pixels from the frame's top-left). */
  const frameX = (v: number) => layout.viewportLeft + cssX(v) * zoom - frame.left;
  const frameY = (v: number) => layout.viewportTop + cssY(v) * zoom - frame.top;
  const pointX = (v: number) => (Number.isFinite(v) ? clamp01(frameX(v) / frame.width) : v);
  const pointY = (v: number) => (Number.isFinite(v) ? clamp01(frameY(v) / frame.height) : v);
  const box = (b?: BoundingBox): BoundingBox | undefined => {
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return b;
    return { x: frameX(b.x), y: frameY(b.y), width: cssX(b.width) * zoom, height: cssY(b.height) * zoom };
  };

  return {
    ...data,
    metadata: {
      ...data.metadata,
      width: Math.round(frame.width),
      height: Math.round(frame.height),
      coordinateSpace: 'capture'
    },
    mousePoints: (data.mousePoints || []).map((p) => ({ ...p, x: pointX(p.x), y: pointY(p.y) })),
    clicks: (data.clicks || []).map((c) => ({
      ...c,
      x: pointX(c.x),
      y: pointY(c.y),
      ...(c.containerBounds ? { containerBounds: box(c.containerBounds) } : {})
    })),
    ...(data.pressEvents ? { pressEvents: data.pressEvents.map((p) => ({ ...p, x: pointX(p.x), y: pointY(p.y) })) } : {}),
    inputEvents: (data.inputEvents || []).map((ev) => ({ ...ev, bounds: box(ev.bounds) as BoundingBox }))
  };
}

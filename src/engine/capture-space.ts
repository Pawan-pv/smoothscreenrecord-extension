import type { BoundingBox, PageGeometry, ScreenLayout, TelemetryData } from '../types/telemetry';

/**
 * Page telemetry is measured in the page's viewport. A window or entire-screen
 * recording shows the whole window / screen, so its picture has a different
 * coordinate space: the page is a rectangle somewhere inside it. This moves the
 * page's coordinates onto the recorded frame, using where the page sat on the
 * screen (`screenLayout`, in screen CSS pixels).
 *
 * A recording that followed the user across tabs has several pages, each with
 * its own viewport and position: `metadata.pageGeometries[g]` is the geometry of
 * the page an event (tagged `g`) came from. Events without a tag use the
 * recording's own `metadata.screenLayout` / `width` / `height`, so a single-page
 * (or older) recording maps exactly as before.
 *
 * Returns the converted telemetry (coordinates normalized to the frame,
 * `metadata.width/height` = the frame's size, `coordinateSpace: 'capture'`), the
 * telemetry itself when it was already converted, or null when no page can be
 * placed reliably. Events of a page that cannot be placed (on another monitor,
 * say) are left out; the rest are kept.
 */

type Surface = 'window' | 'monitor';

function captureFrame(layout: ScreenLayout, displaySurface: Surface) {
  return displaySurface === 'monitor'
    ? { left: layout.screenLeft, top: layout.screenTop, width: layout.screenWidth, height: layout.screenHeight }
    : { left: layout.windowLeft, top: layout.windowTop, width: layout.windowWidth, height: layout.windowHeight };
}

/** Why one page geometry cannot be placed on the frame, or null when it can. */
function geometryProblem(
  geometry: Partial<PageGeometry> | undefined,
  displaySurface: Surface,
  frameWidth?: number,
  frameHeight?: number
): string | null {
  const layout = geometry?.screenLayout;
  if (!layout) return 'the page did not report where it was on the screen';
  if (!(Number(geometry?.width) > 0) || !(Number(geometry?.height) > 0)) return 'the page size is unknown';
  const frame = captureFrame(layout, displaySurface);
  if (![frame.left, frame.top, frame.width, frame.height, layout.viewportLeft, layout.viewportTop].every(Number.isFinite)) {
    return 'the page position on the screen is incomplete';
  }
  if (!(frame.width > 0) || !(frame.height > 0)) return 'the screen size is unknown';
  if (Number(frameWidth) > 0 && Number(frameHeight) > 0) {
    const pictureAspect = (frameWidth as number) / (frameHeight as number);
    const frameAspect = frame.width / frame.height;
    if (Math.abs(pictureAspect - frameAspect) / frameAspect > 0.05) {
      return `the recorded picture (${frameWidth}x${frameHeight}) is not the shape of the ${displaySurface === 'monitor' ? 'screen' : 'window'} the page was on (${Math.round(frame.width)}x${Math.round(frame.height)}): another monitor or app was shared`;
    }
  }
  return null;
}

/** The recording's own geometry (untagged events) followed by the tagged pages'. */
function geometriesOf(data: TelemetryData): { base: Partial<PageGeometry>; tagged: PageGeometry[] } {
  return {
    base: { width: data.metadata?.width, height: data.metadata?.height, screenLayout: data.metadata?.screenLayout },
    tagged: Array.isArray(data.metadata?.pageGeometries) ? data.metadata!.pageGeometries! : []
  };
}

/**
 * Why a window / screen recording's pages cannot be placed on its frame, or null when
 * at least one can (or when there is nothing to place: a tab recording, or already
 * converted). toCaptureSpace uses exactly these checks.
 */
export function captureSpaceProblem(
  data: TelemetryData,
  displaySurface: string | undefined,
  frameWidth?: number,
  frameHeight?: number
): string | null {
  if (displaySurface !== 'window' && displaySurface !== 'monitor') return null;
  if (data.metadata?.coordinateSpace === 'capture') return null;
  const { base, tagged } = geometriesOf(data);
  const baseProblem = geometryProblem(base, displaySurface, frameWidth, frameHeight);
  if (!baseProblem) return null;
  if (tagged.some((g) => !geometryProblem(g, displaySurface, frameWidth, frameHeight))) return null;
  return baseProblem;
}

interface Mapper {
  frame: { width: number; height: number };
  point(x: number, y: number): { x: number; y: number };
  box(b?: BoundingBox): BoundingBox | undefined;
}

function mapperFor(geometry: Partial<PageGeometry>, displaySurface: Surface): Mapper {
  const layout = geometry.screenLayout as ScreenLayout;
  const vw = geometry.width as number;
  const vh = geometry.height as number;
  const frame = captureFrame(layout, displaySurface);
  const zoom = Number.isFinite(layout.zoom) && layout.zoom > 0 ? layout.zoom : 1;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  // Telemetry coordinates are normalized (0..1) or, in older recordings, CSS pixels.
  const cssX = (v: number) => (v >= 0 && v <= 1 ? v * vw : v);
  const cssY = (v: number) => (v >= 0 && v <= 1 ? v * vh : v);
  /** Page CSS pixel -> frame pixel (screen CSS pixels from the frame's top-left). */
  const frameX = (v: number) => layout.viewportLeft + cssX(v) * zoom - frame.left;
  const frameY = (v: number) => layout.viewportTop + cssY(v) * zoom - frame.top;
  return {
    frame,
    point: (x, y) => ({
      x: Number.isFinite(x) ? clamp01(frameX(x) / frame.width) : x,
      y: Number.isFinite(y) ? clamp01(frameY(y) / frame.height) : y
    }),
    box: (b) => {
      if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return b;
      return { x: frameX(b.x), y: frameY(b.y), width: cssX(b.width) * zoom, height: cssY(b.height) * zoom };
    }
  };
}

export function toCaptureSpace(
  data: TelemetryData,
  displaySurface: string | undefined,
  frameWidth?: number,
  frameHeight?: number
): TelemetryData | null {
  if (displaySurface !== 'window' && displaySurface !== 'monitor') return null;
  if (data.metadata?.coordinateSpace === 'capture') return data;
  if (captureSpaceProblem(data, displaySurface, frameWidth, frameHeight)) return null;

  const { base, tagged } = geometriesOf(data);
  const baseMapper = geometryProblem(base, displaySurface, frameWidth, frameHeight) ? null : mapperFor(base, displaySurface);
  const taggedMappers = tagged.map((g) => (geometryProblem(g, displaySurface, frameWidth, frameHeight) ? null : mapperFor(g, displaySurface)));
  /** The mapper of an event's page; null = that page cannot be placed (its events are left out). */
  const mapperOf = (g: number | undefined): Mapper | null =>
    typeof g === 'number' && g >= 0 && g < taggedMappers.length ? taggedMappers[g] : baseMapper;
  const frame = (baseMapper ?? taggedMappers.find(Boolean))!.frame;

  const mousePoints = [];
  for (const p of data.mousePoints || []) {
    const m = mapperOf(p.g);
    if (m) mousePoints.push({ ...p, ...m.point(p.x, p.y) });
  }
  const clicks = [];
  for (const c of data.clicks || []) {
    const m = mapperOf(c.g);
    if (!m) continue;
    clicks.push({ ...c, ...m.point(c.x, c.y), ...(c.containerBounds ? { containerBounds: m.box(c.containerBounds) } : {}) });
  }
  const pressEvents = data.pressEvents
    ? data.pressEvents.flatMap((p) => {
        const m = mapperOf(p.g);
        return m ? [{ ...p, ...m.point(p.x, p.y) }] : [];
      })
    : undefined;
  const inputEvents = (data.inputEvents || []).flatMap((ev) => {
    const m = mapperOf(ev.g);
    return m ? [{ ...ev, bounds: m.box(ev.bounds) as BoundingBox }] : [];
  });

  return {
    ...data,
    metadata: {
      ...data.metadata,
      width: Math.round(frame.width),
      height: Math.round(frame.height),
      coordinateSpace: 'capture'
    },
    mousePoints,
    clicks,
    ...(pressEvents ? { pressEvents } : {}),
    inputEvents
  };
}

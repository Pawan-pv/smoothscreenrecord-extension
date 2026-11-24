import type { ZoomPill } from '../types/telemetry';
import type { CameraState } from './spring-physics';

/**
 * Deterministic camera schedule.
 *
 * The camera is NOT simulated while rendering. `buildCameraPath` turns the zoom
 * pills (and, for Dead-Zone Smart Pan, the smoothed cursor path) into a
 * schedule once; `path.at(t)` is then a pure function of time. The preview, the
 * MP4 export and the GIF export all evaluate the same schedule, so scrubbing is
 * instant and every output shows the identical camera at the identical time.
 *
 * Behaviours:
 *   idle (1.0x) -> zoom-in -> hold with dead-zone pan -> zoom-out (to 1.0x)
 *   and, between two pills that follow each other closely, a direct smooth pan
 *   from one target to the next (no zoom-out in between).
 */

/** Front-loaded ease-out: zoom-ins launch crisply and settle softly. */
export const CAMERA_EASE: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Camera speed presets: how long a zoom-in, a pan between zooms and a zoom-out take. */
export const ZOOM_SPEEDS = [
  { label: 'Rapid', ms: 250 },
  { label: 'Quick', ms: 400 },
  { label: 'Default', ms: 600 },
  { label: 'Slow', ms: 900 }
] as const;
/** Length of a camera move when a pill does not set its own ("Default"). */
export const DEFAULT_TRANSITION_MS = 600;
/** A move may take at most this share of a (short) pill. */
export const TRANSITION_MAX_FRACTION = 0.35;
/** Pills closer than this follow each other without a trip back to 1.0x. */
export const CHAIN_GAP_MS = 800;
/** The still region of the zoomed view, as a share of the view's width/height. */
export const DEAD_ZONE_FRACTION = 0.5;

const PAN_STEP_MS = 1000 / 120;
/** Natural frequency of the pan follow (rad/s): critically damped, settles in ~0.5 s. */
const PAN_OMEGA = 9;

/** CSS cubic-bezier(x1, y1, x2, y2) as a function progress -> eased progress. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (!(p > 0)) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - p;
      if (Math.abs(err) < 1e-7) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= err / slope;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    for (let i = 0; i < 40; i++) {
      const x = sampleX(t);
      if (Math.abs(x - p) < 1e-7) break;
      if (x < p) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

const ease = cubicBezier(...CAMERA_EASE);

export interface CursorSample {
  x: number;
  y: number;
}

export interface CameraPathOptions {
  /** ON = Dead-Zone Smart Pan, OFF = fixed focus only. Default ON. */
  followCursor?: boolean;
  /** The SMOOTHED cursor position at a time (normalized 0..1; legacy pixels are divided by the viewport). */
  cursorAt?: (timeMs: number) => CursorSample | null | undefined;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface CameraPath {
  at(timeMs: number): CameraState;
}

const NEUTRAL: CameraState = { x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Keeps the cropped view inside the frame: no empty space at the edges. */
function clampCenter(v: number, scale: number): number {
  const half = 0.5 / Math.max(1, scale);
  return Math.max(half, Math.min(1 - half, v));
}

interface PanTrack {
  at(timeMs: number): { x: number; y: number };
}

interface Zoom {
  start: number;
  end: number;
  transition: number;
  scale: number;
  targetX: number;
  targetY: number;
  tiltX: number;
  tiltY: number;
  pan: PanTrack;
}

/**
 * Dead-Zone Smart Pan for one zoom, precomputed over the smoothed cursor path.
 *
 * `focus` is where the camera WANTS to look. It only moves when the cursor
 * leaves the central DEAD_ZONE_FRACTION of the zoomed view (around the focus),
 * and then only by the distance needed to put the cursor back on the box edge.
 * The camera follows `focus` with a critically damped spring, so a still cursor
 * means a perfectly still camera and a push past the boundary is a smooth pan.
 * Sampled at 120 Hz into a table: reading it is a pure function of time.
 */
function buildPanTrack(
  zoom: Pick<Zoom, 'start' | 'end' | 'scale' | 'targetX' | 'targetY'>,
  follow: boolean,
  cursorAt: CameraPathOptions['cursorAt'],
  viewportWidth: number,
  viewportHeight: number
): PanTrack {
  const startX = clampCenter(zoom.targetX, zoom.scale);
  const startY = clampCenter(zoom.targetY, zoom.scale);
  if (!follow || !cursorAt) {
    const fixed = { x: startX, y: startY };
    return { at: () => fixed };
  }

  const half = 0.5 / Math.max(1, zoom.scale);
  const safe = DEAD_ZONE_FRACTION * half;
  const steps = Math.max(1, Math.ceil((zoom.end - zoom.start) / PAN_STEP_MS));
  const xs = new Float64Array(steps + 2);
  const ys = new Float64Array(steps + 2);

  let focusX = startX;
  let focusY = startY;
  let camX = startX;
  let camY = startY;
  let velX = 0;
  let velY = 0;
  const dt = PAN_STEP_MS / 1000;

  for (let i = 0; i <= steps + 1; i++) {
    const t = zoom.start + i * PAN_STEP_MS;
    const raw = cursorAt(t);
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      const px = clamp01(raw.x <= 1 ? raw.x : raw.x / viewportWidth);
      const py = clamp01(raw.y <= 1 ? raw.y : raw.y / viewportHeight);
      const dx = px - focusX;
      const dy = py - focusY;
      if (dx > safe) focusX = px - safe; else if (dx < -safe) focusX = px + safe;
      if (dy > safe) focusY = py - safe; else if (dy < -safe) focusY = py + safe;
      focusX = Math.max(half, Math.min(1 - half, focusX));
      focusY = Math.max(half, Math.min(1 - half, focusY));
    }
    xs[i] = camX;
    ys[i] = camY;
    // Critically damped spring toward the focus (semi-implicit Euler, fixed step).
    velX += (-2 * PAN_OMEGA * velX - PAN_OMEGA * PAN_OMEGA * (camX - focusX)) * dt;
    velY += (-2 * PAN_OMEGA * velY - PAN_OMEGA * PAN_OMEGA * (camY - focusY)) * dt;
    camX += velX * dt;
    camY += velY * dt;
    // The spring only approaches its focus asymptotically: once it is within 2e-5 (a
    // fraction of a pixel) and has stopped, it IS there. A still cursor means a still camera.
    if (Math.abs(camX - focusX) < 2e-5 && Math.abs(velX) < 1e-3) { camX = focusX; velX = 0; }
    if (Math.abs(camY - focusY) < 2e-5 && Math.abs(velY) < 1e-3) { camY = focusY; velY = 0; }
  }

  return {
    at(timeMs: number) {
      const f = Math.max(0, Math.min(steps, (timeMs - zoom.start) / PAN_STEP_MS));
      const i = Math.floor(f);
      const r = f - i;
      return { x: lerp(xs[i], xs[i + 1], r), y: lerp(ys[i], ys[i + 1], r) };
    }
  };
}

/** Cleans the pills into non-overlapping, time-ordered zooms. */
function normalizeZooms(pills: ZoomPill[]): Array<{ pill: ZoomPill; start: number; end: number }> {
  const sorted = pills
    .filter((p) => p && Number.isFinite(p.startTime) && Number.isFinite(p.endTime) && p.endTime > p.startTime)
    .map((pill) => ({ pill, start: pill.startTime, end: pill.endTime }))
    .sort((a, b) => a.start - b.start);
  const out: typeof sorted = [];
  for (const z of sorted) {
    const prev = out[out.length - 1];
    // Overlap (manual zooms can overlap): the earlier zoom hands over where the next begins.
    if (prev && z.start < prev.end) prev.end = z.start;
    if (prev && prev.end <= prev.start) out.pop();
    out.push({ ...z });
  }
  return out;
}

export function buildCameraPath(pills: ZoomPill[], options: CameraPathOptions = {}): CameraPath {
  const follow = options.followCursor !== false;
  const vw = options.viewportWidth && options.viewportWidth > 0 ? options.viewportWidth : 1920;
  const vh = options.viewportHeight && options.viewportHeight > 0 ? options.viewportHeight : 1080;

  const zooms: Zoom[] = normalizeZooms(pills).map(({ pill, start, end }) => {
    const duration = end - start;
    const requested = Number.isFinite(pill.transitionDuration) && (pill.transitionDuration as number) > 0
      ? (pill.transitionDuration as number)
      : DEFAULT_TRANSITION_MS;
    const scale = Math.max(1, Number.isFinite(pill.targetScale) ? pill.targetScale : 1);
    const zoom = {
      start,
      end,
      transition: Math.max(1, Math.min(requested, duration * TRANSITION_MAX_FRACTION)),
      scale,
      targetX: Number.isFinite(pill.targetX) ? pill.targetX : 0.5,
      targetY: Number.isFinite(pill.targetY) ? pill.targetY : 0.5,
      tiltX: pill.tiltX || 0,
      tiltY: pill.tiltY || 0
    };
    return { ...zoom, pan: buildPanTrack(zoom, follow, options.cursorAt, vw, vh) };
  });

  if (zooms.length === 0) return { at: () => ({ ...NEUTRAL }) };

  const starts = zooms.map((z) => z.start);
  const chained = (a: Zoom, b: Zoom) => b.start - a.end <= CHAIN_GAP_MS;

  const finish = (x: number, y: number, scale: number, tiltX: number, tiltY: number): CameraState => ({
    x: clampCenter(x, scale),
    y: clampCenter(y, scale),
    scale,
    tiltX,
    tiltY
  });

  const holdState = (z: Zoom, t: number): CameraState => {
    const c = z.pan.at(t);
    return finish(c.x, c.y, z.scale, z.tiltX, z.tiltY);
  };

  const enterState = (z: Zoom, t: number): CameraState => {
    const e = ease((t - z.start) / z.transition);
    const c = z.pan.at(t);
    return finish(lerp(0.5, c.x, e), lerp(0.5, c.y, e), lerp(1, z.scale, e), z.tiltX * e, z.tiltY * e);
  };

  const exitState = (z: Zoom, t: number): CameraState => {
    const e = ease((t - (z.end - z.transition)) / z.transition);
    const c = z.pan.at(t);
    return finish(lerp(c.x, 0.5, e), lerp(c.y, 0.5, e), lerp(z.scale, 1, e), lerp(z.tiltX, 0, e), lerp(z.tiltY, 0, e));
  };

  /** Length of the direct move from zoom a to zoom b, starting where a ends. */
  const chainLength = (a: Zoom, b: Zoom) => Math.max(b.transition, b.start - a.end);

  const chainState = (a: Zoom, b: Zoom, t: number): CameraState => {
    const p = clamp01((t - a.end) / chainLength(a, b));
    const e = ease(p);
    const from = a.pan.at(a.end);
    const to = b.pan.at(t);
    const scale = lerp(a.scale, b.scale, e);
    return finish(
      lerp(from.x, to.x, e),
      lerp(from.y, to.y, e),
      scale,
      lerp(a.tiltX, b.tiltX, e),
      lerp(a.tiltY, b.tiltY, e)
    );
  };

  const insideZoom = (i: number, t: number): CameraState => {
    const z = zooms[i];
    const prev = i > 0 ? zooms[i - 1] : null;
    const next = i < zooms.length - 1 ? zooms[i + 1] : null;
    if (prev && chained(prev, z)) {
      if (t < prev.end + chainLength(prev, z)) return chainState(prev, z, t);
    } else if (t < z.start + z.transition) {
      return enterState(z, t);
    }
    if (!(next && chained(z, next)) && t > z.end - z.transition) return exitState(z, t);
    return holdState(z, t);
  };

  return {
    at(timeMs: number): CameraState {
      if (!Number.isFinite(timeMs)) return { ...NEUTRAL };
      // Last zoom that has started.
      let lo = 0;
      let hi = zooms.length - 1;
      let i = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= timeMs) { i = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (i < 0) {
        // Before the first zoom, or inside the move into the first one when it chains from nothing: idle.
        return { ...NEUTRAL };
      }
      const z = zooms[i];
      if (timeMs <= z.end) return insideZoom(i, timeMs);
      const next = zooms[i + 1];
      if (next && chained(z, next) && timeMs < z.end + chainLength(z, next)) return chainState(z, next, timeMs);
      return { ...NEUTRAL };
    }
  };
}

import type { ZoomPill } from '../types/telemetry';
import type { CameraState } from './spring-physics';
import { createSpring, dampingFor, SPRING_STEP_MS } from './spring';

/**
 * Deterministic camera schedule.
 *
 * `targetAt(t)` is where the camera WANTS to be: the active zoom's depth (ramped in
 * and out over its transition), its focus interpolated between the shot's click
 * keyframes and, with Follow Cursor on, pushed so the cursor stays in the view.
 * `at(t)` is that target chased by stateful springs (zoomScale, focusX, focusY,
 * tilt). The springs are stepped ONCE, at a fixed 120 Hz, over the timeline when
 * the path is built, and read by time afterwards: the preview, scrubbing, the MP4
 * and the GIF export all show the identical camera at the identical time, and a
 * seek lands on exactly what playback shows there.
 */

/** Front-loaded ease-out (kept for callers that ease their own UI motion). */
export const CAMERA_EASE: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Camera speed presets: how long a zoom ramps in / out. */
export const ZOOM_SPEEDS = [
  { label: 'Rapid', ms: 250 },
  { label: 'Quick', ms: 400 },
  { label: 'Default', ms: 600 },
  { label: 'Slow', ms: 900 }
] as const;
/** Length of a zoom ramp when a pill does not set its own ("Default"). */
export const DEFAULT_TRANSITION_MS = 600;
/** A ramp may take at most this share of a (short) pill. */
export const TRANSITION_MAX_FRACTION = 0.35;
/** Pills closer than this follow each other without a trip back to 1.0x. */
export const CHAIN_GAP_MS = 800;
/** Follow Cursor keeps the cursor inside this share of the zoomed view (its central box). */
export const DEAD_ZONE_FRACTION = 0.5;
/** Spring stiffness of the zoom depth: critically damped, follows its ramp ~80 ms behind. */
export const ZOOM_SPRING_STIFFNESS = 625;
/** Spring stiffness of the focus (pan): critically damped, a little calmer than the zoom. */
export const FOCUS_SPRING_STIFFNESS = 400;
/** After the last zoom the springs run this long more, then the camera is at rest. */
const SETTLE_MS = 2500;

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

export interface CursorSample {
  x: number;
  y: number;
}

export interface CameraPathOptions {
  /** ON = the camera also keeps the cursor inside the zoomed view. Default ON. */
  followCursor?: boolean;
  /** The SMOOTHED cursor position at a time (normalized 0..1; legacy pixels are divided by the viewport). */
  cursorAt?: (timeMs: number) => CursorSample | null | undefined;
  viewportWidth?: number;
  viewportHeight?: number;
  /**
   * Share of the source's width / height the output window shows at 1.0x
   * (cameraViewFraction). Default 1 x 1 (Fit). Smart-fill shows less on one axis.
   */
  viewFraction?: { x: number; y: number };
}

export interface CameraTarget {
  scale: number;
  x: number;
  y: number;
  tiltX: number;
  tiltY: number;
}

export interface CameraPath {
  /** The sprung camera at a time: what is rendered. */
  at(timeMs: number): CameraState;
  /** Where the camera wants to be at a time, before the springs. */
  targetAt(timeMs: number): CameraTarget;
}

const NEUTRAL: CameraState = { x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Keeps the cropped view inside the frame: no empty space at the edges. `fraction` is the
 * share of the source the window shows at 1.0x on this axis, so the view's half-size is
 * `0.5 * fraction / scale` and a clamped target is always inside the view.
 */
function clampCenter(v: number, scale: number, fraction = 1): number {
  const half = (0.5 * fraction) / Math.max(1, scale);
  return Math.max(half, Math.min(1 - half, v));
}

function sanitizeFraction(v: number | undefined): number {
  return Number.isFinite(v) && (v as number) > 0 ? Math.min(1, v as number) : 1;
}

interface Zoom {
  start: number;
  end: number;
  ramp: number;
  scale: number;
  keyframes: Array<{ t: number; x: number; y: number }>;
  tiltX: number;
  tiltY: number;
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

/** The focus of a zoom at a time: its keyframes, linearly interpolated (held before the first / after the last). */
function focusOf(z: Zoom, t: number): { x: number; y: number } {
  const k = z.keyframes;
  if (t <= k[0].t) return { x: k[0].x, y: k[0].y };
  const last = k[k.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[i + 1];
  const p = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
}

export function buildCameraPath(pills: ZoomPill[], options: CameraPathOptions = {}): CameraPath {
  const follow = options.followCursor !== false && typeof options.cursorAt === 'function';
  const vw = options.viewportWidth && options.viewportWidth > 0 ? options.viewportWidth : 1920;
  const vh = options.viewportHeight && options.viewportHeight > 0 ? options.viewportHeight : 1080;
  const view = { x: sanitizeFraction(options.viewFraction?.x), y: sanitizeFraction(options.viewFraction?.y) };

  const zooms: Zoom[] = normalizeZooms(pills).map(({ pill, start, end }) => {
    const duration = end - start;
    const requested = Number.isFinite(pill.transitionDuration) && (pill.transitionDuration as number) > 0
      ? (pill.transitionDuration as number)
      : DEFAULT_TRANSITION_MS;
    const tx = Number.isFinite(pill.targetX) ? clamp01(pill.targetX) : 0.5;
    const ty = Number.isFinite(pill.targetY) ? clamp01(pill.targetY) : 0.5;
    const keyframes = (pill.keyframes || [])
      .filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.x) && Number.isFinite(k.y))
      .map((k) => ({ t: k.t, x: clamp01(k.x), y: clamp01(k.y) }))
      .sort((a, b) => a.t - b.t);
    return {
      start,
      end,
      ramp: Math.max(1, Math.min(requested, duration * TRANSITION_MAX_FRACTION)),
      scale: Math.max(1, Number.isFinite(pill.targetScale) ? pill.targetScale : 1),
      keyframes: keyframes.length > 0 ? keyframes : [{ t: start, x: tx, y: ty }],
      tiltX: pill.tiltX || 0,
      tiltY: pill.tiltY || 0
    };
  });

  if (zooms.length === 0) {
    return { at: () => ({ ...NEUTRAL }), targetAt: () => ({ ...NEUTRAL }) };
  }

  const starts = zooms.map((z) => z.start);
  const chained = (a: Zoom, b: Zoom) => b.start - a.end <= CHAIN_GAP_MS;

  /** Follow Cursor: push the focus just enough that the cursor stays in the zoom's central box. */
  const followed = (z: Zoom, t: number, f: { x: number; y: number }) => {
    if (!follow) return f;
    const raw = options.cursorAt!(t);
    if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return f;
    const cx = clamp01(raw.x <= 1 ? raw.x : raw.x / vw);
    const cy = clamp01(raw.y <= 1 ? raw.y : raw.y / vh);
    const safeX = (DEAD_ZONE_FRACTION * 0.5 * view.x) / z.scale;
    const safeY = (DEAD_ZONE_FRACTION * 0.5 * view.y) / z.scale;
    return {
      x: Math.max(cx - safeX, Math.min(cx + safeX, f.x)),
      y: Math.max(cy - safeY, Math.min(cy + safeY, f.y))
    };
  };

  const targetAt = (t: number): CameraTarget => {
    if (!Number.isFinite(t)) return { ...NEUTRAL };
    // Last zoom that has started.
    let lo = 0;
    let hi = zooms.length - 1;
    let i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) { i = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (i < 0) return { ...NEUTRAL };
    const z = zooms[i];
    const prev = i > 0 ? zooms[i - 1] : null;
    const next = i < zooms.length - 1 ? zooms[i + 1] : null;
    if (t <= z.end) {
      // Linear ramps; a zoom that follows another closely takes over without zooming out.
      const wIn = prev && chained(prev, z) ? 1 : clamp01((t - z.start) / z.ramp);
      const wOut = next && chained(z, next) ? 1 : clamp01((z.end - t) / z.ramp);
      const w = Math.min(wIn, wOut);
      const f = followed(z, t, focusOf(z, t));
      return { scale: 1 + (z.scale - 1) * w, x: f.x, y: f.y, tiltX: z.tiltX * w, tiltY: z.tiltY * w };
    }
    if (next && chained(z, next)) {
      // Short gap between two zooms: hold the zoom and pan straight across.
      const p = clamp01((t - z.end) / Math.max(1, next.start - z.end));
      const a = focusOf(z, z.end);
      const b = focusOf(next, next.start);
      return {
        scale: lerp(z.scale, next.scale, p),
        x: lerp(a.x, b.x, p),
        y: lerp(a.y, b.y, p),
        tiltX: lerp(z.tiltX, next.tiltX, p),
        tiltY: lerp(z.tiltY, next.tiltY, p)
      };
    }
    return { ...NEUTRAL };
  };

  // Step the springs once, at a fixed rate, over the whole camera timeline.
  const t0 = zooms[0].start;
  const tEnd = Math.max(...zooms.map((z) => z.end)) + SETTLE_MS;
  const steps = Math.max(1, Math.ceil((tEnd - t0) / SPRING_STEP_MS));
  const table = Array.from({ length: 5 }, () => new Float64Array(steps + 1));
  const springs = [
    createSpring(ZOOM_SPRING_STIFFNESS, dampingFor(ZOOM_SPRING_STIFFNESS), NEUTRAL.scale),
    createSpring(FOCUS_SPRING_STIFFNESS, dampingFor(FOCUS_SPRING_STIFFNESS), NEUTRAL.x),
    createSpring(FOCUS_SPRING_STIFFNESS, dampingFor(FOCUS_SPRING_STIFFNESS), NEUTRAL.y),
    createSpring(ZOOM_SPRING_STIFFNESS, dampingFor(ZOOM_SPRING_STIFFNESS), 0),
    createSpring(ZOOM_SPRING_STIFFNESS, dampingFor(ZOOM_SPRING_STIFFNESS), 0)
  ];
  const dt = SPRING_STEP_MS / 1000;
  for (let s = 0; s <= steps; s++) {
    const target = targetAt(t0 + s * SPRING_STEP_MS);
    const goals = [target.scale, target.x, target.y, target.tiltX, target.tiltY];
    for (let c = 0; c < 5; c++) {
      table[c][s] = springs[c].value;
      springs[c].step(goals[c], dt);
      // A spring only approaches its target asymptotically: within a fraction of a
      // pixel and at rest, it IS there. A still target means a perfectly still camera.
      if (Math.abs(springs[c].value - goals[c]) < 2e-5 && Math.abs(springs[c].velocity) < 1e-3) springs[c].snap(goals[c]);
    }
  }

  return {
    targetAt,
    at(timeMs: number): CameraState {
      if (!Number.isFinite(timeMs) || timeMs <= t0 || timeMs >= tEnd) return { ...NEUTRAL };
      const f = Math.min(steps, (timeMs - t0) / SPRING_STEP_MS);
      const i = Math.min(steps - 1, Math.floor(f));
      const r = f - i;
      const read = (c: number) => lerp(table[c][i], table[c][i + 1], r);
      const scale = Math.max(1, read(0));
      return {
        x: clampCenter(read(1), scale, view.x),
        y: clampCenter(read(2), scale, view.y),
        scale,
        tiltX: read(3),
        tiltY: read(4)
      };
    }
  };
}

import type { ZoomPill } from '../types/telemetry';
import type { CameraState } from './spring-physics';
import { createSpring, dampingFor, SPRING_STEP_MS } from './spring';

/**
 * Deterministic camera schedule.
 *
 * `targetAt(t)` is where the camera WANTS to be: the active zoom's depth (eased in
 * and out over its transition), its focus interpolated between the shot's click
 * keyframes and, with Follow Cursor on, pushed so the cursor stays in the view.
 * `at(t)` is that target chased by stateful springs (zoomScale, focusX, focusY,
 * tilt). The springs are stepped ONCE, at a fixed 120 Hz, over the timeline when
 * the path is built, and read by time afterwards: the preview, scrubbing, the MP4
 * and the GIF export all show the identical camera at the identical time, and a
 * seek lands on exactly what playback shows there.
 *
 * The target is C² at every handoff:
 * - the zoom ramps use a quintic ease (zero velocity AND acceleration at both ends),
 * - the focus keyframes use a monotone cubic (PCHIP: C¹, no overshoot),
 * - the Follow Cursor dead-zone uses a soft min/max (no velocity corner when the
 *   cursor crosses the box),
 * - a chained hop pans with the same quintic and adds a smooth mid-gap dip on wide
 *   moves, so consecutive clicks never zoom out to 1.0x and back.
 */

/** Front-loaded ease-out (kept for callers that ease their own UI motion). */
export const CAMERA_EASE: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Camera speed presets: how long a zoom takes to arrive (the release is quicker). */
export const ZOOM_SPEEDS = [
  { label: 'Snap', ms: 320 },
  { label: 'Smooth', ms: 500 },
  { label: 'Cinematic', ms: 700 }
] as const;
/** Arrival ramp when a pill does not set its own ("Smooth"). */
export const DEFAULT_TRANSITION_MS = 500;
/** The release ramp is this share of the arrival ramp (Cinematic 700 in / 525 out). */
export const OUT_RAMP_RATIO = 0.75;
/** Arrival + release may take at most this share of a (short) pill: the rest is a readable hold. */
export const TRANSITION_MAX_FRACTION = 0.65;
/** Pills closer than this follow each other without a trip back to 1.0x. */
export const CHAIN_GAP_MS = 1400;
/** Follow Cursor keeps the cursor inside this share of the zoomed view (its central box). */
export const DEAD_ZONE_FRACTION = 0.5;
/** Soft width of the dead-zone boundary, as a share of the safe half-box. */
export const DEAD_ZONE_FEATHER = 0.35;
/** A chained pan wider than this (normalised distance) breathes with a scale dip. */
export const CHAIN_DIP_MIN_DIST = 0.25;
/** Mid-gap dip depth, as a share of the shallower of the two zoom depths. */
export const CHAIN_DIP_DEPTH = 0.78;
/** The dip never goes below this scale. */
export const CHAIN_DIP_FLOOR = 1.25;
/** Focus spring stiffness as a share of the zoom spring (a little calmer pan). */
export const FOCUS_STIFFNESS_RATIO = 0.64;
/** After the last zoom the springs run this long more, then the camera is at rest. */
const SETTLE_MS = 2500;

/**
 * Responsive follower springs, per camera preset. The lush shape is carried by the
 * quintic ramp + PCHIP focus; the spring only has to keep up, so a slower preset gets
 * a softer follower and a snappier one a stiffer follower.
 */
const CAMERA_SPRING_PRESETS: ReadonlyArray<readonly [number, number]> = [
  [320, 750],
  [500, 550],
  [700, 380]
];

/** Zoom-spring stiffness for a camera preset (interpolated between the presets, clamped outside). */
export function cameraZoomStiffness(presetMs?: number): number {
  if (!Number.isFinite(presetMs) || (presetMs as number) <= 0) return 550;
  const ms = presetMs as number;
  const first = CAMERA_SPRING_PRESETS[0];
  const last = CAMERA_SPRING_PRESETS[CAMERA_SPRING_PRESETS.length - 1];
  if (ms <= first[0]) return first[1];
  if (ms >= last[0]) return last[1];
  for (let i = 1; i < CAMERA_SPRING_PRESETS.length; i++) {
    const [m0, k0] = CAMERA_SPRING_PRESETS[i - 1];
    const [m1, k1] = CAMERA_SPRING_PRESETS[i];
    if (ms <= m1) return k0 + (k1 - k0) * ((ms - m0) / (m1 - m0));
  }
  return 550;
}

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
  /**
   * Camera preset in ms (the active auto-zoom speed). When omitted, the most common
   * `transitionDuration` among the pills is used, so preview and exports agree.
   */
  presetMs?: number;
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

/** Quintic ease: zero first AND second derivative at 0 and 1 (C² handoffs). */
const ease5 = (p: number) => {
  const t = clamp01(p);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Keeps the cropped view inside the frame: no empty space at the edges. `fraction` is the
 * share of the source the window shows at 1.0x on this axis, so the view's half-size is
 * `0.5 * fraction / scale` and a clamped target is always inside the view.
 */
function clampCenter(v: number, scale: number, fraction = 1): number {
  const half = (0.5 * fraction) / Math.max(1, scale);
  return Math.max(half, Math.min(1 - half, v));
}

/** Polynomial smooth max: C¹, never below `b`, smooths over `band`. */
function softMax(a: number, b: number, band: number): number {
  const h = clamp01(0.5 + (0.5 * (a - b)) / band);
  return b + (a - b) * h + band * h * (1 - h);
}

/** Polynomial smooth min: C¹, never above `b`, smooths over `band`. */
function softMin(a: number, b: number, band: number): number {
  return -softMax(-a, -b, band);
}

/** Soft clamp to [lo, hi] with a C¹ feather: no velocity corner when a target crosses the box. */
function softClamp(v: number, lo: number, hi: number, feather: number): number {
  if (!(hi > lo)) return (lo + hi) * 0.5;
  const band = Math.min(feather, (hi - lo) * 0.5);
  return softMin(softMax(v, lo, band), hi, band);
}

function sanitizeFraction(v: number | undefined): number {
  return Number.isFinite(v) && (v as number) > 0 ? Math.min(1, v as number) : 1;
}

interface Zoom {
  start: number;
  end: number;
  /** Arrival ramp (ms). */
  inRamp: number;
  /** Release ramp (ms), shorter than the arrival. */
  outRamp: number;
  /** The ramp the user asked for, before the short-pill clamp (used to pick the spring). */
  requestedRamp: number;
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

/**
 * Monotone cubic (PCHIP) focus at a time: C¹ across keyframes, never overshoots a
 * click's focus. A linear join kinked the pan speed at every click; this does not.
 */
function focusOf(z: Zoom, t: number): { x: number; y: number } {
  const k = z.keyframes;
  const n = k.length;
  if (n === 0) return { x: 0.5, y: 0.5 };
  if (n === 1) return { x: k[0].x, y: k[0].y };
  if (t <= k[0].t) return { x: k[0].x, y: k[0].y };
  const last = k[n - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let i = 0;
  while (i < n - 2 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[i + 1];
  const h = b.t - a.t;
  if (!(h > 0)) return { x: b.x, y: b.y };
  const s = (t - a.t) / h;
  return { x: pchip(k, i, s, 'x'), y: pchip(k, i, s, 'y') };
}

/** One PCHIP segment (index i, local parameter s) on one axis. */
function pchip(k: Array<{ t: number; x: number; y: number }>, i: number, s: number, axis: 'x' | 'y'): number {
  const n = k.length;
  const y = (j: number) => k[j][axis];
  const dt = (j: number) => k[j + 1].t - k[j].t;
  const delta = (j: number) => {
    const d = dt(j);
    return d > 0 ? (y(j + 1) - y(j)) / d : 0;
  };
  const tangent = (j: number): number => {
    if (j <= 0) return delta(0);
    if (j >= n - 1) return delta(n - 2);
    const d0 = delta(j - 1);
    const d1 = delta(j);
    if (d0 === 0 || d1 === 0 || d0 * d1 < 0) return 0;
    const h0 = dt(j - 1);
    const h1 = dt(j);
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  };
  const h = dt(i);
  const m0 = tangent(i);
  const m1 = tangent(i + 1);
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * y(i)
    + (s3 - 2 * s2 + s) * h * m0
    + (-2 * s3 + 3 * s2) * y(i + 1)
    + (s3 - s2) * h * m1;
}

/** The preset shared by most pills (the active auto-zoom speed), else the default. */
function dominantPreset(zooms: Zoom[]): number {
  if (zooms.length === 0) return DEFAULT_TRANSITION_MS;
  const counts = new Map<number, number>();
  for (const z of zooms) counts.set(z.requestedRamp, (counts.get(z.requestedRamp) || 0) + 1);
  let best = DEFAULT_TRANSITION_MS;
  let bestCount = 0;
  for (const [ms, count] of counts) {
    if (count > bestCount) { best = ms; bestCount = count; }
  }
  return best;
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
    // Arrival + release share the pill: on a short pill both are scaled down so a
    // readable hold at full zoom always survives.
    const maxTotal = Math.max(1, duration * TRANSITION_MAX_FRACTION);
    let inRamp = Math.max(1, requested);
    let outRamp = Math.max(1, requested * OUT_RAMP_RATIO);
    const total = inRamp + outRamp;
    if (total > maxTotal) {
      const fit = maxTotal / total;
      inRamp *= fit;
      outRamp *= fit;
    }
    const tx = Number.isFinite(pill.targetX) ? clamp01(pill.targetX) : 0.5;
    const ty = Number.isFinite(pill.targetY) ? clamp01(pill.targetY) : 0.5;
    const keyframes = (pill.keyframes || [])
      .filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.x) && Number.isFinite(k.y))
      .map((k) => ({ t: k.t, x: clamp01(k.x), y: clamp01(k.y) }))
      .sort((a, b) => a.t - b.t);
    return {
      start,
      end,
      inRamp,
      outRamp,
      requestedRamp: requested,
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
  const followedAt = (scale: number, t: number, f: { x: number; y: number }) => {
    if (!follow) return f;
    const raw = options.cursorAt!(t);
    if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return f;
    const cx = clamp01(raw.x <= 1 ? raw.x : raw.x / vw);
    const cy = clamp01(raw.y <= 1 ? raw.y : raw.y / vh);
    const safeX = (DEAD_ZONE_FRACTION * 0.5 * view.x) / Math.max(1, scale);
    const safeY = (DEAD_ZONE_FRACTION * 0.5 * view.y) / Math.max(1, scale);
    return {
      x: softClamp(f.x, cx - safeX, cx + safeX, safeX * DEAD_ZONE_FEATHER),
      y: softClamp(f.y, cy - safeY, cy + safeY, safeY * DEAD_ZONE_FEATHER)
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
      // Quintic ramps; a zoom that follows another closely takes over without zooming out.
      const wIn = prev && chained(prev, z) ? 1 : ease5((t - z.start) / z.inRamp);
      const wOut = next && chained(z, next) ? 1 : ease5((z.end - t) / z.outRamp);
      const w = Math.min(wIn, wOut);
      const scale = 1 + (z.scale - 1) * w;
      const f = followedAt(z.scale, t, focusOf(z, t));
      // Pre-clamp the target to the box for its own scale; `at()` clamps again after
      // smoothing, so the rendered view can never leave the frame.
      return {
        scale,
        x: clampCenter(f.x, scale, view.x),
        y: clampCenter(f.y, scale, view.y),
        tiltX: z.tiltX * w,
        tiltY: z.tiltY * w
      };
    }
    if (next && chained(z, next)) {
      // Short gap between two zooms: hold the zoom and pan straight across.
      const p = clamp01((t - z.end) / Math.max(1, next.start - z.end));
      const e = ease5(p);
      const a = focusOf(z, z.end);
      const b = focusOf(next, next.start);
      const baseScale = lerp(z.scale, next.scale, e);
      // A wide chained pan breathes: dip mid-gap so the camera does not drag sideways at full zoom.
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      let scale = baseScale;
      if (dist > CHAIN_DIP_MIN_DIST) {
        const dip = Math.max(CHAIN_DIP_FLOOR, Math.min(z.scale, next.scale) * CHAIN_DIP_DEPTH);
        const breath = Math.sin(Math.PI * p);
        scale = Math.max(1, baseScale - (baseScale - dip) * breath * breath);
      }
      const f = followedAt(scale, t, { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) });
      return {
        scale,
        x: clampCenter(f.x, scale, view.x),
        y: clampCenter(f.y, scale, view.y),
        tiltX: lerp(z.tiltX, next.tiltX, e),
        tiltY: lerp(z.tiltY, next.tiltY, e)
      };
    }
    return { ...NEUTRAL };
  };

  const presetMs = Number.isFinite(options.presetMs) && (options.presetMs as number) > 0
    ? (options.presetMs as number)
    : dominantPreset(zooms);
  const kZoom = cameraZoomStiffness(presetMs);
  const kFocus = kZoom * FOCUS_STIFFNESS_RATIO;

  // Step the springs once, at a fixed rate, over the whole camera timeline.
  const t0 = zooms[0].start;
  const tEnd = Math.max(...zooms.map((z) => z.end)) + SETTLE_MS;
  const steps = Math.max(1, Math.ceil((tEnd - t0) / SPRING_STEP_MS));
  const table = Array.from({ length: 5 }, () => new Float64Array(steps + 1));
  const springs = [
    createSpring(kZoom, dampingFor(kZoom), NEUTRAL.scale),
    createSpring(kFocus, dampingFor(kFocus), NEUTRAL.x),
    createSpring(kFocus, dampingFor(kFocus), NEUTRAL.y),
    createSpring(kZoom, dampingFor(kZoom), 0),
    createSpring(kZoom, dampingFor(kZoom), 0)
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
      // The target never dips below 1.0x; this is the guarantee for the sprung value too.
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

import { ClickEvent, ZoomPill } from '../types/telemetry';
import { buildCameraPath, CameraPath } from './camera-path';

export interface SpringConfig {
  stiffness: number; // Spring tension (e.g. 180)
  damping: number;   // Friction / damping coefficient (e.g. 24 for critical damping)
  mass: number;      // Inertia (e.g. 1.0)
}

export interface CameraState {
  x: number;       // 0..1 normalised focal center X
  y: number;       // 0..1 normalised focal center Y
  scale: number;   // 1.0 = full frame, up to 2.8x zoom
  tiltX: number;   // Isometric degrees (-12 to +12)
  tiltY: number;   // Isometric degrees (-12 to +12)
}

export const DEFAULT_SPRING_CONFIG: SpringConfig = {
  stiffness: 170,
  damping: 26,
  mass: 1.0
};

export class SpringVariable {
  public current: number;
  public target: number;
  public velocity: number = 0;
  private config: SpringConfig;

  constructor(initialValue: number, config: SpringConfig = DEFAULT_SPRING_CONFIG) {
    this.current = initialValue;
    this.target = initialValue;
    this.config = config;
  }

  public update(dt: number): number {
    const clampedDt = Math.min(0.064, Math.max(0.001, Number.isFinite(dt) ? dt : 0.016));
    // Semi-implicit Euler integration for critically damped spring
    const displacement = this.current - this.target;
    const springForce = -this.config.stiffness * displacement;
    const dampingForce = -this.config.damping * this.velocity;
    const acceleration = (springForce + dampingForce) / (this.config.mass || 1.0);

    this.velocity += acceleration * clampedDt;
    this.current += this.velocity * clampedDt;

    if (!Number.isFinite(this.current) || !Number.isFinite(this.velocity)) {
      this.current = this.target;
      this.velocity = 0;
    }

    // Settle if negligible
    if (Math.abs(displacement) < 0.0001 && Math.abs(this.velocity) < 0.0001) {
      this.current = this.target;
      this.velocity = 0;
    }

    return this.current;
  }

  public setTarget(target: number): void {
    this.target = target;
  }

  public snapTo(value: number): void {
    this.current = value;
    this.target = value;
    this.velocity = 0;
  }
}

export class SpringCameraSolver {
  private xSpring: SpringVariable;
  private ySpring: SpringVariable;
  private scaleSpring: SpringVariable;
  private tiltXSpring: SpringVariable;
  private tiltYSpring: SpringVariable;

  constructor(initialState: CameraState = { x: 0.5, y: 0.5, scale: 1.0, tiltX: 0, tiltY: 0 }) {
    this.xSpring = new SpringVariable(initialState.x);
    this.ySpring = new SpringVariable(initialState.y);
    this.scaleSpring = new SpringVariable(initialState.scale);
    this.tiltXSpring = new SpringVariable(initialState.tiltX);
    this.tiltYSpring = new SpringVariable(initialState.tiltY);
  }

  public setTarget(state: Partial<CameraState>): void {
    if (state.x !== undefined) this.xSpring.setTarget(state.x);
    if (state.y !== undefined) this.ySpring.setTarget(state.y);
    if (state.scale !== undefined) this.scaleSpring.setTarget(state.scale);
    if (state.tiltX !== undefined) this.tiltXSpring.setTarget(state.tiltX);
    if (state.tiltY !== undefined) this.tiltYSpring.setTarget(state.tiltY);
  }

  public update(dt: number): CameraState {
    return {
      x: this.xSpring.update(dt),
      y: this.ySpring.update(dt),
      scale: this.scaleSpring.update(dt),
      tiltX: this.tiltXSpring.update(dt),
      tiltY: this.tiltYSpring.update(dt)
    };
  }

  public getState(): CameraState {
    return {
      x: this.xSpring.current,
      y: this.ySpring.current,
      scale: this.scaleSpring.current,
      tiltX: this.tiltXSpring.current,
      tiltY: this.tiltYSpring.current
    };
  }

  public snapTo(state: CameraState): void {
    this.xSpring.snapTo(state.x);
    this.ySpring.snapTo(state.y);
    this.scaleSpring.snapTo(state.scale);
    this.tiltXSpring.snapTo(state.tiltX);
    this.tiltYSpring.snapTo(state.tiltY);
  }
}

// Analytical Cinematic Camera State Solver
// A pure function of time: it evaluates the deterministic schedule built by
// buildCameraPath (camera-path.ts). The exporters and the preview build the path
// ONCE per render session with the real smoothed cursor path; this convenience
// form takes a single cursor position (used as a constant) and remembers the
// last path it built, so repeated calls with the same pills stay cheap.
let lastWrapperPath: { pills: ZoomPill[]; key: string; path: CameraPath } | null = null;

export function computeCinematicCameraState(
  timeMs: number,
  pills: ZoomPill[],
  cursor?: { x: number; y: number; speed?: number },
  viewportWidth = 1920,
  viewportHeight = 1080,
  followCursor = true
): CameraState {
  const key = `${followCursor}|${cursor?.x}|${cursor?.y}|${viewportWidth}|${viewportHeight}`;
  if (!lastWrapperPath || lastWrapperPath.pills !== pills || lastWrapperPath.key !== key) {
    lastWrapperPath = {
      pills,
      key,
      path: buildCameraPath(pills, {
        followCursor,
        cursorAt: cursor ? () => cursor : undefined,
        viewportWidth,
        viewportHeight
      })
    };
  }
  return lastWrapperPath.path.at(timeMs);
}

export function calculateIsometricTilt(targetX: number, targetY: number, scale: number): { tiltX: number; tiltY: number } {
  if (scale <= 1.15) {
    return { tiltX: 0, tiltY: 0 };
  }

  // Normalised center offset from (0.5, 0.5) in range [-0.5, 0.5]
  const dx = targetX - 0.5;
  const dy = targetY - 0.5;

  // Max 8 degrees Y tilt, 5 degrees X tilt
  const tiltY = -dx * 16; // Looking right -> tilt surface slightly left
  const tiltX = dy * 10;  // Looking bottom -> tilt surface slightly back

  return {
    tiltX: Math.max(-8, Math.min(8, tiltX)),
    tiltY: Math.max(-10, Math.min(10, tiltY))
  };
}

// ---------------------------------------------------------------------------
// Auto-zoom: clicks are clustered into SHOTS. A burst of clicks in one area is
// one zoom; inside it the camera pans from click to click and only returns to
// 1.0x after a real pause.
//
//   1. CLUSTER  a new shot starts when the gap from the previous click is more
//               than IDLE_GAP_MS, or the click is more than NEW_SHOT_DIST from
//               the shot's current focus (its latest click).
//   2. SEGMENT  start = first click - LEAD_IN_MS, end = last click + HOLD_OUT_MS,
//               one focus keyframe per click at click.t - LEAD_IN_MS.
//   3. MERGE    overlapping segments become one (keyframes concatenated).
//   4. NOISE    a segment shorter than MIN_SHOT_MS is dropped.
// ---------------------------------------------------------------------------
export const AUTO_ZOOM_DEPTHS = [1.25, 1.5, 2, 2.5] as const;
export const AUTO_ZOOM_DEFAULT_DEPTH = 1.5;

/** Every tunable of the auto-zoom clustering, in one place. */
export const AUTO_ZOOM_CONFIG = {
  /** A gap longer than this between two clicks ends the shot. */
  IDLE_GAP_MS: 1800,
  /** A click farther than this (normalised 0..1 distance) from the shot's focus starts a new shot. */
  NEW_SHOT_DIST: 0.35,
  /** The camera starts moving this long before a click (zoom ramp-in and pan lead). */
  LEAD_IN_MS: 400,
  /** The shot holds this long after its last click before the zoom releases. */
  HOLD_OUT_MS: 900,
  /** A shot shorter than this (after lead-in and hold-out) is noise and dropped. */
  MIN_SHOT_MS: 700,
  /** Zoom depth of a shot. */
  INTENSITY: AUTO_ZOOM_DEFAULT_DEPTH
};
export type AutoZoomConfig = typeof AUTO_ZOOM_CONFIG;

/**
 * Largest scale that still looks sharp for a recording of this real pixel
 * width. Only used to warn in the editor; auto zooms are never limited by it.
 * Unknown width = no limit.
 */
export function autoZoomScaleCap(sourcePixelWidth?: number): number {
  if (!Number.isFinite(sourcePixelWidth) || (sourcePixelWidth as number) <= 0) return Infinity;
  const w = sourcePixelWidth as number;
  if (w <= 1280) return 1.5;
  if (w <= 1920) return 1.75;
  if (w <= 2560) return 2.1;
  return 2.5;
}

/**
 * The real pixel width of the recorded picture: the capture track's width, else the
 * decoded video's, else the page's CSS width times its pixel ratio. Undefined when
 * nothing is known.
 */
export function resolveSourcePixelWidth(
  trackWidth?: number,
  videoWidth?: number,
  metadata?: { width?: number; devicePixelRatio?: number }
): number | undefined {
  const positive = (v?: number) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : undefined);
  const css = positive(metadata?.width);
  return positive(trackWidth) ?? positive(videoWidth) ?? (css ? Math.round(css * (positive(metadata?.devicePixelRatio) ?? 1)) : undefined);
}

export interface AutoZoomOptions {
  /** Zoom depth of every shot (default AUTO_ZOOM_CONFIG.INTENSITY). */
  depth?: number;
  /** Lead-in / ramp length in ms (default AUTO_ZOOM_CONFIG.LEAD_IN_MS). */
  transitionMs?: number;
  /** Overrides of the clustering constants. */
  config?: Partial<AutoZoomConfig>;
}

/**
 * One zoom segment per shot (cluster of clicks), each with one focus keyframe per
 * click. Clicks are normalized (0..1) or, in older recordings, pixels of the viewport.
 */
export function generateAutoZoomPills(
  clicks: ClickEvent[],
  videoDurationMs: number,
  viewportWidth: number,
  viewportHeight: number,
  options: AutoZoomOptions = {}
): ZoomPill[] {
  if (!Number.isFinite(videoDurationMs) || videoDurationMs <= 0) return [];
  const cfg: AutoZoomConfig = { ...AUTO_ZOOM_CONFIG, ...(options.config || {}) };
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1920;
  const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1080;
  const depth = Math.max(1.05, Math.min(2.8, Number.isFinite(options.depth) ? (options.depth as number) : cfg.INTENSITY));
  const leadIn = Number.isFinite(options.transitionMs) && (options.transitionMs as number) > 0
    ? (options.transitionMs as number)
    : cfg.LEAD_IN_MS;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const norm = (v: number, size: number) => clamp01(v >= 0 && v <= 1 ? v : v / size);

  const sorted = clicks
    .filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t <= videoDurationMs && Number.isFinite(c.x) && Number.isFinite(c.y))
    .map((c) => ({ t: c.t, x: norm(c.x, vw), y: norm(c.y, vh), label: c.targetText && c.targetText !== '[hidden input]' ? c.targetText : '' }))
    .sort((a, b) => a.t - b.t);

  // 1. CLUSTER
  type Click = (typeof sorted)[number];
  const clusters: Click[][] = [];
  for (const c of sorted) {
    const current = clusters[clusters.length - 1];
    const prev = current?.[current.length - 1];
    if (!current || !prev || c.t - prev.t > cfg.IDLE_GAP_MS || Math.hypot(c.x - prev.x, c.y - prev.y) > cfg.NEW_SHOT_DIST) {
      clusters.push([c]);
    } else {
      current.push(c);
    }
  }

  // 2. SEGMENT
  interface Segment { start: number; end: number; clicks: Click[] }
  const segments: Segment[] = clusters.map((cl) => ({
    start: Math.max(0, cl[0].t - leadIn),
    end: Math.min(videoDurationMs, cl[cl.length - 1].t + cfg.HOLD_OUT_MS),
    clicks: cl
  }));

  // 3. MERGE overlaps (never emit overlapping segments)
  const merged: Segment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.end > seg.start) {
      last.end = Math.max(last.end, seg.end);
      last.clicks = last.clicks.concat(seg.clicks);
    } else {
      merged.push({ ...seg, clicks: [...seg.clicks] });
    }
  }

  // 4. DROP NOISE
  const pills: ZoomPill[] = [];
  merged.forEach((seg, i) => {
    if (seg.end - seg.start < cfg.MIN_SHOT_MS || seg.end <= seg.start) return;
    const first = seg.clicks[0];
    const named = seg.clicks.find((c) => c.label);
    const count = seg.clicks.length;
    const label = named
      ? `Click "${named.label.slice(0, 20)}"${count > 1 ? ` +${count - 1}` : ''}`
      : count > 1 ? `${count} clicks` : 'Click';
    pills.push({
      id: `zoom_${Math.round(first.t)}_${i}`,
      startTime: seg.start,
      endTime: seg.end,
      targetX: first.x,
      targetY: first.y,
      targetScale: depth,
      tiltX: 0,
      tiltY: 0,
      spotlight: false,
      label,
      autoGenerated: true,
      transitionDuration: leadIn,
      keyframes: seg.clicks.map((c) => ({ t: Math.max(seg.start, c.t - leadIn), x: c.x, y: c.y }))
    });
  });
  return pills;
}

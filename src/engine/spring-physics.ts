import { ClickEvent, ZoomPill } from '../types/telemetry';
import { buildCameraPath, CameraPath, DEFAULT_TRANSITION_MS } from './camera-path';

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
// Auto-zoom (ScreenSmooth-style)
//
//   - Every click is a zoom, centred on the click point. Only a re-click on the same
//     spot while the camera is still moving (a double-click) is the same action.
//   - Every auto zoom has the same depth (default 1.5x).
//   - The camera is fully zoomed in as the click lands.
//   - A click within 3 s of the previous one keeps the zoom and pans to it.
//   - 2.5 s after the last click the camera zooms out, as fast as it zoomed in.
// ---------------------------------------------------------------------------
export const AUTO_ZOOM_DEPTHS = [1.25, 1.5, 2, 2.5] as const;
export const AUTO_ZOOM_DEFAULT_DEPTH = 1.5;
/** Hold after the last click before zooming out. */
export const AUTO_ZOOM_HOLD_MS = 2500;
/** A click this soon after the previous one pans the zoom instead of zooming out and in again. */
export const AUTO_ZOOM_CHAIN_MS = 3000;
/** A quick re-click this close (CSS px of the page) to the previous click is the same action. */
export const AUTO_ZOOM_SAME_SPOT_PX = 40;

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
  /** Zoom depth of every auto zoom (default 1.5x). */
  depth?: number;
  /** How long the camera takes to zoom in, pan and zoom out (default DEFAULT_TRANSITION_MS). */
  transitionMs?: number;
}

/** One zoom per click. Clicks are normalized (0..1) or, in older recordings, pixels of the viewport. */
export function generateAutoZoomPills(
  clicks: ClickEvent[],
  videoDurationMs: number,
  viewportWidth: number,
  viewportHeight: number,
  options: AutoZoomOptions = {}
): ZoomPill[] {
  if (!Number.isFinite(videoDurationMs) || videoDurationMs <= 0) return [];
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1920;
  const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1080;
  const depth = Math.max(1.05, Math.min(2.8, Number.isFinite(options.depth) ? (options.depth as number) : AUTO_ZOOM_DEFAULT_DEPTH));
  const transition = Number.isFinite(options.transitionMs) && (options.transitionMs as number) > 0
    ? (options.transitionMs as number)
    : DEFAULT_TRANSITION_MS;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const norm = (v: number, size: number) => clamp01(v >= 0 && v <= 1 ? v : v / size);

  const sorted = clicks
    .filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t <= videoDurationMs && Number.isFinite(c.x) && Number.isFinite(c.y))
    .sort((a, b) => a.t - b.t);

  // A re-click on the same spot while the camera is still moving to it (a
  // double-click) is the same action. A click anywhere else gets its own zoom.
  interface Action { t: number; lastT: number; x: number; y: number; label: string }
  const actions: Action[] = [];
  for (const c of sorted) {
    const last = actions[actions.length - 1];
    const x = norm(c.x, vw);
    const y = norm(c.y, vh);
    const sameSpot = last && Math.hypot((x - last.x) * vw, (y - last.y) * vh) <= AUTO_ZOOM_SAME_SPOT_PX;
    if (last && sameSpot && c.t - last.lastT < transition + 150) {
      last.lastT = c.t;
      continue;
    }
    const name = c.targetText && c.targetText !== '[hidden input]' ? c.targetText : '';
    actions.push({
      t: c.t,
      lastT: c.t,
      x,
      y,
      label: name ? `Click "${name.slice(0, 20)}"` : 'Click'
    });
  }

  const pills: ZoomPill[] = [];
  /** End of the previous zoom when it hands over to this one (chained), else -Infinity. */
  let handOver = -Infinity;
  actions.forEach((a, i) => {
    const next = actions[i + 1];
    // Fully zoomed as the click lands; after a hand-over the camera pans over from
    // the previous click (later than the click when the clicks come faster than a move).
    const startTime = Math.max(0, a.t - transition, handOver);
    // The next click is close: hand over to it (the camera pans, no zoom-out). Never
    // before this click itself: the camera reaches every click.
    const chained = Boolean(next && next.t - a.lastT <= AUTO_ZOOM_CHAIN_MS);
    const endTime = chained
      ? Math.max(a.lastT, next.t - transition)
      : a.lastT + AUTO_ZOOM_HOLD_MS;
    const end = Math.min(videoDurationMs, endTime);
    handOver = chained ? end : -Infinity;
    if (end <= startTime) return;
    pills.push({
      id: `zoom_${Math.round(a.t)}_${i}`,
      startTime,
      endTime: end,
      targetX: a.x,
      targetY: a.y,
      targetScale: depth,
      tiltX: 0,
      tiltY: 0,
      spotlight: false,
      label: a.label,
      autoGenerated: true,
      transitionDuration: transition
    });
  });
  return pills;
}

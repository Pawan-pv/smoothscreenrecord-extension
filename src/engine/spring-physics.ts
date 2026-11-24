import { ClickEvent, InputFocusEvent, ZoomPill, BoundingBox, ScrollEvent, TypingSession, MousePoint, KeystrokeEvent, VisibilityEvent } from '../types/telemetry';
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
// Auto-zoom policy (locked parameters)
// ---------------------------------------------------------------------------
export const AUTO_ZOOM = {
  /** The camera should be on target as the click lands. */
  PRE_ROLL_CLICK_MS: 300,
  PRE_ROLL_TYPING_MS: 350,
  /** Hold after the last click / typing before zooming out. */
  COOLDOWN_MS: 1800,
  MIN_PILL_MS: 1600,
  /** Default scale of a typing zoom (before the resolution cap). */
  TYPING_SCALE: 1.8,
  /** Extra zoom for a double-click. */
  DOUBLE_CLICK_BOOST: 0.15,
  /** Typing within this normalized distance of an active zoom extends it instead of starting another. */
  TYPING_EXTEND_DISTANCE: 0.25,
  /** ...and this long after the zoom ends still counts as "near". */
  TYPING_EXTEND_GRACE_MS: 600,
  /** Misclick filter: all three must hold. */
  MISCLICK_MOVE_PX: 120,
  MISCLICK_MOVE_WINDOW_MS: 250,
  MISCLICK_KEY_WINDOW_MS: 500,
  /** Rapid cursor jump away from the zoom focus releases the zoom. */
  JUMP_DISTANCE: 0.45,
  JUMP_TRAVEL: 0.3,
  JUMP_TRAVEL_WINDOW_MS: 300,
  JUMP_STAY_MS: 400
} as const;

/**
 * Largest scale an AUTO-generated zoom may use for a recording of this real pixel
 * width: zooming further than the source resolution allows only shows blur.
 * Manual zooms are not limited. Unknown width = no cap.
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
 * nothing is known (no cap is applied then).
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
  /** The cursor path (normalized, or legacy pixels): misclick filter and the rapid-jump release. */
  mousePoints?: MousePoint[];
  keystrokes?: KeystrokeEvent[];
  /** The recorded tab hidden / visible: a hold is closed when the user leaves it. */
  visibilityEvents?: VisibilityEvent[];
  /** Real pixel width of the recorded video; caps auto-generated zoom scales. */
  sourcePixelWidth?: number;
}

// Smart Click Clustering & Auto-Zoom Pills Generator
// Clusters clicks within 320px and 3.8 seconds into a single continuous zoom pill
export function generateAutoZoomPills(
  clicks: ClickEvent[],
  inputEvents: InputFocusEvent[],
  videoDurationMs: number,
  viewportWidth: number,
  viewportHeight: number,
  scrollEvents?: ScrollEvent[],
  typingSessions?: TypingSession[],
  options: AutoZoomOptions = {}
): ZoomPill[] {
  const pills: ZoomPill[] = [];
  const CLUSTER_DISTANCE_PX = 320;
  const CLUSTER_TIME_WINDOW_MS = 3800;
  const scaleCap = autoZoomScaleCap(options.sourcePixelWidth);

  // A pill is a seek target in the exporter: it must live inside the
  // recording. Without a real timeline (and a real viewport to normalize
  // against) there is nothing sensible to generate.
  if (!Number.isFinite(videoDurationMs) || videoDurationMs <= 0) return [];
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return [];
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return [];

  const fitsRecording = (t: number) => Number.isFinite(t) && t >= 0 && t <= videoDurationMs;
  const clampNorm = (v: number) => (Number.isFinite(v) ? Math.max(0.12, Math.min(0.88, v)) : 0.5);
  const finiteBounds = (b?: BoundingBox) =>
    Boolean(b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height));
  const toNormX = (v: number) => (v <= 1.0 ? v : v / viewportWidth);
  const toNormY = (v: number) => (v <= 1.0 ? v : v / viewportHeight);

  const path = [...(options.mousePoints || [])]
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
  /** Index of the last cursor sample at or before t (-1 when none). */
  const sampleIndexAt = (t: number) => {
    let lo = 0;
    let hi = path.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (path[mid].t <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found;
  };

  /**
   * A click that is noise: ONLY when all three hold - the target is plain page
   * content (not something a user operates), the cursor leaves by more than
   * 120 px within 250 ms, and nothing was typed around it. Clicks recorded
   * without the interactive flag (older recordings) are never dropped.
   */
  const isMisclick = (c: ClickEvent): boolean => {
    if (c.interactive !== false) return false;
    if (path.length === 0) return false;
    const typedAround =
      (options.keystrokes || []).some((k) => Math.abs(k.t - c.t) <= AUTO_ZOOM.MISCLICK_KEY_WINDOW_MS) ||
      (typingSessions || []).some((s) => s.t <= c.t + AUTO_ZOOM.MISCLICK_KEY_WINDOW_MS && s.endT >= c.t - AUTO_ZOOM.MISCLICK_KEY_WINDOW_MS) ||
      inputEvents.some((ev) => ev.type === 'type' && Math.abs(ev.t - c.t) <= AUTO_ZOOM.MISCLICK_KEY_WINDOW_MS);
    if (typedAround) return false;
    const cx = toNormX(c.x) * viewportWidth;
    const cy = toNormY(c.y) * viewportHeight;
    for (let i = sampleIndexAt(c.t) + 1; i < path.length && path[i].t <= c.t + AUTO_ZOOM.MISCLICK_MOVE_WINDOW_MS; i++) {
      const px = toNormX(path[i].x) * viewportWidth;
      const py = toNormY(path[i].y) * viewportHeight;
      if (Math.hypot(px - cx, py - cy) > AUTO_ZOOM.MISCLICK_MOVE_PX) return true;
    }
    return false;
  };

  // Filter clicks that have coordinates and happened inside the recording
  const sortedClicks = clicks
    .filter((c) => fitsRecording(c.t) && Number.isFinite(c.x) && Number.isFinite(c.y))
    .filter((c) => !isMisclick(c))
    .sort((a, b) => a.t - b.t);

  let currentCluster: ClickEvent[] = [];

  for (let i = 0; i < sortedClicks.length; i++) {
    const click = sortedClicks[i];

    if (currentCluster.length === 0) {
      currentCluster.push(click);
      continue;
    }

    const firstClick = currentCluster[0];
    const prevClick = currentCluster[currentCluster.length - 1];

    // Coordinate-normalization aware distance calculation (handles both 0..1 and legacy pixels)
    const clickPxX = click.x <= 1.0 ? click.x * viewportWidth : click.x;
    const clickPxY = click.y <= 1.0 ? click.y * viewportHeight : click.y;
    const firstPxX = firstClick.x <= 1.0 ? firstClick.x * viewportWidth : firstClick.x;
    const firstPxY = firstClick.y <= 1.0 ? firstClick.y * viewportHeight : firstClick.y;

    const distFromFirst = Math.hypot(clickPxX - firstPxX, clickPxY - firstPxY);
    const timeDelta = click.t - prevClick.t;

    // Coalesce rapid clicks within 400ms into a single cluster, or standard temporal/spatial cluster
    if (timeDelta <= 400 || (distFromFirst <= CLUSTER_DISTANCE_PX && timeDelta <= CLUSTER_TIME_WINDOW_MS)) {
      currentCluster.push(click);
    } else {
      // Flush current cluster into a zoom pill
      flushClusterToPill(currentCluster);
      currentCluster = [click];
    }
  }

  if (currentCluster.length > 0) {
    flushClusterToPill(currentCluster);
  }

  // ---- Typing: extend the zoom you are already in, or start a clean typing zoom ----
  interface TypingSpan { t: number; endT: number; x: number; y: number; known: boolean; label: string }
  const spans: TypingSpan[] = [];
  const boundsCenter = (b: BoundingBox) => {
    const bX = b.x <= 1.0 ? b.x * viewportWidth : b.x;
    const bY = b.y <= 1.0 ? b.y * viewportHeight : b.y;
    const bW = b.width <= 1.0 ? b.width * viewportWidth : b.width;
    const bH = b.height <= 1.0 ? b.height * viewportHeight : b.height;
    return { x: clampNorm((bX + bW / 2) / viewportWidth), y: clampNorm((bY + bH / 2) / viewportHeight) };
  };

  if (typingSessions && typingSessions.length > 0) {
    for (const ts of typingSessions) {
      if (!fitsRecording(ts.t)) continue;
      // Find matching input element bounds from inputEvents near this session
      const matchingEv = inputEvents.find(
        (ev) => ev.t >= ts.t - 500 && ev.t <= ts.endT + 500 && finiteBounds(ev.bounds)
      ) || inputEvents.find((ev) => finiteBounds(ev.bounds));
      const c = matchingEv && matchingEv.bounds ? boundsCenter(matchingEv.bounds) : { x: 0.5, y: 0.5 };
      spans.push({
        t: ts.t,
        endT: ts.endT,
        x: c.x,
        y: c.y,
        known: Boolean(matchingEv && matchingEv.bounds),
        label: ts.targetLabel && ts.targetLabel !== '[hidden input]' ? `Type "${ts.targetLabel.slice(0, 20)}"` : 'Typing Focus'
      });
    }
  } else {
    // Group raw input events into contiguous spans so typing a sentence creates one steady hold
    const validInputs = inputEvents
      .filter((ev) => (ev.type === 'focus' || ev.type === 'type') && fitsRecording(ev.t) && finiteBounds(ev.bounds))
      .sort((a, b) => a.t - b.t);

    const inputGroups: InputFocusEvent[][] = [];
    for (const ev of validInputs) {
      if (inputGroups.length === 0) {
        inputGroups.push([ev]);
        continue;
      }
      const currentGroup = inputGroups[inputGroups.length - 1];
      const prevEv = currentGroup[currentGroup.length - 1];
      if (ev.t - prevEv.t <= 1500) {
        currentGroup.push(ev);
      } else {
        inputGroups.push([ev]);
      }
    }
    for (const group of inputGroups) {
      const c = boundsCenter(group[0].bounds);
      spans.push({ t: group[0].t, endT: group[group.length - 1].t, x: c.x, y: c.y, known: true, label: 'Typing Focus' });
    }
  }

  for (const span of spans.sort((a, b) => a.t - b.t)) {
    // A zoom that is on screen when the typing starts (or just ended) and is
    // looking at the same part of the screen: keep it, and hold it for the typing.
    const host = pills.find((p) =>
      span.t >= p.startTime &&
      span.t <= p.endTime + AUTO_ZOOM.TYPING_EXTEND_GRACE_MS &&
      (!span.known || Math.hypot(span.x - p.targetX, span.y - p.targetY) <= AUTO_ZOOM.TYPING_EXTEND_DISTANCE)
    );
    if (host) {
      host.endTime = Math.min(videoDurationMs, Math.max(host.endTime, span.endT + AUTO_ZOOM.COOLDOWN_MS));
      continue;
    }

    const scale = Math.min(AUTO_ZOOM.TYPING_SCALE, scaleCap);
    const startTime = Math.max(0, span.t - AUTO_ZOOM.PRE_ROLL_TYPING_MS);
    const endTime = Math.min(videoDurationMs, Math.max(startTime + AUTO_ZOOM.MIN_PILL_MS, span.endT + AUTO_ZOOM.COOLDOWN_MS));
    const tilt = calculateIsometricTilt(span.x, span.y, scale);
    pills.push({
      id: 'zoom_input_' + Math.round(startTime),
      startTime,
      endTime,
      targetX: span.x,
      targetY: span.y,
      targetScale: scale,
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      spotlight: true,
      label: span.label,
      autoGenerated: true
    });
  }

  function flushClusterToPill(cluster: ClickEvent[]) {
    if (cluster.length === 0) return;

    // Use parent container bounding box if available from DOM climbing
    const primary = cluster[0];
    let focalX: number;
    let focalY: number;
    let scale = 1.6;

    const clickPxX = primary.x <= 1.0 ? primary.x * viewportWidth : primary.x;
    const clickPxY = primary.y <= 1.0 ? primary.y * viewportHeight : primary.y;

    if (finiteBounds(primary.containerBounds) && primary.containerBounds!.width > 50) {
      const cb = primary.containerBounds!;
      const cbX = cb.x <= 1.0 ? cb.x * viewportWidth : cb.x;
      const cbY = cb.y <= 1.0 ? cb.y * viewportHeight : cb.y;
      const cbW = cb.width <= 1.0 ? cb.width * viewportWidth : cb.width;
      const cbH = cb.height <= 1.0 ? cb.height * viewportHeight : cb.height;

      const containerCenterX = cbX + cbW / 2;
      const containerCenterY = cbY + cbH / 2;
      const clickToCenterDist = Math.hypot(clickPxX - containerCenterX, clickPxY - containerCenterY);

      // Smart Container Guard: if container exceeds 45% viewport width, 50% viewport height,
      // or click-to-center distance > 250 px, blend focal target as 70% click + 30% container center
      const isWideOrTall = cbW > viewportWidth * 0.45 || cbH > viewportHeight * 0.50;
      const isDistantFromCenter = clickToCenterDist > 250;

      if (isWideOrTall || isDistantFromCenter) {
        focalX = 0.7 * clickPxX + 0.3 * containerCenterX;
        focalY = 0.7 * clickPxY + 0.3 * containerCenterY;
      } else {
        focalX = containerCenterX;
        focalY = containerCenterY;
      }

      // Smart zoom scaling based on container size
      const coverage = cbW / viewportWidth;
      if (coverage > 0.6) {
        scale = 1.35; // Large modal/form: gentle zoom
      } else if (coverage < 0.2) {
        scale = 2.1;  // Small button or dropdown: punchy zoom
      } else {
        scale = 1.7;  // Medium card/section
      }
    } else {
      // Average cluster positions (handles both 0..1 and legacy pixels)
      const avgX = cluster.reduce((sum, c) => sum + (c.x <= 1.0 ? c.x * viewportWidth : c.x), 0) / cluster.length;
      const avgY = cluster.reduce((sum, c) => sum + (c.y <= 1.0 ? c.y * viewportHeight : c.y), 0) / cluster.length;
      focalX = avgX;
      focalY = avgY;
    }

    // A double-click is a deliberate emphasis: a touch tighter.
    if (cluster.some((c) => (c.clickCount ?? 1) >= 2)) scale += AUTO_ZOOM.DOUBLE_CLICK_BOOST;
    // Never zoom past what the source resolution can show sharply.
    scale = Math.min(scale, scaleCap);

    const normX = clampNorm(focalX / viewportWidth);
    const normY = clampNorm(focalY / viewportHeight);

    // Pre-roll: the camera is on target as the click lands.
    const startTime = Math.max(0, primary.t - AUTO_ZOOM.PRE_ROLL_CLICK_MS);
    const lastClickTime = cluster[cluster.length - 1].t;
    // The pill must never outlive the recording, but it also must never be
    // collapsed by a bogus duration: clamp against the real video duration.
    const hold = Math.max(lastClickTime + AUTO_ZOOM.COOLDOWN_MS, startTime + AUTO_ZOOM.MIN_PILL_MS);
    const endTime = Math.min(videoDurationMs, Math.max(hold, startTime + 400));

    const tilt = calculateIsometricTilt(normX, normY, scale);

    pills.push({
      id: 'zoom_' + Math.round(startTime),
      startTime,
      endTime,
      targetX: normX,
      targetY: normY,
      targetScale: scale,
      tiltX: tilt.tiltX,
      tiltY: tilt.tiltY,
      spotlight: cluster.length > 2,
      label: primary.targetText ? `Click "${primary.targetText.slice(0, 20)}"` : 'Action Zoom',
      autoGenerated: true
    });
  }

  // ---- Early release: leaving the tab, or a rapid jump of the cursor away ----
  const hidden = (options.visibilityEvents || [])
    .filter((v) => Number.isFinite(v.t))
    .sort((a, b) => a.t - b.t);
  const hiddenIntervals: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < hidden.length; i++) {
    if (hidden[i].state !== 'hidden') continue;
    const back = hidden.slice(i + 1).find((v) => v.state === 'visible');
    hiddenIntervals.push({ from: hidden[i].t, to: back ? back.t : Infinity });
  }

  const releaseOnJump = (p: ZoomPill): number | null => {
    if (path.length === 0) return null;
    const arrive = p.startTime + DEFAULT_TRANSITION_MS;
    const dist = (i: number) => Math.hypot(toNormX(path[i].x) - p.targetX, toNormY(path[i].y) - p.targetY);
    for (let i = Math.max(0, sampleIndexAt(arrive)); i < path.length && path[i].t <= p.endTime; i++) {
      if (path[i].t < arrive || dist(i) <= AUTO_ZOOM.JUMP_DISTANCE) continue;
      // Rapid: it travelled a long way in the last 300 ms.
      const before = sampleIndexAt(path[i].t - AUTO_ZOOM.JUMP_TRAVEL_WINDOW_MS);
      if (before < 0) continue;
      const travel = Math.hypot(toNormX(path[i].x) - toNormX(path[before].x), toNormY(path[i].y) - toNormY(path[before].y));
      if (travel < AUTO_ZOOM.JUMP_TRAVEL) continue;
      // And it stays away.
      let stays = true;
      for (let j = i; j < path.length && path[j].t <= path[i].t + AUTO_ZOOM.JUMP_STAY_MS; j++) {
        if (dist(j) <= AUTO_ZOOM.JUMP_DISTANCE) { stays = false; break; }
      }
      const lastSampleT = path[path.length - 1].t;
      if (stays && lastSampleT >= path[i].t + AUTO_ZOOM.JUMP_STAY_MS) return path[i].t + AUTO_ZOOM.JUMP_STAY_MS;
    }
    return null;
  };

  const kept: ZoomPill[] = [];
  for (const p of pills) {
    // A zoom that would start while the tab is hidden never happened on screen.
    if (hiddenIntervals.some((h) => p.startTime >= h.from && p.startTime < h.to)) continue;

    const jump = releaseOnJump(p);
    if (jump !== null && jump < p.endTime) {
      p.endTime = Math.max(jump, p.startTime + AUTO_ZOOM.MIN_PILL_MS);
    }
    for (const h of hiddenIntervals) {
      if (h.from > p.startTime && h.from < p.endTime) p.endTime = Math.max(p.startTime + 400, h.from);
    }
    p.endTime = Math.min(p.endTime, videoDurationMs);
    if (p.endTime > p.startTime) kept.push(p);
  }

  return settleAndMergePills(kept, videoDurationMs, scrollEvents);
}

/**
 * Eliminates overlapping zoom pills by enforcing a minimum settle hold
 * (MIN_SETTLE_MS = 1500ms) on each focal target, merging spatially close actions
 * (distance < 0.25), and bridging small inter-pill gaps (< 800ms) so the camera
 * does not dip to neutral scale (1.0) between adjacent actions.
 */
export function settleAndMergePills(
  rawPills: ZoomPill[],
  videoDurationMs: number,
  scrollEvents?: ScrollEvent[]
): ZoomPill[] {
  if (rawPills.length === 0) return [];

  // Scroll-out trigger: if cumulative scroll exceeds 200 px during an active zoom hold,
  // clamp endTime (keeping >= 600 ms minimum pill length) to ease smoothly back to 1.0x
  if (scrollEvents && scrollEvents.length > 0) {
    const sortedScroll = scrollEvents
      .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.scrollX) && Number.isFinite(s.scrollY))
      .sort((a, b) => a.t - b.t);

    for (const p of rawPills) {
      const eventsInPill = sortedScroll.filter((s) => s.t >= p.startTime && s.t <= p.endTime);
      if (eventsInPill.length > 0) {
        const priorScroll = sortedScroll.slice().reverse().find((s) => s.t <= p.startTime);
        let lastX = priorScroll ? priorScroll.scrollX : eventsInPill[0].scrollX;
        let lastY = priorScroll ? priorScroll.scrollY : eventsInPill[0].scrollY;
        let cumScroll = 0;

        for (const sev of eventsInPill) {
          cumScroll += Math.hypot(sev.scrollX - lastX, sev.scrollY - lastY);
          lastX = sev.scrollX;
          lastY = sev.scrollY;
          if (cumScroll >= 200) {
            p.endTime = Math.min(p.endTime, Math.max(p.startTime + 600, sev.t));
            break;
          }
        }
      }
    }
  }

  if (rawPills.length <= 1) return rawPills.filter((p) => p.endTime > p.startTime);

  const MIN_SETTLE_MS = 1500;
  const BRIDGE_GAP_MS = 800;
  const SPATIAL_MERGE_DIST = 0.25;

  // Clone and sort chronologically
  const sorted = rawPills
    .map((p) => ({ ...p }))
    .sort((a, b) => a.startTime - b.startTime);

  const result: ZoomPill[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];

    if (result.length === 0) {
      result.push(cur);
      continue;
    }

    const prev = result[result.length - 1];

    if (cur.startTime < prev.endTime) {
      // Overlapping pills detected
      const dist = Math.hypot(cur.targetX - prev.targetX, cur.targetY - prev.targetY);

      if (dist < SPATIAL_MERGE_DIST) {
        // Spatially close targets: coalesce into a single continuous zoom pill
        prev.endTime = Math.max(prev.endTime, cur.endTime);
        prev.endTime = Math.min(videoDurationMs, prev.endTime);
        continue;
      } else {
        // Distinct focal targets: enforce minimum settle hold on previous pill
        const minPrevEnd = prev.startTime + MIN_SETTLE_MS;
        if (cur.startTime < minPrevEnd) {
          cur.startTime = Math.min(videoDurationMs, minPrevEnd);
          cur.endTime = Math.max(cur.endTime, cur.startTime + MIN_SETTLE_MS);
        }
        // Direct pill-to-pill transition without overlap
        prev.endTime = cur.startTime;
      }
    } else {
      // No overlap: bridge small inter-pill gaps to prevent scale dip to 1.0
      const gap = cur.startTime - prev.endTime;
      if (gap > 0 && gap < BRIDGE_GAP_MS) {
        prev.endTime = cur.startTime;
      }
    }

    prev.endTime = Math.min(videoDurationMs, prev.endTime);
    cur.endTime = Math.min(videoDurationMs, cur.endTime);

    if (cur.startTime < videoDurationMs && cur.endTime > cur.startTime) {
      result.push(cur);
    }
  }

  // Final enforcement pass ensuring strictly zero overlaps and bridging small gaps
  for (let i = 0; i < result.length - 1; i++) {
    const p1 = result[i];
    const p2 = result[i + 1];
    if (p1.endTime > p2.startTime) {
      p1.endTime = p2.startTime;
    } else if (p2.startTime - p1.endTime > 0 && p2.startTime - p1.endTime < BRIDGE_GAP_MS) {
      p1.endTime = p2.startTime;
    }
  }

  return result.filter((p) => p.endTime > p.startTime);
}

import { ClickEvent, InputFocusEvent, ZoomPill, BoundingBox, ScrollEvent, TypingSession } from '../types/telemetry';

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
// Evaluates continuous, deterministic, and silky-smooth camera framing for any timestamp
export function computeCinematicCameraState(
  timeMs: number,
  pills: ZoomPill[],
  cursor?: { x: number; y: number; speed?: number },
  viewportWidth = 1920,
  viewportHeight = 1080,
  followCursor = true
): CameraState {
  const TRANSITION_MS = 380; // 380ms smooth spring-like ease (>= 90% settled by 320ms)

  // Ken Perlin's quintic smootherstep curve: 6t^5 - 15t^4 + 10t^3 (zero 1st & 2nd derivative)
  const smootherStep = (t: number) => {
    const c = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    return c * c * c * (c * (c * 6 - 15) + 10);
  };

  // Find active pill
  let activePill: ZoomPill | undefined;
  let activePillIndex = -1;
  for (let i = 0; i < pills.length; i++) {
    if (timeMs >= pills[i].startTime && timeMs <= pills[i].endTime) {
      activePill = pills[i];
      activePillIndex = i;
      break;
    }
  }

  // Normalized cursor coordinates: support both normalized (0..1) and legacy pixel coordinates
  let normCursorX = 0.5;
  let normCursorY = 0.5;
  const hasCursor = Boolean(cursor && viewportWidth > 0 && viewportHeight > 0);
  if (hasCursor && cursor) {
    const rawX = cursor.x <= 1.0 ? cursor.x : cursor.x / viewportWidth;
    const rawY = cursor.y <= 1.0 ? cursor.y : cursor.y / viewportHeight;
    normCursorX = Math.max(0.05, Math.min(0.95, rawX));
    normCursorY = Math.max(0.05, Math.min(0.95, rawY));
  }

  // Check if timeMs is in an inter-pill gap between chained pills (<= 800ms)
  if (!activePill && pills.length > 1) {
    for (let i = 0; i < pills.length - 1; i++) {
      const p1 = pills[i];
      const p2 = pills[i + 1];
      const gap = p2.startTime - p1.endTime;
      if (gap >= 0 && gap <= 800 && timeMs >= p1.endTime && timeMs <= p2.startTime) {
        // Smoothly glide across inter-pill gap without dipping to neutral scale 1.0
        const p = gap > 0 ? (timeMs - p1.endTime) / gap : 0;
        const ease = smootherStep(p);
        return {
          x: p1.targetX + (p2.targetX - p1.targetX) * ease,
          y: p1.targetY + (p2.targetY - p1.targetY) * ease,
          scale: p1.targetScale + (p2.targetScale - p1.targetScale) * ease,
          tiltX: p1.tiltX + (p2.tiltX - p1.tiltX) * ease,
          tiltY: p1.tiltY + (p2.tiltY - p1.tiltY) * ease
        };
      }
    }
  }

  if (activePill) {
    const start = activePill.startTime;
    const end = activePill.endTime;
    const totalPillDuration = Math.max(1, end - start);
    const actualTransition = Math.max(1, Math.min(TRANSITION_MS, totalPillDuration * 0.35));

    // Check if next pill starts soon (within 800ms of this pill ending)
    const nextPill = activePillIndex >= 0 && activePillIndex < pills.length - 1 ? pills[activePillIndex + 1] : undefined;
    const isChainedToNext = nextPill && (nextPill.startTime - end <= 800);

    // Check if previous pill ended soon (within 800ms before this pill starting)
    const prevPill = activePillIndex > 0 ? pills[activePillIndex - 1] : undefined;
    const isChainedFromPrev = prevPill && (start - prevPill.endTime <= 800);

    // Compute cursor tracking bias for active pill (30% dynamic follow keeps target centered while gliding)
    let targetX = activePill.targetX;
    let targetY = activePill.targetY;
    if (hasCursor && followCursor) {
      targetX = targetX + (normCursorX - targetX) * 0.32;
      targetY = targetY + (normCursorY - targetY) * 0.32;
    }

    if (timeMs < start + actualTransition && !isChainedFromPrev) {
      // Transitioning in from neutral full frame (0.5, 0.5, 1.0)
      const p = Math.max(0, Math.min(1, (timeMs - start) / actualTransition));
      const ease = smootherStep(p);
      return {
        x: 0.5 + (targetX - 0.5) * ease,
        y: 0.5 + (targetY - 0.5) * ease,
        scale: 1.0 + (activePill.targetScale - 1.0) * ease,
        tiltX: activePill.tiltX * ease,
        tiltY: activePill.tiltY * ease
      };
    } else if (timeMs < start + actualTransition && isChainedFromPrev && prevPill) {
      // Already arrived at active pill target from prevPill's transition / gap glide;
      // hold firmly at active target without re-transitioning or snapping
      return {
        x: targetX,
        y: targetY,
        scale: activePill.targetScale,
        tiltX: activePill.tiltX,
        tiltY: activePill.tiltY
      };
    } else if (timeMs > end - actualTransition && isChainedToNext && nextPill) {
      // Chained transition directly towards next pill
      const p = Math.max(0, Math.min(1, (timeMs - (end - actualTransition)) / actualTransition));
      const ease = smootherStep(p);
      return {
        x: targetX + (nextPill.targetX - targetX) * ease,
        y: targetY + (nextPill.targetY - targetY) * ease,
        scale: activePill.targetScale + (nextPill.targetScale - activePill.targetScale) * ease,
        tiltX: activePill.tiltX + (nextPill.tiltX - activePill.tiltX) * ease,
        tiltY: activePill.tiltY + (nextPill.tiltY - activePill.tiltY) * ease
      };
    } else if (timeMs > end - actualTransition && !isChainedToNext) {
      // Transitioning out towards neutral full frame
      const p = Math.max(0, Math.min(1, (end - timeMs) / actualTransition));
      const ease = smootherStep(p);
      return {
        x: 0.5 + (targetX - 0.5) * ease,
        y: 0.5 + (targetY - 0.5) * ease,
        scale: 1.0 + (activePill.targetScale - 1.0) * ease,
        tiltX: activePill.tiltX * ease,
        tiltY: activePill.tiltY * ease
      };
    }

    // Fully inside active pill
    return {
      x: targetX,
      y: targetY,
      scale: activePill.targetScale,
      tiltX: activePill.tiltX,
      tiltY: activePill.tiltY
    };
  }

  // Outside zoom pills: smooth gentle breathing pan towards cursor if enabled
  if (hasCursor && followCursor) {
    return {
      x: 0.5 + (normCursorX - 0.5) * 0.12,
      y: 0.5 + (normCursorY - 0.5) * 0.12,
      scale: 1.0,
      tiltX: 0,
      tiltY: 0
    };
  }

  return { x: 0.5, y: 0.5, scale: 1.0, tiltX: 0, tiltY: 0 };
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

// Smart Click Clustering & Auto-Zoom Pills Generator
// Clusters clicks within 300px radius and 4 seconds into a single continuous zoom pill
export function generateAutoZoomPills(
  clicks: ClickEvent[],
  inputEvents: InputFocusEvent[],
  videoDurationMs: number,
  viewportWidth: number,
  viewportHeight: number,
  scrollEvents?: ScrollEvent[],
  typingSessions?: TypingSession[]
): ZoomPill[] {
  const pills: ZoomPill[] = [];
  const CLUSTER_DISTANCE_PX = 320;
  const CLUSTER_TIME_WINDOW_MS = 3800;
  const MIN_HOLD_DURATION_MS = 2400;

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

  // Filter clicks that have coordinates and happened inside the recording
  const sortedClicks = clicks
    .filter((c) => fitsRecording(c.t) && Number.isFinite(c.x) && Number.isFinite(c.y))
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

  // Coalesce typing zooms cleanly from typingSessions / grouped input spans
  if (typingSessions && typingSessions.length > 0) {
    for (const ts of typingSessions) {
      if (!fitsRecording(ts.t)) continue;
      // Find matching input element bounds from inputEvents near this session
      const matchingEv = inputEvents.find(
        (ev) => ev.t >= ts.t - 500 && ev.t <= ts.endT + 500 && finiteBounds(ev.bounds)
      ) || inputEvents.find((ev) => finiteBounds(ev.bounds));

      let normX = 0.5;
      let normY = 0.5;
      if (matchingEv && matchingEv.bounds) {
        const b = matchingEv.bounds;
        const bX = b.x <= 1.0 ? b.x * viewportWidth : b.x;
        const bY = b.y <= 1.0 ? b.y * viewportHeight : b.y;
        const bW = b.width <= 1.0 ? b.width * viewportWidth : b.width;
        const bH = b.height <= 1.0 ? b.height * viewportHeight : b.height;
        normX = clampNorm((bX + bW / 2) / viewportWidth);
        normY = clampNorm((bY + bH / 2) / viewportHeight);
      }

      const startTime = Math.max(0, ts.t - 400);
      const endTime = Math.min(videoDurationMs, Math.max(startTime + 600, ts.endT + 1800));
      const tilt = calculateIsometricTilt(normX, normY, 1.8);

      pills.push({
        id: 'zoom_input_' + Math.round(startTime),
        startTime,
        endTime,
        targetX: normX,
        targetY: normY,
        targetScale: 1.8,
        tiltX: tilt.tiltX,
        tiltY: tilt.tiltY,
        spotlight: true,
        label: ts.targetLabel && ts.targetLabel !== '[hidden input]'
          ? `Type "${ts.targetLabel.slice(0, 20)}"`
          : 'Typing Focus',
        autoGenerated: true
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
      const firstEv = group[0];
      const lastEv = group[group.length - 1];
      const b = firstEv.bounds;
      const bX = b.x <= 1.0 ? b.x * viewportWidth : b.x;
      const bY = b.y <= 1.0 ? b.y * viewportHeight : b.y;
      const bW = b.width <= 1.0 ? b.width * viewportWidth : b.width;
      const bH = b.height <= 1.0 ? b.height * viewportHeight : b.height;

      const centerX = (bX + bW / 2) / viewportWidth;
      const centerY = (bY + bH / 2) / viewportHeight;

      const normX = clampNorm(centerX);
      const normY = clampNorm(centerY);

      const startTime = Math.max(0, firstEv.t - 400);
      const holdMargin = group.length > 1 ? 1800 : 2200;
      const endTime = Math.min(videoDurationMs, Math.max(startTime + (group.length > 1 ? 600 : 400), lastEv.t + holdMargin));

      const tilt = calculateIsometricTilt(normX, normY, 1.8);
      pills.push({
        id: 'zoom_input_' + Math.round(startTime),
        startTime,
        endTime,
        targetX: normX,
        targetY: normY,
        targetScale: 1.8,
        tiltX: tilt.tiltX,
        tiltY: tilt.tiltY,
        spotlight: true,
        label: 'Typing Focus',
        autoGenerated: true
      });
    }
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

    const normX = clampNorm(focalX / viewportWidth);
    const normY = clampNorm(focalY / viewportHeight);

    // Lead-in: primary.t - 320 ms (>= 90% zoom settled as the click lands)
    const startTime = Math.max(0, primary.t - 320);
    const lastClickTime = cluster[cluster.length - 1].t;
    // The pill must never outlive the recording, but it also must never be
    // collapsed by a bogus duration: clamp against the real video duration.
    const hold = Math.max(lastClickTime + 1600, startTime + MIN_HOLD_DURATION_MS);
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

  return settleAndMergePills(pills, videoDurationMs, scrollEvents);
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

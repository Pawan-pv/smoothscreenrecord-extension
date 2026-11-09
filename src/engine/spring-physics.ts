import { ClickEvent, InputFocusEvent, ZoomPill } from '../types/telemetry';

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
    // Semi-implicit Euler integration for critically damped spring
    const displacement = this.current - this.target;
    const springForce = -this.config.stiffness * displacement;
    const dampingForce = -this.config.damping * this.velocity;
    const acceleration = (springForce + dampingForce) / this.config.mass;

    this.velocity += acceleration * dt;
    this.current += this.velocity * dt;

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
  const TRANSITION_MS = 450; // 450ms smooth spring-like ease

  // Find active pill or closest overlapping transition
  let activePill: ZoomPill | undefined;
  for (const pill of pills) {
    if (timeMs >= pill.startTime && timeMs <= pill.endTime) {
      activePill = pill;
      break;
    }
  }

  // Smooth Hermite cubic ease curve
  const smoothStep = (t: number) => t * t * (3 - 2 * t);

  if (activePill) {
    const start = activePill.startTime;
    const end = activePill.endTime;
    const totalPillDuration = end - start;
    const actualTransition = Math.min(TRANSITION_MS, totalPillDuration * 0.35);

    let easeProgress = 1.0;
    if (timeMs < start + actualTransition) {
      // Transitioning in
      const p = Math.max(0, Math.min(1, (timeMs - start) / actualTransition));
      easeProgress = smoothStep(p);
    } else if (timeMs > end - actualTransition) {
      // Transitioning out
      const p = Math.max(0, Math.min(1, (end - timeMs) / actualTransition));
      easeProgress = smoothStep(p);
    }

    // Dynamic cursor following bias (follows cursor subtly inside the zoomed focal region)
    let targetX = activePill.targetX;
    let targetY = activePill.targetY;

    if (cursor && followCursor && viewportWidth > 0 && viewportHeight > 0) {
      const normCursorX = Math.max(0.05, Math.min(0.95, cursor.x / viewportWidth));
      const normCursorY = Math.max(0.05, Math.min(0.95, cursor.y / viewportHeight));
      // 30% cursor tracking bias keeps element centered while gliding smoothly with mouse
      targetX = targetX + (normCursorX - targetX) * 0.30;
      targetY = targetY + (normCursorY - targetY) * 0.30;
    }

    const scale = 1.0 + (activePill.targetScale - 1.0) * easeProgress;
    const x = 0.5 + (targetX - 0.5) * easeProgress;
    const y = 0.5 + (targetY - 0.5) * easeProgress;
    const tiltX = activePill.tiltX * easeProgress;
    const tiltY = activePill.tiltY * easeProgress;

    return { x, y, scale, tiltX, tiltY };
  }

  // Outside zoom pills: smooth gentle pan towards cursor if cursor is active
  if (cursor && followCursor && viewportWidth > 0 && viewportHeight > 0) {
    const normCursorX = Math.max(0.05, Math.min(0.95, cursor.x / viewportWidth));
    const normCursorY = Math.max(0.05, Math.min(0.95, cursor.y / viewportHeight));
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
  viewportHeight: number
): ZoomPill[] {
  const pills: ZoomPill[] = [];
  const CLUSTER_DISTANCE_PX = 320;
  const CLUSTER_TIME_WINDOW_MS = 3800;
  const MIN_HOLD_DURATION_MS = 2400;

  // Filter clicks that have coordinates
  const sortedClicks = [...clicks].sort((a, b) => a.t - b.t);

  let currentCluster: ClickEvent[] = [];

  for (let i = 0; i < sortedClicks.length; i++) {
    const click = sortedClicks[i];

    if (currentCluster.length === 0) {
      currentCluster.push(click);
      continue;
    }

    const firstClick = currentCluster[0];
    const prevClick = currentCluster[currentCluster.length - 1];

    const distFromFirst = Math.hypot(click.x - firstClick.x, click.y - firstClick.y);
    const timeDelta = click.t - prevClick.t;

    if (distFromFirst <= CLUSTER_DISTANCE_PX && timeDelta <= CLUSTER_TIME_WINDOW_MS) {
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

  // Also create zoom pills for text input typing sessions
  for (const inputEv of inputEvents) {
    if (inputEv.type === 'focus' || inputEv.type === 'type') {
      const centerX = (inputEv.bounds.x + inputEv.bounds.width / 2) / viewportWidth;
      const centerY = (inputEv.bounds.y + inputEv.bounds.height / 2) / viewportHeight;

      const normX = Math.max(0.1, Math.min(0.9, centerX));
      const normY = Math.max(0.1, Math.min(0.9, centerY));

      const startTime = Math.max(0, inputEv.t - 400);
      const endTime = Math.min(videoDurationMs, inputEv.t + 2200);

      // Check if overlapping an existing pill
      const overlap = pills.some((p) => Math.abs(p.startTime - startTime) < 1500);
      if (!overlap) {
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
  }

  function flushClusterToPill(cluster: ClickEvent[]) {
    if (cluster.length === 0) return;

    // Use parent container bounding box if available from DOM climbing
    const primary = cluster[0];
    let focalX = primary.x;
    let focalY = primary.y;
    let scale = 1.6;

    if (primary.containerBounds && primary.containerBounds.width > 50) {
      focalX = primary.containerBounds.x + primary.containerBounds.width / 2;
      focalY = primary.containerBounds.y + primary.containerBounds.height / 2;

      // Smart zoom scaling based on container size
      const coverage = primary.containerBounds.width / viewportWidth;
      if (coverage > 0.6) {
        scale = 1.35; // Large modal/form: gentle zoom
      } else if (coverage < 0.2) {
        scale = 2.1;  // Small button or dropdown: punchy zoom
      } else {
        scale = 1.7;  // Medium card/section
      }
    } else {
      // Average cluster positions
      const avgX = cluster.reduce((sum, c) => sum + c.x, 0) / cluster.length;
      const avgY = cluster.reduce((sum, c) => sum + c.y, 0) / cluster.length;
      focalX = avgX;
      focalY = avgY;
    }

    const normX = Math.max(0.15, Math.min(0.85, focalX / viewportWidth));
    const normY = Math.max(0.15, Math.min(0.85, focalY / viewportHeight));

    const startTime = Math.max(0, primary.t - 300);
    const lastClickTime = cluster[cluster.length - 1].t;
    const endTime = Math.min(videoDurationMs, Math.max(lastClickTime + 1600, startTime + MIN_HOLD_DURATION_MS));

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

  // Sort pills chronologically and return
  return pills.sort((a, b) => a.startTime - b.startTime);
}

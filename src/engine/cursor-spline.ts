import { MousePoint, ClickEvent, CursorTheme, PressEvent, CursorStyle } from '../types/telemetry';
import { createSpring, dampingFor, SPRING_STEP_MS } from './spring';

export interface InterpolatedCursor {
  x: number;
  y: number;
  style: string;
  vx: number;
  vy: number;
  speed: number;
  opacity: number;
}

/** How the drawn cursor moves (user settings). */
export interface CursorMotionSettings {
  /** 0 = tight tracking, barely smoothed; 100 = long languid glides with more lag. */
  sway: number;
  /** Lean the cursor with its horizontal speed. */
  tiltEnabled: boolean;
  /** Largest lean, in degrees. */
  maxTiltDeg: number;
  /** Squash the cursor while the button is down (with a little overshoot on release). */
  pressEnabled: boolean;
  /** How deep the press squashes: 0.15 = scale 0.85. */
  pressDepth: number;
  /** Fade the cursor out when the real cursor has been still. */
  hideWhenIdle: boolean;
  /** Stillness before the fade-out starts. */
  idleDelayMs: number;
}

export const DEFAULT_CURSOR_MOTION: CursorMotionSettings = {
  sway: 50,
  tiltEnabled: true,
  maxTiltDeg: 12,
  pressEnabled: true,
  pressDepth: 0.15,
  hideWhenIdle: true,
  idleDelayMs: 1500
};

/** Cursor spring stiffness at sway 0 (tight) and sway 100 (loose). Always critically damped. */
export const CURSOR_TIGHT_STIFFNESS = 6000;
export const CURSOR_LOOSE_STIFFNESS = 100;
/** Lean in degrees per px/s of horizontal speed (1500 px/s = 12 deg). */
export const CURSOR_TILT_GAIN = 0.008;
const CURSOR_TILT_STIFFNESS = 300;
const CURSOR_PRESS_STIFFNESS = 900;
/** Below 1: the press spring overshoots a little on release. */
const CURSOR_PRESS_DAMPING_RATIO = 0.55;
/** A click without press events counts as held this long around its time. */
const CLICK_PRESS_BEFORE_MS = 40;
const CLICK_PRESS_AFTER_MS = 60;
/** Movement smaller than this (px of a 1920 frame) from where the cursor last moved is jitter, not activity: no flicker. */
export const CURSOR_IDLE_EPS_PX = 6;
export const CURSOR_IDLE_FADE_MS = 200;
/** After the last sample the cursor springs keep running this long. */
const CURSOR_SETTLE_MS = 1500;

export interface CursorSplineOptions {
  smoothing?: number;
  cutRanges?: Array<{ startTime: number; endTime: number }>;
  trimStartMs?: number;
  trimEndMs?: number;
  motion?: Partial<CursorMotionSettings>;
}

/** Default stillness before the cursor fades out. */
export const CURSOR_IDLE_TIMEOUT_MS = DEFAULT_CURSOR_MOTION.idleDelayMs;

export function getPressScale(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  return 0.85 + 0.15 * eased;
}

// Catmull-Rom spline interpolation between 4 points
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export class CursorSplineEngine {
  private mousePoints: MousePoint[] = [];
  private filteredMousePoints: MousePoint[] = [];
  private clicks: ClickEvent[] = [];
  private pressEvents: PressEvent[] = [];
  private activityTimestamps: number[] = [];
  private smoothing = 0.6;
  private cutRanges: Array<{ startTime: number; endTime: number }> = [];
  /**
   * The filtered trajectory depends ONLY on the raw points and the smoothing
   * strength. Trim handles, silence cuts and every other option leave it alone,
   * so it is rebuilt only when one of those two changed.
   */
  private filterDirty = true;
  private motion: CursorMotionSettings = { ...DEFAULT_CURSOR_MOTION };
  /**
   * The drawn cursor's springs (x, y, velocity, tilt, press), stepped once at a fixed
   * 120 Hz over the recording and read by time. Rebuilt lazily when the data, the
   * filter, the cuts or the motion settings change.
   */
  private motionTrack: { t0: number; steps: number; x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array; tilt: Float64Array; press: Float64Array } | null = null;

  constructor(mousePoints: MousePoint[] = [], clicks: ClickEvent[] = [], pressEvents: PressEvent[] = [], options: CursorSplineOptions = {}) {
    this.setData(mousePoints, clicks, pressEvents, options);
  }

  public setData(mousePoints: MousePoint[], clicks: ClickEvent[], pressEvents: PressEvent[] = [], options: CursorSplineOptions = {}) {
    this.mousePoints = [...mousePoints].sort((a, b) => a.t - b.t);
    this.filterDirty = true;
    this.motionTrack = null;
    this.clicks = [...clicks].sort((a, b) => a.t - b.t);
    this.pressEvents = [...pressEvents].sort((a, b) => a.t - b.t);
    this.setOptions(options);

    const activities: number[] = [];
    for (const c of this.clicks) {
      if (Number.isFinite(c.t)) {
        activities.push(c.t);
      }
    }

    if (this.mousePoints.length > 0) {
      // Hysteresis: only a move of more than CURSOR_IDLE_EPS_PX from where the cursor
      // last counted as moving is activity, so 1 px jitter neither keeps it shown nor flickers it.
      // Normalised coordinates are measured in pixels of a 1920 x 1080 frame on each axis.
      const normalized = this.mousePoints.every((p) => Math.abs(p.x) <= 1.01 && Math.abs(p.y) <= 1.01);
      const sx = normalized ? 1920 : 1;
      const sy = normalized ? 1080 : 1;
      let anchor = this.mousePoints[0];
      activities.push(anchor.t);
      for (let i = 1; i < this.mousePoints.length; i++) {
        const curr = this.mousePoints[i];
        if (Math.hypot((curr.x - anchor.x) * sx, (curr.y - anchor.y) * sy) > CURSOR_IDLE_EPS_PX) {
          activities.push(curr.t);
          anchor = curr;
        }
      }
    }
    for (const p of this.pressEvents) {
      if (Number.isFinite(p.t)) activities.push(p.t);
    }

    activities.sort((a, b) => a - b);
    this.activityTimestamps = activities.filter((t, idx) => idx === 0 || t !== activities[idx - 1]);
  }

  public setOptions(options: CursorSplineOptions = {}): void {
    if (typeof options.smoothing === 'number' && Number.isFinite(options.smoothing)) {
      const next = Math.max(0, Math.min(1, options.smoothing));
      if (next !== this.smoothing) this.filterDirty = true;
      this.smoothing = next;
    }
    if (options.cutRanges) {
      this.cutRanges = options.cutRanges
        .filter((range) => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime)
        .map((range) => ({ startTime: range.startTime, endTime: range.endTime }))
        .sort((a, b) => a.startTime - b.startTime);
      this.motionTrack = null;
    }
    if (options.motion) {
      const m = { ...this.motion, ...options.motion };
      const num = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
      const next: CursorMotionSettings = {
        sway: num(m.sway, 0, 100, DEFAULT_CURSOR_MOTION.sway),
        tiltEnabled: Boolean(m.tiltEnabled),
        maxTiltDeg: num(m.maxTiltDeg, 0, 45, DEFAULT_CURSOR_MOTION.maxTiltDeg),
        pressEnabled: Boolean(m.pressEnabled),
        pressDepth: num(m.pressDepth, 0, 0.5, DEFAULT_CURSOR_MOTION.pressDepth),
        hideWhenIdle: Boolean(m.hideWhenIdle),
        idleDelayMs: num(m.idleDelayMs, 0, 60000, DEFAULT_CURSOR_MOTION.idleDelayMs)
      };
      if (JSON.stringify(next) !== JSON.stringify(this.motion)) {
        this.motion = next;
        this.motionTrack = null;
      }
    }
    if (this.filterDirty) {
      this.rebuildFilteredMousePoints();
      this.filterDirty = false;
      this.motionTrack = null;
    }
  }

  public getMotionSettings(): CursorMotionSettings {
    return { ...this.motion };
  }

  /**
   * Build a centred, zero-phase trajectory before Catmull-Rom interpolation.
   *
   * Adaptive: where the cursor moves fast it is smoothed lightly (sigma from the
   * Smoothing setting), where it is slow or still it is averaged over a much wider
   * window, so hand tremor and sensor jitter never reach the drawn cursor while real
   * moves keep their shape. Both passes are centred, so neither adds lag.
   */
  private rebuildFilteredMousePoints(): void {
    if (this.mousePoints.length === 0 || this.smoothing <= 0) {
      this.filteredMousePoints = this.mousePoints.map((point) => ({ ...point }));
      return;
    }

    const maxCoordinate = this.mousePoints.reduce((max, point) => Math.max(max, Math.abs(point.x), Math.abs(point.y)), 0);
    const pxPerUnit = maxCoordinate <= 1.01 ? 1920 : 1;
    const points = this.mousePoints;
    const narrowSigma = 18 + this.smoothing * 55;
    const wideSigma = Math.max(150, narrowSigma * 3);

    // Gaussian pass. The points are sorted by time, so the window [t - radius,
    // t + radius] only ever slides forward: O(N * window).
    const pass = (sigmaMs: number) => {
      const radiusMs = sigmaMs * 3;
      const weightAt = new Float64Array(Math.floor(radiusMs) + 1);
      for (let d = 0; d < weightAt.length; d++) weightAt[d] = Math.exp(-0.5 * (d / sigmaMs) ** 2);
      const xs = new Float64Array(points.length);
      const ys = new Float64Array(points.length);
      let windowStart = 0;
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        while (windowStart < i && point.t - points[windowStart].t > radiusMs) windowStart++;
        let weightSum = 0;
        let x = 0;
        let y = 0;
        for (let j = windowStart; j < points.length; j++) {
          const candidate = points[j];
          const distance = Math.abs(candidate.t - point.t);
          if (distance > radiusMs) {
            if (candidate.t > point.t) break;
            continue;
          }
          const weight = Number.isInteger(distance) ? weightAt[distance] : Math.exp(-0.5 * (distance / sigmaMs) ** 2);
          weightSum += weight;
          x += candidate.x * weight;
          y += candidate.y * weight;
        }
        xs[i] = weightSum > 0 ? x / weightSum : point.x;
        ys[i] = weightSum > 0 ? y / weightSum : point.y;
      }
      return { xs, ys };
    };

    const narrow = pass(narrowSigma);
    const mid = pass(narrowSigma * 1.6);
    const wide = pass(wideSigma);
    // Speed bands (px/s): still/slow -> wide, medium -> mid, fast -> narrow, blended smoothly.
    const SLOW = 60;
    const MEDIUM = 300;
    const FAST = 900;
    const smooth = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c); };
    const filtered: MousePoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(points.length - 1, i + 1);
      const dt = Math.max(1, points[b].t - points[a].t) / 1000;
      const speed = Math.hypot(wide.xs[b] - wide.xs[a], wide.ys[b] - wide.ys[a]) * pxPerUnit / dt;
      let x: number;
      let y: number;
      if (speed < MEDIUM) {
        const w = smooth((speed - SLOW) / (MEDIUM - SLOW));
        x = wide.xs[i] + (mid.xs[i] - wide.xs[i]) * w;
        y = wide.ys[i] + (mid.ys[i] - wide.ys[i]) * w;
      } else {
        const w = smooth((speed - MEDIUM) / (FAST - MEDIUM));
        x = mid.xs[i] + (narrow.xs[i] - mid.xs[i]) * w;
        y = mid.ys[i] + (narrow.ys[i] - mid.ys[i]) * w;
      }
      filtered.push({ ...points[i], x, y });
    }
    this.filteredMousePoints = filtered;
  }

  private pinToClick(timeMs: number, x: number, y: number): { x: number; y: number } {
    const click = this.clicks.reduce<ClickEvent | null>((nearest, candidate) => {
      if (Math.abs(candidate.t - timeMs) > 60) return nearest;
      return !nearest || Math.abs(candidate.t - timeMs) < Math.abs(nearest.t - timeMs) ? candidate : nearest;
    }, null);
    if (!click) return { x, y };
    const normalized = 1 - Math.abs(click.t - timeMs) / 60;
    const weight = normalized * normalized * (3 - 2 * normalized);
    return { x: x + (click.x - x) * weight, y: y + (click.y - y) * weight };
  }

  public getCursorOpacityAt(timeMs: number): number {
    if (!this.motion.hideWhenIdle || this.activityTimestamps.length === 0) {
      return 1.0;
    }
    const delay = this.motion.idleDelayMs;

    let low = 0;
    let high = this.activityTimestamps.length - 1;
    let lastActivity = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.activityTimestamps[mid] <= timeMs) {
        lastActivity = this.activityTimestamps[mid];
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let idleMs: number;
    if (lastActivity === -1) {
      idleMs = Math.max(0, timeMs);
    } else {
      idleMs = Math.max(0, timeMs - lastActivity);
    }

    // Any real movement shows the cursor at once; stillness fades it out after the delay.
    if (idleMs <= delay) {
      return 1.0;
    }
    if (idleMs >= delay + CURSOR_IDLE_FADE_MS) {
      return 0.0;
    }

    const progress = (idleMs - delay) / CURSOR_IDLE_FADE_MS;
    return 0.5 * (1 + Math.cos(Math.PI * progress));
  }

  /**
   * The DRAWN cursor: the tracked path chased by the sway spring (it lags the real
   * path slightly, so movements smaller than the spring's response never show),
   * pinned onto a click as it lands.
   */
  public getCursorAt(timeMs: number): InterpolatedCursor {
    const tracked = this.getTrackedCursorAt(timeMs);
    const track = this.ensureMotionTrack();
    if (!track || !Number.isFinite(timeMs)) return tracked;
    const f = (timeMs - track.t0) / SPRING_STEP_MS;
    if (f <= 0 || f >= track.steps) return tracked;
    const i = Math.floor(f);
    const r = f - i;
    const read = (a: Float64Array) => a[i] + (a[i + 1] - a[i]) * r;
    const pinned = this.pinToClick(timeMs, read(track.x), read(track.y));
    const vx = read(track.vx);
    const vy = read(track.vy);
    return { ...tracked, x: pinned.x, y: pinned.y, vx, vy, speed: Math.hypot(vx, vy) };
  }

  /** Lean of the drawn cursor in degrees (0 when tilt is off). */
  public getTiltAt(timeMs: number): number {
    return this.readMotion(timeMs, 'tilt');
  }

  private readMotion(timeMs: number, channel: 'tilt' | 'press'): number {
    const track = this.ensureMotionTrack();
    if (!track || !Number.isFinite(timeMs)) return 0;
    const f = (timeMs - track.t0) / SPRING_STEP_MS;
    if (f <= 0 || f >= track.steps) return 0;
    const i = Math.floor(f);
    const a = track[channel];
    return a[i] + (a[i + 1] - a[i]) * (f - i);
  }

  /**
   * Is the button down at this time (press events; a bare click counts briefly)?
   * Must be asked with times that never go backwards (the track build).
   */
  private buildPressedLookup(): (t: number) => boolean {
    const intervals: Array<[number, number]> = [];
    const presses = this.pressEvents.filter((p) => Number.isFinite(p.t));
    if (presses.length > 0) {
      let down: number | null = null;
      for (const p of presses) {
        if (p.type === 'down') { if (down === null) down = p.t; }
        else if (down !== null) { intervals.push([down, Math.max(p.t, down + 1)]); down = null; }
      }
      if (down !== null) intervals.push([down, down + 200]);
    } else {
      for (const c of this.clicks) {
        if (Number.isFinite(c.t)) intervals.push([c.t - CLICK_PRESS_BEFORE_MS, c.t + CLICK_PRESS_AFTER_MS]);
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let i = 0;
    return (t) => {
      while (i < intervals.length && intervals[i][1] <= t) i++;
      for (let j = i; j < intervals.length && intervals[j][0] <= t; j++) {
        if (t < intervals[j][1]) return true;
      }
      return false;
    };
  }

  private ensureMotionTrack() {
    if (this.motionTrack) return this.motionTrack;
    if (this.mousePoints.length === 0) return null;
    const m = this.motion;
    const t0 = this.mousePoints[0].t;
    const t1 = this.mousePoints[this.mousePoints.length - 1].t + CURSOR_SETTLE_MS;
    const steps = Math.max(1, Math.ceil((t1 - t0) / SPRING_STEP_MS));
    const x = new Float64Array(steps + 1);
    const y = new Float64Array(steps + 1);
    const vx = new Float64Array(steps + 1);
    const vy = new Float64Array(steps + 1);
    const tilt = new Float64Array(steps + 1);
    const press = new Float64Array(steps + 1);

    const k = CURSOR_TIGHT_STIFFNESS + (CURSOR_LOOSE_STIFFNESS - CURSOR_TIGHT_STIFFNESS) * (m.sway / 100);
    const start = this.getTrackedCursorAt(t0);
    const sx = createSpring(k, dampingFor(k), start.x);
    const sy = createSpring(k, dampingFor(k), start.y);
    const st = createSpring(CURSOR_TILT_STIFFNESS, dampingFor(CURSOR_TILT_STIFFNESS), 0);
    const sp = createSpring(CURSOR_PRESS_STIFFNESS, dampingFor(CURSOR_PRESS_STIFFNESS, CURSOR_PRESS_DAMPING_RATIO), 0);
    const pxPerUnit = this.mousePoints.every((p) => Math.abs(p.x) <= 1.01 && Math.abs(p.y) <= 1.01) ? 1920 : 1;
    const pressed = this.buildPressedLookup();
    const dt = SPRING_STEP_MS / 1000;

    for (let s = 0; s <= steps; s++) {
      const t = t0 + s * SPRING_STEP_MS;
      const target = this.getTrackedCursorAt(t);
      // A cut is a jump of the playhead: the cursor is there at once, it does not fly across.
      if (this.cutRanges.some((range) => t >= range.startTime && t <= range.endTime + 80)) {
        sx.snap(target.x);
        sy.snap(target.y);
      }
      x[s] = sx.value;
      y[s] = sy.value;
      vx[s] = sx.velocity;
      vy[s] = sy.velocity;
      tilt[s] = st.value;
      press[s] = sp.value;
      sx.step(target.x, dt);
      sy.step(target.y, dt);
      // Velocity-driven lean: speed to the right leans right, clamped to the user's angle.
      const lean = m.tiltEnabled ? Math.max(-m.maxTiltDeg, Math.min(m.maxTiltDeg, sx.velocity * pxPerUnit * CURSOR_TILT_GAIN)) : 0;
      st.step(lean, dt);
      sp.step(m.pressEnabled && pressed(t) ? m.pressDepth : 0, dt);
    }
    this.motionTrack = { t0, steps, x, y, vx, vy, tilt, press };
    return this.motionTrack;
  }

  /** The tracked (filtered, unsprung) cursor path: what the drawn cursor and the camera chase. */
  public getTrackedCursorAt(timeMs: number): InterpolatedCursor {
    const opacity = this.getCursorOpacityAt(timeMs);

    if (this.mousePoints.length === 0) {
      return { x: 0, y: 0, style: 'default', vx: 0, vy: 0, speed: 0, opacity };
    }

    const points = this.filteredMousePoints.length > 0 ? this.filteredMousePoints : this.mousePoints;

    if (timeMs <= this.mousePoints[0].t) {
      const p = points[0];
      const pinned = this.pinToClick(timeMs, p.x, p.y);
      return { x: pinned.x, y: pinned.y, style: this.mousePoints[0].c, vx: 0, vy: 0, speed: 0, opacity };
    }

    const seamCut = this.cutRanges.find((range) => timeMs >= range.startTime && timeMs <= range.endTime + 80);
    if (seamCut) {
      const postCutIndex = points.findIndex((point) => point.t >= seamCut.endTime);
      const postCut = postCutIndex >= 0 ? points[postCutIndex] : points[points.length - 1];
      const rawPostCut = postCutIndex >= 0 ? this.mousePoints[postCutIndex] : this.mousePoints[this.mousePoints.length - 1];
      const seamProgress = timeMs <= seamCut.endTime ? 0 : Math.min(1, (timeMs - seamCut.endTime) / 80);
      return {
        x: rawPostCut.x,
        y: rawPostCut.y,
        style: rawPostCut.c,
        vx: 0,
        vy: 0,
        speed: 0,
        opacity: opacity * seamProgress
      };
    }

    const last = points[points.length - 1];
    if (timeMs >= last.t) {
      const pinned = this.pinToClick(timeMs, last.x, last.y);
      return { x: pinned.x, y: pinned.y, style: this.mousePoints[this.mousePoints.length - 1].c, vx: 0, vy: 0, speed: 0, opacity };
    }

    // Binary search for closest points surrounding timeMs
    let low = 0;
    let high = points.length - 1;
    let index = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].t <= timeMs) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const i1 = index;
    const i2 = Math.min(this.mousePoints.length - 1, i1 + 1);
    const i0 = Math.max(0, i1 - 1);
    const i3 = Math.min(this.mousePoints.length - 1, i2 + 1);

    const p0 = points[i0];
    const p1 = points[i1];
    const p2 = points[i2];
    const p3 = points[i3];
    const rawP1 = this.mousePoints[i1];

    const crossesCut = this.cutRanges.some((range) => p1.t < range.startTime && p2.t > range.endTime);
    if (crossesCut) {
      const cut = this.cutRanges.find((range) => p1.t < range.startTime && p2.t > range.endTime);
      const before = timeMs < (cut?.startTime || timeMs);
      const seamRawPoint = before ? this.mousePoints[i1] : this.mousePoints[i2];
      return {
        x: seamRawPoint.x,
        y: seamRawPoint.y,
        style: seamRawPoint.c,
        vx: 0,
        vy: 0,
        speed: 0,
        opacity
      };
    }

    const segmentDuration = p2.t - p1.t;
    const t = segmentDuration > 0 ? (timeMs - p1.t) / segmentDuration : 0;
    const clampedT = Math.max(0, Math.min(1, t));

    // Use Catmull-Rom for rapid 120Hz micro-movements (< 120ms), linear blend for pauses to prevent spline overshooting
    let x: number;
    let y: number;
    const linearX = p1.x + (p2.x - p1.x) * clampedT;
    const linearY = p1.y + (p2.y - p1.y) * clampedT;
    if (segmentDuration > 120) {
      x = linearX;
      y = linearY;
    } else {
      const splineX = catmullRom(p0.x, p1.x, p2.x, p3.x, clampedT);
      const splineY = catmullRom(p0.y, p1.y, p2.y, p3.y, clampedT);
      x = linearX + (splineX - linearX) * this.smoothing;
      y = linearY + (splineY - linearY) * this.smoothing;
    }

    // Calculate instantaneous velocity in pixels/second
    const dt = Math.max(0.001, segmentDuration / 1000);
    const vx = segmentDuration < 300 ? (p2.x - p1.x) / dt : 0;
    const vy = segmentDuration < 300 ? (p2.y - p1.y) / dt : 0;
    const speed = Math.hypot(vx, vy);

    const pinned = this.pinToClick(timeMs, x, y);
    return {
      x: pinned.x,
      y: pinned.y,
      style: rawP1.c || 'default',
      vx,
      vy,
      speed,
      opacity
    };
  }

  public getClicks(): ClickEvent[] {
    return this.clicks;
  }

  /**
   * The cursor position for the camera to follow, or null when the recording has no
   * cursor samples (getCursorAt then reports (0,0), which is not a real position).
   */
  public getCameraCursorAt(timeMs: number): InterpolatedCursor | null {
    return this.mousePoints.length > 0 ? this.getTrackedCursorAt(timeMs) : null;
  }

  /** Scale of the drawn cursor from the press spring (1 = not pressed; slightly above 1 on the release overshoot). */
  public getPressScaleAt(timeMs: number): number {
    return 1 - this.readMotion(timeMs, 'press');
  }

  public getTrailAt(timeMs: number, maxSamples = 4, outputFps = 60): InterpolatedCursor[] {
    if (outputFps <= 20) return [];
    const current = this.getCursorAt(timeMs);
    if (current.speed * 1920 <= 350 || current.opacity <= 0.001) return [];
    const trail: InterpolatedCursor[] = [];
    const sampleMs = 1000 / Math.max(30, outputFps);
    for (let i = 1; i <= maxSamples; i++) {
      const sampleTime = timeMs - sampleMs * i;
      if (this.cutRanges.some((range) => sampleTime <= range.endTime + 120 && timeMs >= range.startTime)) return [];
      const sample = this.getCursorAt(sampleTime);
      trail.push({ ...sample, opacity: current.opacity * (1 - i / (maxSamples + 1)) * 0.24 });
    }
    return trail;
  }

  // Draw crisp 4K vector cursor and physics click ripple rings at specific screen coordinates
  public drawCursorAt(
    ctx: CanvasRenderingContext2D,
    cursor: InterpolatedCursor,
    screenX: number,
    screenY: number,
    currentTimeMs: number,
    ringColor: string = '#8B5CF6',
    activeRipples?: { x: number; y: number; progress: number }[],
    theme: CursorTheme = 'mac-obsidian',
    cursorScale: number = 1.0,
    canvasScale: number = 1.0,
    trailPoints: Array<{ x: number; y: number; opacity: number }> = []
  ): void {
    ctx.save();

    // 1. Draw Active Click Ripples
    if (activeRipples && activeRipples.length > 0) {
      for (const ripple of activeRipples) {
        const progress = ripple.progress;
        const radius = (10 + progress * 34) * Math.min(1.4, Math.max(0.8, cursorScale));
        const alpha = Math.max(0, (1 - progress) * 0.85);

        ctx.save();
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Inner solid dot pop
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 2. Motion trail / directional motion blur if moving fast
    const cursorOpacity = typeof cursor.opacity === 'number' ? cursor.opacity : 1.0;
    if (cursorOpacity <= 0.001) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * cursorOpacity));
    const pressScale = this.getPressScaleAt(currentTimeMs);
    const outputScale = Math.max(0.75, Math.min(2, canvasScale));

    if (trailPoints.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * cursorScale * outputScale;
      for (let i = trailPoints.length - 1; i > 0; i--) {
        const from = trailPoints[i];
        const to = trailPoints[i - 1];
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(168, 85, 247, 0.35)' : 'rgba(255, 255, 255, 0.20)';
        ctx.globalAlpha = Math.max(0, Math.min(1, from.opacity));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Handles normalized (0..1) speeds (scaled to ~1920px equivalent) as well as legacy pixel speeds
    const effectiveSpeed = cursor.x <= 1.0 ? cursor.speed * 1920 : cursor.speed;
    if (effectiveSpeed > 350) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02) * cursorScale * outputScale;
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(
        screenX - Math.cos(angle) * blurLen,
        screenY - Math.sin(angle) * blurLen
      );
      ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 4 * cursorScale * outputScale;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor (screen space: its size never follows the zoom)
    ctx.translate(screenX, screenY);
    const tiltDeg = this.getTiltAt(currentTimeMs);
    if (Math.abs(tiltDeg) > 0.01) ctx.rotate((tiltDeg * Math.PI) / 180); // leans about its hotspot
    if (pressScale < 0.985) {
      ctx.beginPath();
      ctx.arc(0, 0, 18 * cursorScale * outputScale, 0, Math.PI * 2);
      ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(192, 132, 252, 0.30)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2 * outputScale;
      ctx.globalAlpha *= 0.7;
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, Math.min(1, cursorOpacity));
    }
    if (cursorScale * pressScale * outputScale !== 1.0) {
      ctx.scale(cursorScale * pressScale * outputScale, cursorScale * pressScale * outputScale);
    }

    // Subtle drop shadow for vector cursor
    if (theme === 'neon-glow') {
      ctx.shadowColor = '#8B5CF6';
      ctx.shadowBlur = 14 * outputScale;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8 * outputScale;
      ctx.shadowOffsetX = 1 * outputScale;
      ctx.shadowOffsetY = 2 * outputScale;
    }

    if (cursor.style === 'pointer') {
      // Sleek pointing hand SVG vector
      this.drawHandCursor(ctx, theme);
    } else if (cursor.style === 'text') {
      // macOS style I-beam cursor
      this.drawIBeamCursor(ctx, theme);
    } else if (cursor.style === 'grab') {
      this.drawGrabCursor(ctx, theme);
    } else if (cursor.style === 'grabbing') {
      this.drawGrabbingCursor(ctx, theme);
    } else {
      // Sleek modern Arrow Pointer
      this.drawArrowCursor(ctx, theme);
    }

    ctx.restore();
  }

  private drawGrabCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    this.drawHandCursor(ctx, theme);
  }

  private drawGrabbingCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.save();
    ctx.scale(0.9, 0.9);
    this.drawHandCursor(ctx, theme);
    ctx.restore();
  }

  // Draw crisp 4K vector cursor and physics click ripple rings (legacy fallback)
  public drawCursor(
    ctx: CanvasRenderingContext2D,
    cursor: InterpolatedCursor,
    currentTimeMs: number,
    ringColor: string = '#8B5CF6'
  ): void {
    ctx.save();

    const canvasW = ctx.canvas?.width || 1920;
    const canvasH = ctx.canvas?.height || 1080;

    // 1. Draw Active Click Ripples
    for (const click of this.clicks) {
      const elapsed = currentTimeMs - click.t;
      if (elapsed >= 0 && elapsed <= 500) {
        const progress = elapsed / 500;
        const radius = 10 + progress * 34;
        const alpha = Math.max(0, (1 - progress) * 0.85);

        const clickX = click.x <= 1.0 ? click.x * canvasW : click.x;
        const clickY = click.y <= 1.0 ? click.y * canvasH : click.y;

        ctx.save();
        ctx.beginPath();
        ctx.arc(clickX, clickY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Inner solid dot pop
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(clickX, clickY, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    const cursorX = cursor.x <= 1.0 ? cursor.x * canvasW : cursor.x;
    const cursorY = cursor.y <= 1.0 ? cursor.y * canvasH : cursor.y;
    const effectiveSpeed = cursor.x <= 1.0 ? cursor.speed * canvasW : cursor.speed;

    // 2. Motion trail / directional motion blur if moving fast
    if (effectiveSpeed > 350) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02);
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(cursorX, cursorY);
      ctx.lineTo(
        cursorX - Math.cos(angle) * blurLen,
        cursorY - Math.sin(angle) * blurLen
      );
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor
    ctx.translate(cursorX, cursorY);

    // Subtle drop shadow for vector cursor
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;

    if (cursor.style.includes('pointer') || cursor.style.includes('hand')) {
      // Sleek pointing hand SVG vector
      this.drawHandCursor(ctx);
    } else if (cursor.style.includes('text')) {
      // macOS style I-beam cursor
      this.drawIBeamCursor(ctx);
    } else {
      // Sleek modern Arrow Pointer
      this.drawArrowCursor(ctx);
    }

    ctx.restore();
  }

  private drawArrowCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 19);
    ctx.lineTo(5.2, 14.8);
    ctx.lineTo(9.5, 23.5);
    ctx.lineTo(13, 22);
    ctx.lineTo(8.5, 13.5);
    ctx.lineTo(15, 13.5);
    ctx.closePath();

    if (theme === 'neon-glow') {
      ctx.fillStyle = '#8B5CF6'; // Vibrant electric violet
      ctx.fill();
      ctx.strokeStyle = '#F3E8FF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (theme === 'minimal-white') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#0F1117'; // Crisp obsidian black fill
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; // Crisp white outline
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  private drawHandCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.translate(-4, -1);
    ctx.scale(0.85, 0.85);

    ctx.beginPath();
    // Index finger pointing up
    ctx.moveTo(8, 2);
    ctx.lineTo(8, 12);
    ctx.lineTo(6, 12);
    ctx.lineTo(6, 14);
    ctx.lineTo(4, 15);
    ctx.lineTo(4, 21);
    ctx.quadraticCurveTo(4, 25, 9, 25);
    ctx.lineTo(16, 25);
    ctx.quadraticCurveTo(20, 25, 20, 21);
    ctx.lineTo(20, 13);
    ctx.quadraticCurveTo(20, 11, 18, 11);
    ctx.quadraticCurveTo(16, 11, 16, 13);
    ctx.lineTo(16, 11);
    ctx.quadraticCurveTo(16, 9, 14, 9);
    ctx.quadraticCurveTo(12, 9, 12, 11);
    ctx.lineTo(12, 2);
    ctx.quadraticCurveTo(10, 0, 8, 2);
    ctx.closePath();

    if (theme === 'neon-glow') {
      ctx.fillStyle = '#8B5CF6';
      ctx.fill();
      ctx.strokeStyle = '#F3E8FF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (theme === 'minimal-white') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#0F1117';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  private drawIBeamCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.translate(0, -9);
    ctx.beginPath();
    // Top bar
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    // Vertical stem
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 18);
    // Bottom bar
    ctx.moveTo(-5, 18);
    ctx.lineTo(5, 18);

    if (theme === 'neon-glow') {
      ctx.strokeStyle = '#C084FC';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else if (theme === 'minimal-white') {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(0, 17);
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      // Obsidian, like its arrow: a dark core with a white rim on the whole I-beam
      // (bars included), so it reads on light and dark pages alike.
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3.4;
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#0F1117';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
}

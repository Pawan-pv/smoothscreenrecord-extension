import { MousePoint, ClickEvent, CursorTheme, PressEvent, CursorStyle } from '../types/telemetry';
import { createSpring, dampingFor, SPRING_STEP_MS } from './spring';
import { CURSOR_ENGINE, CursorEngineKind, CursorSolveTrack, solveCursorTrack } from './cursor-solve';

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

/**
 * Shape-aware lean: full tilt around the hotspot for the arrow / hand, none for the
 * I-beam, half around the palm for grab / grabbing.
 *
 * The pivot is in the cursor's local units, measured from the drawn paths:
 * drawHandCursor translates (-4,-1) and scales 0.85 around a hand whose palm centre
 * is (12, 18.5) -> (6.2, 14.7); drawGrabbingCursor adds a 0.9 scale -> (5.6, 13.2).
 */
export const CURSOR_STYLE_MOTION: Record<string, { tilt: number; pivot: readonly [number, number] }> = {
  default: { tilt: 1, pivot: [0, 0] },
  pointer: { tilt: 1, pivot: [0, 0] },
  text: { tilt: 0, pivot: [0, 0] },
  grab: { tilt: 0.5, pivot: [6.2, 14.7] },
  grabbing: { tilt: 0.5, pivot: [5.6, 13.2] }
};
const CURSOR_STYLE_FALLBACK = { tilt: 1, pivot: [0, 0] as const };

/** Glide trail / motion blur: starts at 800 px/s, full at 1200 px/s (1920-frame pixels). */
export const CURSOR_BLUR_ONSET_PX_S = 800;
export const CURSOR_BLUR_FULL_PX_S = 1200;
/** No streak across a cut or a jump back onto the page. */
const CURSOR_BLUR_JUMP_GUARD_MS = 120;

function blurRamp(speedPxPerSecond: number): number {
  const t = Math.max(0, Math.min(1, (speedPxPerSecond - CURSOR_BLUR_ONSET_PX_S) / (CURSOR_BLUR_FULL_PX_S - CURSOR_BLUR_ONSET_PX_S)));
  return t * t * (3 - 2 * t);
}

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
/** No sample for this long = the pointer was not on the page: smoothing never bridges it. */
export const CURSOR_BREAK_MS = 250;
/** The cursor fades out this fast after the pointer leaves the page. */
export const CURSOR_LEAVE_FADE_MS = 120;
/** The smoothing evaluates the recorded path on an even grid of this step (ms). */
const FILTER_GRID_MS = 4;
/** Solve engine: the click pin is only a safety net (the solve already passes through every click). */
const SOLVE_CLICK_PIN_MS = 20;
const SOLVE_CLICK_PIN_WARN_PX = 1;

export interface CursorSplineOptions {
  smoothing?: number;
  cutRanges?: Array<{ startTime: number; endTime: number }>;
  trimStartMs?: number;
  trimEndMs?: number;
  motion?: Partial<CursorMotionSettings>;
  /** 'spline': smoothing filters + spline + x/y springs. 'solve': one constrained minimum-jerk solve (cursor-solve.ts). */
  engine?: CursorEngineKind;
}

/** Default stillness before the cursor fades out. */
export const CURSOR_IDLE_TIMEOUT_MS = DEFAULT_CURSOR_MOTION.idleDelayMs;

export function getPressScale(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  return 0.85 + 0.15 * eased;
}

/**
 * Time-aware cubic Hermite between p1 (t1) and p2 (t2). The tangent at each point is
 * its neighbours' slope PER MILLISECOND (a non-uniform Catmull-Rom), so the speed is
 * continuous across samples however unevenly they are spaced in time. (A uniform
 * Catmull-Rom assumes equal spacing: with real event timing it kinked the speed at
 * every sample, which shows as micro-stutter on a smooth sweep.)
 */
function hermiteTime(
  p0: number, t0: number,
  p1: number, t1: number,
  p2: number, t2: number,
  p3: number, t3: number,
  s: number
): number {
  const h = t2 - t1;
  if (!(h > 0)) return p1;
  const m1 = (p2 - p0) / Math.max(1e-6, t2 - t0);
  const m2 = (p3 - p1) / Math.max(1e-6, t3 - t1);
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p1 + (s3 - 2 * s2 + s) * h * m1 + (-2 * s3 + 3 * s2) * p2 + (s3 - s2) * h * m2;
}

/** The drawn cursor, stepped once at a fixed 120 Hz over the recording and read by time. */
interface MotionTrack {
  t0: number; steps: number; x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array; tilt: Float64Array; press: Float64Array;
  /** jumpAt[s]: the time the cursor jumped (re-entry, removed silence) between step s-1 and step s; NaN when it did not. */
  jumpAt: Float64Array;
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
  /** Times at which the pointer came back onto the page (after a leave or a gap): the cursor jumps there. */
  private reentryTimes: number[] = [];
  private motion: CursorMotionSettings = { ...DEFAULT_CURSOR_MOTION };
  /**
   * The drawn cursor's springs (x, y, velocity, tilt, press), stepped once at a fixed
   * 120 Hz over the recording and read by time. Rebuilt lazily when the data, the
   * filter, the cuts or the motion settings change.
   */
  private motionTrack: MotionTrack | null = null;
  private engineKind: CursorEngineKind = CURSOR_ENGINE;
  /** 'solve' engine: the solved path. Depends only on the samples, clicks, presses and smoothing (not on cuts or motion). */
  private solveTrack: CursorSolveTrack | null = null;
  /** 'solve' engine: per click, how far (dx, dy) the solved path is from it at its time (NaN = not on the track). */
  private clickPinError: Float64Array | null = null;

  constructor(mousePoints: MousePoint[] = [], clicks: ClickEvent[] = [], pressEvents: PressEvent[] = [], options: CursorSplineOptions = {}) {
    this.setData(mousePoints, clicks, pressEvents, options);
  }

  public setData(mousePoints: MousePoint[], clicks: ClickEvent[], pressEvents: PressEvent[] = [], options: CursorSplineOptions = {}) {
    this.mousePoints = [...mousePoints].sort((a, b) => a.t - b.t);
    this.filterDirty = true;
    this.motionTrack = null;
    this.solveTrack = null;
    this.reentryTimes = [];
    for (let i = 1; i < this.mousePoints.length; i++) {
      if (this.isBreakBefore(i)) this.reentryTimes.push(this.mousePoints[i].t);
    }
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
    if ((options.engine === 'spline' || options.engine === 'solve') && options.engine !== this.engineKind) {
      this.engineKind = options.engine;
      this.motionTrack = null;
    }
    if (typeof options.smoothing === 'number' && Number.isFinite(options.smoothing)) {
      const next = Math.max(0, Math.min(1, options.smoothing));
      if (next !== this.smoothing) {
        this.filterDirty = true;
        this.solveTrack = null;
        this.motionTrack = null;
      }
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
    // The spline's filters are only built for the spline (switching back to it builds them then).
    if (this.filterDirty && this.engineKind === 'spline') {
      this.rebuildFilteredMousePoints();
      this.filterDirty = false;
      this.motionTrack = null;
    }
  }

  public getMotionSettings(): CursorMotionSettings {
    return { ...this.motion };
  }

  /** True when the pointer was off the page between sample i-1 and sample i. */
  private isBreakBefore(i: number): boolean {
    const prev = this.mousePoints[i - 1];
    const curr = this.mousePoints[i];
    return Boolean(prev && curr) && (prev.l === 1 || curr.t - prev.t > CURSOR_BREAK_MS);
  }

  /**
   * Build a centred, zero-phase trajectory before the spline.
   *
   * Adaptive: where the cursor moves fast it is smoothed lightly (sigma from the
   * Smoothing setting), where it is slow or still it is averaged over a much wider
   * window, so hand tremor and sensor jitter never reach the drawn cursor while real
   * moves keep their shape. Every pass is centred, so none adds lag.
   *
   * The average is taken over TIME, not over samples: the recorded path (linear
   * between samples) is evaluated on an even FILTER_GRID_MS grid inside the window.
   * Real events are unevenly spaced; averaging the samples themselves leaned towards
   * wherever they were denser, a random shift on every moving sample (wobble).
   * A window never reaches across a moment the pointer was off the page: each
   * on-page stretch is smoothed on its own and held at its ends.
   */
  private rebuildFilteredMousePoints(): void {
    if (this.mousePoints.length === 0 || this.smoothing <= 0) {
      this.filteredMousePoints = this.mousePoints.map((point) => ({ ...point }));
      return;
    }

    const maxCoordinate = this.mousePoints.reduce((max, point) => Math.max(max, Math.abs(point.x), Math.abs(point.y)), 0);
    const pxPerUnit = maxCoordinate <= 1.01 ? 1920 : 1;
    const points = this.mousePoints;
    const n = points.length;
    const narrowSigma = 18 + this.smoothing * 55;
    const wideSigma = Math.max(100, narrowSigma * 1.9);

    // On-page stretches: [segFirst[i], segLast[i]] is the stretch sample i belongs to.
    const segFirst = new Int32Array(n);
    const segLast = new Int32Array(n);
    let first = 0;
    for (let i = 0; i <= n; i++) {
      if (i === n || (i > 0 && this.isBreakBefore(i))) {
        for (let k = first; k < i; k++) { segFirst[k] = first; segLast[k] = i - 1; }
        first = i;
      }
    }

    const pass = (sigmaMs: number) => {
      const K = Math.max(1, Math.ceil((sigmaMs * 3) / FILTER_GRID_MS));
      const weights = new Float64Array(K * 2 + 1);
      let total = 0;
      for (let k = -K; k <= K; k++) {
        const w = Math.exp(-0.5 * ((k * FILTER_GRID_MS) / sigmaMs) ** 2);
        weights[k + K] = w;
        total += w;
      }
      for (let k = 0; k < weights.length; k++) weights[k] /= total;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const a = segFirst[i];
        const b = segLast[i];
        const ti = points[i].t;
        const startT = ti - K * FILTER_GRID_MS;
        // j: the last sample of the stretch at or before the window's start.
        let j = i;
        while (j > a && points[j].t > startT) j--;
        let x = 0;
        let y = 0;
        for (let k = -K; k <= K; k++) {
          const tq = ti + k * FILTER_GRID_MS;
          let vx: number;
          let vy: number;
          if (tq <= points[a].t) {
            vx = points[a].x; vy = points[a].y;
          } else if (tq >= points[b].t) {
            vx = points[b].x; vy = points[b].y;
          } else {
            while (j < b && points[j + 1].t <= tq) j++;
            const p = points[j];
            const q = points[Math.min(b, j + 1)];
            const span = q.t - p.t;
            const r = span > 0 ? (tq - p.t) / span : 0;
            vx = p.x + (q.x - p.x) * r;
            vy = p.y + (q.y - p.y) * r;
          }
          const w = weights[k + K];
          x += vx * w;
          y += vy * w;
        }
        xs[i] = x;
        ys[i] = y;
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
    for (let i = 0; i < n; i++) {
      const a = Math.max(segFirst[i], i - 1);
      const b = Math.min(segLast[i], i + 1);
      const dt = Math.max(1, points[b].t - points[a].t) / 1000;
      const speed = a === b ? 0 : Math.hypot(wide.xs[b] - wide.xs[a], wide.ys[b] - wide.ys[a]) * pxPerUnit / dt;
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

  /**
   * 0..1: is the pointer on the page at this time? After a leave marker the cursor fades
   * out over CURSOR_LEAVE_FADE_MS and stays hidden until the next sample (it came back).
   */
  private presenceAt(timeMs: number): number {
    const pts = this.mousePoints;
    if (pts.length === 0) return 1;
    let lo = 0;
    let hi = pts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= timeMs) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (found < 0 || pts[found].l !== 1) return 1;
    const since = timeMs - pts[found].t;
    return Math.max(0, 1 - since / CURSOR_LEAVE_FADE_MS);
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
    return this.idleOpacityAt(timeMs) * this.presenceAt(timeMs);
  }

  private idleOpacityAt(timeMs: number): number {
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
    if (this.engineKind === 'solve') return this.getSolvedCursorAt(timeMs, true);
    const tracked = this.getTrackedCursorAt(timeMs);
    const track = this.ensureMotionTrack();
    if (!track || !Number.isFinite(timeMs)) return tracked;
    const f = (timeMs - track.t0) / SPRING_STEP_MS;
    if (f <= 0 || f >= track.steps) return tracked;
    const i = Math.floor(f);
    // A jump between these two steps: the cursor is on one side of it, never drawn in between.
    const jump = track.jumpAt[i + 1];
    const r = Number.isNaN(jump) ? f - i : timeMs < jump ? 0 : 1;
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
    // 'solve': the path (and its velocity) comes from the solve; only tilt and press are springs.
    const solved = this.engineKind === 'solve' ? this.ensureSolveTrack(t0, steps) : null;
    const x = solved ? solved.x : new Float64Array(steps + 1);
    const y = solved ? solved.y : new Float64Array(steps + 1);
    const vx = solved ? solved.vx : new Float64Array(steps + 1);
    const vy = solved ? solved.vy : new Float64Array(steps + 1);
    const tilt = new Float64Array(steps + 1);
    const press = new Float64Array(steps + 1);
    const jumpAt = solved ? solved.jumpAt : new Float64Array(steps + 1).fill(NaN);

    const k = CURSOR_TIGHT_STIFFNESS + (CURSOR_LOOSE_STIFFNESS - CURSOR_TIGHT_STIFFNESS) * (m.sway / 100);
    const start = solved ? null : this.getTrackedCursorAt(t0);
    const sx = createSpring(k, dampingFor(k), start ? start.x : 0);
    const sy = createSpring(k, dampingFor(k), start ? start.y : 0);
    const st = createSpring(CURSOR_TILT_STIFFNESS, dampingFor(CURSOR_TILT_STIFFNESS), 0);
    const sp = createSpring(CURSOR_PRESS_STIFFNESS, dampingFor(CURSOR_PRESS_STIFFNESS, CURSOR_PRESS_DAMPING_RATIO), 0);
    const pxPerUnit = this.mousePoints.every((p) => Math.abs(p.x) <= 1.01 && Math.abs(p.y) <= 1.01) ? 1920 : 1;
    const pressed = this.buildPressedLookup();
    const dt = SPRING_STEP_MS / 1000;

    let nextReentry = 0;
    for (let s = 0; s <= steps; s++) {
      const t = t0 + s * SPRING_STEP_MS;
      let leanVelocity: number;
      if (solved) {
        leanVelocity = solved.vx[s];
      } else {
        const target = this.getTrackedCursorAt(t);
        // The pointer came back onto the page: the cursor is there at once, it does not glide in.
        let reentered = false;
        while (nextReentry < this.reentryTimes.length && this.reentryTimes[nextReentry] <= t) {
          jumpAt[s] = this.reentryTimes[nextReentry];
          nextReentry++;
          reentered = true;
        }
        if (reentered) {
          sx.snap(target.x);
          sy.snap(target.y);
        }
        // A cut is a jump of the playhead: the cursor is there at once, it does not fly across.
        const cut = this.cutRanges.find((range) => t >= range.startTime && t <= range.endTime + 80);
        if (cut) {
          if (cut.startTime > t - SPRING_STEP_MS) jumpAt[s] = cut.startTime;
          sx.snap(target.x);
          sy.snap(target.y);
        }
        x[s] = sx.value;
        y[s] = sy.value;
        vx[s] = sx.velocity;
        vy[s] = sy.velocity;
        sx.step(target.x, dt);
        sy.step(target.y, dt);
        leanVelocity = sx.velocity;
      }
      tilt[s] = st.value;
      press[s] = sp.value;
      // Velocity-driven lean: speed to the right leans right, clamped to the user's angle.
      const lean = m.tiltEnabled ? Math.max(-m.maxTiltDeg, Math.min(m.maxTiltDeg, leanVelocity * pxPerUnit * CURSOR_TILT_GAIN)) : 0;
      st.step(lean, dt);
      sp.step(m.pressEnabled && pressed(t) ? m.pressDepth : 0, dt);
    }
    this.motionTrack = { t0, steps, x, y, vx, vy, tilt, press, jumpAt };
    if (solved) this.clickPinError = this.measureClickPinError(this.motionTrack);
    return this.motionTrack;
  }

  /** 'solve' engine: the solved path on the track grid, solved once per data / smoothing change. */
  private ensureSolveTrack(t0: number, steps: number): CursorSolveTrack {
    if (this.solveTrack && this.solveTrack.x.length === steps + 1) return this.solveTrack;
    const n = this.mousePoints.length;
    // On-page stretches, by the same break rule as everything else (leave marker or CURSOR_BREAK_MS gap).
    const stretches: Array<[number, number]> = [];
    let first = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || this.isBreakBefore(i)) {
        stretches.push([first, i - 1]);
        first = i;
      }
    }
    const constraints = [...this.clicks, ...this.pressEvents]
      .filter((e) => Number.isFinite(e.t) && Number.isFinite(e.x) && Number.isFinite(e.y))
      .map((e) => ({ t: e.t, x: e.x, y: e.y }))
      .sort((a, b) => a.t - b.t);
    const normalized = this.mousePoints.every((p) => Math.abs(p.x) <= 1.01 && Math.abs(p.y) <= 1.01);
    this.solveTrack = solveCursorTrack({
      points: this.mousePoints,
      stretches,
      constraints,
      t0,
      stepMs: SPRING_STEP_MS,
      steps,
      smoothing: this.smoothing,
      pxX: normalized ? 1920 : 1,
      pxY: normalized ? 1080 : 1
    });
    const tm = this.solveTrack.timing;
    console.info(`[SmoothStudio] Cursor solve: ${tm.samples} samples in ${stretches.length} stretch(es), ${tm.totalMs.toFixed(1)} ms (factor ${tm.factorMs.toFixed(1)} ms, x ${tm.solveXMs.toFixed(1)} ms, y ${tm.solveYMs.toFixed(1)} ms).`);
    return this.solveTrack;
  }

  /** Read the cursor track at a time: linear between steps, never across a jump (re-entry, cut). */
  private readTrack(track: MotionTrack, timeMs: number): { x: number; y: number; vx: number; vy: number } {
    const f = (timeMs - track.t0) / SPRING_STEP_MS;
    if (!(f > 0)) return { x: track.x[0], y: track.y[0], vx: 0, vy: 0 };
    if (f >= track.steps) return { x: track.x[track.steps], y: track.y[track.steps], vx: 0, vy: 0 };
    const i = Math.floor(f);
    const jump = track.jumpAt[i + 1];
    const r = Number.isNaN(jump) ? f - i : timeMs < jump ? 0 : 1;
    const read = (a: Float64Array) => a[i] + (a[i + 1] - a[i]) * r;
    return { x: read(track.x), y: read(track.y), vx: read(track.vx), vy: read(track.vy) };
  }

  /**
   * 'solve' engine: the solve passes through every click, so the click pin is only a
   * safety net. Per click: how far the solved path is from it as it lands. Warns when
   * any is more than SOLVE_CLICK_PIN_WARN_PX (the pin would then visibly move the cursor).
   */
  private measureClickPinError(track: MotionTrack): Float64Array {
    const err = new Float64Array(this.clicks.length * 2).fill(NaN);
    const normalized = this.mousePoints.every((p) => Math.abs(p.x) <= 1.01 && Math.abs(p.y) <= 1.01);
    const sx = normalized ? 1920 : 1;
    const sy = normalized ? 1080 : 1;
    let worst = 0;
    let over = 0;
    const tEnd = track.t0 + track.steps * SPRING_STEP_MS;
    this.clicks.forEach((c, i) => {
      if (!Number.isFinite(c.t) || c.t < track.t0 || c.t > tEnd) return;
      const p = this.readTrack(track, c.t);
      err[2 * i] = c.x - p.x;
      err[2 * i + 1] = c.y - p.y;
      const px = Math.hypot(err[2 * i] * sx, err[2 * i + 1] * sy);
      if (px > SOLVE_CLICK_PIN_WARN_PX) over++;
      worst = Math.max(worst, px);
    });
    if (over > 0) {
      console.warn(`[SmoothStudio] Cursor solve: ${over} click(s) missed by more than ${SOLVE_CLICK_PIN_WARN_PX} px (worst ${worst.toFixed(2)} px); the ±${SOLVE_CLICK_PIN_MS} ms click pin corrects them.`);
    }
    return err;
  }

  /** 'solve' engine: the drawn cursor (and, without the pin, the camera's path). */
  private getSolvedCursorAt(timeMs: number, clickPin: boolean): InterpolatedCursor {
    let opacity = this.getCursorOpacityAt(timeMs);
    const track = this.ensureMotionTrack();
    if (!track || !Number.isFinite(timeMs)) return { x: 0, y: 0, style: 'default', vx: 0, vy: 0, speed: 0, opacity };
    // A removed silence: the playhead jumps over it and the cursor fades back in (as with the spline).
    const seamCut = this.cutRanges.find((range) => timeMs >= range.startTime && timeMs <= range.endTime + 80);
    if (seamCut) opacity *= timeMs <= seamCut.endTime ? 0 : Math.min(1, (timeMs - seamCut.endTime) / 80);
    const p = this.readTrack(track, timeMs);
    let x = p.x;
    let y = p.y;
    if (clickPin && this.clickPinError) {
      // Nearest click within ±SOLVE_CLICK_PIN_MS: shift by the solve's miss at that click, faded in and out.
      let lo = 0;
      let hi = this.clicks.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.clicks[mid].t < timeMs - SOLVE_CLICK_PIN_MS) lo = mid + 1; else hi = mid;
      }
      let best = -1;
      for (let i = lo; i < this.clicks.length && this.clicks[i].t <= timeMs + SOLVE_CLICK_PIN_MS; i++) {
        if (Number.isNaN(this.clickPinError[2 * i])) continue;
        if (best < 0 || Math.abs(this.clicks[i].t - timeMs) < Math.abs(this.clicks[best].t - timeMs)) best = i;
      }
      if (best >= 0) {
        const nrm = 1 - Math.abs(this.clicks[best].t - timeMs) / SOLVE_CLICK_PIN_MS;
        const w = nrm * nrm * (3 - 2 * nrm);
        x += this.clickPinError[2 * best] * w;
        y += this.clickPinError[2 * best + 1] * w;
      }
    }
    return { x, y, style: this.styleAt(timeMs), vx: p.vx, vy: p.vy, speed: Math.hypot(p.vx, p.vy), opacity };
  }

  /** The recorded CSS cursor at a time (the sample at or before it). */
  private styleAt(timeMs: number): string {
    const pts = this.mousePoints;
    let lo = 0;
    let hi = pts.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= timeMs) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return pts[found]?.c || 'default';
  }

  /** The tracked (filtered, unsprung) cursor path: what the drawn cursor and the camera chase. */
  public getTrackedCursorAt(timeMs: number): InterpolatedCursor {
    // The solve has no spring: the drawn cursor and the camera follow the same solved path.
    if (this.engineKind === 'solve') return this.getSolvedCursorAt(timeMs, false);
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
      // The first sample at or after the cut's end (binary search: this runs for every spring step inside a cut).
      let lo = 0;
      let hi = this.mousePoints.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.mousePoints[mid].t < seamCut.endTime) lo = mid + 1; else hi = mid;
      }
      const rawPostCut = this.mousePoints[lo];
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

    // Off the page (left, or no sample for CURSOR_BREAK_MS): the cursor stays where it was
    // last seen until it is back, instead of sliding towards where it reappears.
    const offPage = p1.l === 1 || segmentDuration > CURSOR_BREAK_MS;

    // A time-aware spline for continuous motion; a straight line across a pause (> 120 ms
    // between samples) so the spline never overshoots into the stillness.
    let x: number;
    let y: number;
    const linearX = offPage ? p1.x : p1.x + (p2.x - p1.x) * clampedT;
    const linearY = offPage ? p1.y : p1.y + (p2.y - p1.y) * clampedT;
    if (offPage || segmentDuration > 120) {
      x = linearX;
      y = linearY;
    } else {
      // Neighbours across a pause do not shape this segment: use the segment's own end instead.
      const q0 = p1.t - p0.t > 120 || i0 === i1 ? p1 : p0;
      const q3 = p3.t - p2.t > 120 || i3 === i2 ? p2 : p3;
      const t0 = q0 === p1 ? p1.t - segmentDuration : q0.t;
      const t3 = q3 === p2 ? p2.t + segmentDuration : q3.t;
      const splineX = hermiteTime(q0.x, t0, p1.x, p1.t, p2.x, p2.t, q3.x, t3, clampedT);
      const splineY = hermiteTime(q0.y, t0, p1.y, p1.t, p2.y, p2.t, q3.y, t3, clampedT);
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
    if (current.opacity <= 0.001) return [];
    const speedPx = current.x <= 1.0 ? current.speed * 1920 : current.speed;
    const blur = blurRamp(speedPx);
    if (blur <= 0.001) return [];
    const trail: InterpolatedCursor[] = [];
    const sampleMs = 1000 / Math.max(30, outputFps);
    for (let i = 1; i <= maxSamples; i++) {
      const sampleTime = timeMs - sampleMs * i;
      if (this.cutRanges.some((range) => sampleTime <= range.endTime + CURSOR_BLUR_JUMP_GUARD_MS && timeMs >= range.startTime)) return [];
      // No streak across a jump back onto the page.
      if (this.reentryTimes.some((r) => r > sampleTime && r <= timeMs)) return trail;
      const sample = this.getCursorAt(sampleTime);
      trail.push({ ...sample, opacity: current.opacity * (1 - i / (maxSamples + 1)) * 0.24 * blur });
    }
    return trail;
  }

  /** True next to a cut or a jump back onto the page: no motion streak there. */
  private motionJumpNear(timeMs: number): boolean {
    if (this.cutRanges.some((range) => timeMs >= range.startTime && timeMs <= range.endTime + CURSOR_BLUR_JUMP_GUARD_MS)) return true;
    return this.reentryTimes.some((r) => r > timeMs - CURSOR_BLUR_JUMP_GUARD_MS && r <= timeMs);
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
    trailPoints: Array<{ x: number; y: number; opacity: number }> = [],
    outputFps: number = 60
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

    // Handles normalized (0..1) speeds (scaled to ~1920px equivalent) as well as legacy pixel speeds.
    // Onset 800 px/s, full 1200 px/s; never on a <=20 fps GIF or across a cut / re-entry.
    const effectiveSpeed = cursor.x <= 1.0 ? cursor.speed * 1920 : cursor.speed;
    const blur = outputFps <= 20 || this.motionJumpNear(currentTimeMs) ? 0 : blurRamp(effectiveSpeed);
    if (blur > 0.001) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02) * cursorScale * outputScale * blur;
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
      ctx.globalAlpha = Math.min(1, ctx.globalAlpha * blur);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor (screen space: its size never follows the zoom)
    ctx.translate(screenX, screenY);
    const styleMotion = CURSOR_STYLE_MOTION[cursor.style] || CURSOR_STYLE_FALLBACK;
    // Shape-aware lean: full around the hotspot, none for text, half around the palm for grab.
    const tiltDeg = styleMotion.tilt * this.getTiltAt(currentTimeMs);
    if (pressScale < 0.985) {
      ctx.beginPath();
      ctx.arc(0, 0, 18 * cursorScale * outputScale, 0, Math.PI * 2);
      ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(192, 132, 252, 0.30)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2 * outputScale;
      ctx.globalAlpha *= 0.7;
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, Math.min(1, cursorOpacity));
    }
    const styleScale = cursorScale * pressScale * outputScale;
    if (Math.abs(tiltDeg) > 0.01) {
      const [pivotX, pivotY] = styleMotion.pivot;
      // Rotate about the style's pivot: T(p*s) S(s) R T(-p).
      ctx.translate(pivotX * styleScale, pivotY * styleScale);
      ctx.scale(styleScale, styleScale);
      ctx.rotate((tiltDeg * Math.PI) / 180);
      ctx.translate(-pivotX, -pivotY);
    } else if (styleScale !== 1.0) {
      ctx.scale(styleScale, styleScale);
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
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(0, 17);
      ctx.strokeStyle = '#0F1117';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

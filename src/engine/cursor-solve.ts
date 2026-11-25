import type { MousePoint } from '../types/telemetry';
import { createBandedMatrix, bandedCholeskyFactor, bandedCholeskySolve } from './banded-cholesky';

/**
 * The 'solve' cursor engine: the drawn cursor path as ONE constrained minimum-jerk solve.
 *
 * For each on-page stretch and each axis, on the 120 Hz track grid, the path x minimises
 *
 *     Σ wᵢ (xᵢ − x̂ᵢ)²  +  Σ λᵣ (x[r+3] − 3 x[r+2] + 3 x[r+1] − x[r])²
 *       stay near the       squared discrete jerk
 *       recorded path
 *
 * where x̂ is the recorded path resampled on the grid. The gradient is zero where
 * (W + DᵀΛD) x = W x̂: symmetric positive definite with bandwidth 3, solved exactly by a
 * banded Cholesky. No iteration, no lag (the solve is not causal), fully deterministic.
 *
 * - Clicks and presses are hard constraints (weight 1e6) at their EXACT time: the
 *   renderer interpolates linearly between grid samples, so the constraint is on that
 *   interpolated value, (1 − α) x[i] + α x[i+1] = click, not on the nearest sample. The
 *   drawn path passes through the click as it lands and approaches and leaves it smoothly.
 * - λ varies along the path with the speed (measured on the RAW samples, with a look-ahead
 *   envelope): sharp where the cursor moves fast, heavily smoothed where it is slow.
 * - Each stretch is solved on its own: nothing crosses a moment the pointer was off the page.
 *   DᵀΛD is accumulated row by row, which gives the natural boundary conditions at the ends.
 */

export type CursorEngineKind = 'spline' | 'solve';
/** Engine used unless the editor picks another: the solve is the default (the spline stays selectable). */
export const CURSOR_ENGINE: CursorEngineKind = 'solve';

/** Data weights. */
const W_FREE = 1;
const W_DWELL = 50;
const W_EDGE = 5;
const W_CLICK = 1e6;
/** Speed envelope (px/s of a 1920 x 1080 frame): under DWELL = dwell; λ goes from still to fast between them. */
const DWELL_PX_S = 60;
const SHARP_PX_S = 900;
/** The envelope is the max speed over ±ENVELOPE_MS (look-ahead is free offline), smoothed with SELECTOR_SIGMA_MS. */
const ENVELOPE_MS = 60;
const SELECTOR_SIGMA_MS = 30;
/**
 * λ at the default smoothing, as the Gaussian window it matches: fast motion and stillness.
 * Still = 100 ms (λ ≈ 3.7e6, the spline's still window). Fast = 12 ms (λ ≈ 11), not the
 * spline's 51 ms (λ ≈ 6.6e4): a 51 ms window keeps only half the peak speed of a 300 px
 * flick made in 150 ms (so does the spline); 12 ms keeps 98 % of it, and noise at speed
 * barely changes (2 px noise at 800 px/s: 0.63 -> 0.90 px rms).
 */
export const SOLVE_SIGMA_FAST_MS = 12;
export const SOLVE_SIGMA_STILL_MS = 100;

/**
 * λ whose half-power cutoff matches a Gaussian of this sigma on a grid of this step.
 * Gaussian half power: ω_c = √ln2 / σ ≈ 0.83 / σ. Smoother: 1 / (1 + λ (ω h)⁶) = 1/√2
 * at ω_c, so λ = (√2 − 1) / (ω_c h)⁶ ≈ 0.41 / (ω_c h)⁶.
 */
export function lambdaForSigma(sigmaMs: number, stepMs: number): number {
  const omegaC = 0.83 / (sigmaMs / 1000);
  return 0.41 / Math.pow(omegaC * (stepMs / 1000), 6);
}

/**
 * Cursor Smoothing (0..1) as a multiplier on both λ bounds. 0 = the recorded path, 0.6
 * (the default) = 1. The matched window follows the spline engine's (18 + 55 s ms), so
 * the slider means what it meant before; λ grows as the window's 6th power, so the
 * slider is logarithmic in λ (about three decades over its range).
 */
export function smoothingMultiplier(smoothing: number): number {
  if (!(smoothing > 0)) return 0;
  return Math.pow((18 + 55 * Math.min(1, smoothing)) / 51, 6);
}

export interface SolveConstraint {
  t: number;
  x: number;
  y: number;
}

export interface CursorSolveInput {
  /** Recorded samples, sorted by time. */
  points: MousePoint[];
  /** [first, last] index into points of each on-page stretch, in time order. */
  stretches: Array<[number, number]>;
  /** Exact click / press positions, sorted by time. */
  constraints: SolveConstraint[];
  /** The grid: sample s is at t0 + s * stepMs, s = 0..steps. */
  t0: number;
  stepMs: number;
  steps: number;
  /** Cursor Smoothing setting (0..1). */
  smoothing: number;
  /** Pixels per coordinate unit on each axis (1920 / 1080 for normalised coordinates). */
  pxX: number;
  pxY: number;
  /** Overrides of the λ bounds (default: from SOLVE_SIGMA_FAST_MS / SOLVE_SIGMA_STILL_MS and the smoothing). */
  lambdaFast?: number;
  lambdaStill?: number;
}

export interface CursorSolveTrack {
  x: Float64Array;
  y: Float64Array;
  /** Velocity of the solved path (coordinate units per second). */
  vx: Float64Array;
  vy: Float64Array;
  /** jumpAt[s]: the time the pointer came back onto the page between sample s-1 and s; NaN when it did not. */
  jumpAt: Float64Array;
  timing: { samples: number; totalMs: number; buildMs: number; factorMs: number; solveXMs: number; solveYMs: number };
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function smoothstep(edge0: number, edge1: number, v: number): number {
  const c = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
  return c * c * (3 - 2 * c);
}

export function solveCursorTrack(input: CursorSolveInput): CursorSolveTrack {
  const started = clock();
  const { points, stretches, constraints, t0, stepMs, steps, pxX, pxY } = input;
  const n = Math.max(0, steps + 1);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const jumpAt = new Float64Array(n).fill(NaN);
  const timing = { samples: 0, totalMs: 0, buildMs: 0, factorMs: 0, solveXMs: 0, solveYMs: 0 };
  if (n === 0 || points.length === 0) return { x, y, vx, vy, jumpAt, timing };

  const mult = smoothingMultiplier(input.smoothing);
  const lambdaFast = input.lambdaFast ?? lambdaForSigma(SOLVE_SIGMA_FAST_MS, stepMs) * mult;
  const lambdaStill = input.lambdaStill ?? lambdaForSigma(SOLVE_SIGMA_STILL_MS, stepMs) * mult;
  const smooth = lambdaFast > 0 && lambdaStill > 0;
  const stepS = stepMs / 1000;

  let filled = 0; // grid samples before this index are written
  let holdX = points[0].x;
  let holdY = points[0].y;
  let ci = 0;

  for (let k = 0; k < stretches.length; k++) {
    const [a, b] = stretches[k];
    const ta = points[a].t;
    const tb = points[b].t;
    const sFirst = Math.max(filled, Math.ceil((ta - t0) / stepMs - 1e-9));
    const sLast = Math.min(steps, Math.floor((tb - t0) / stepMs + 1e-9));
    // Off the page until this stretch: the cursor holds where it was last seen, then jumps here.
    for (let s = filled; s < Math.min(sFirst, n); s++) { x[s] = holdX; y[s] = holdY; }
    if (k > 0 && sFirst < n) jumpAt[sFirst] = ta;
    filled = Math.max(filled, Math.min(sFirst, n));

    while (ci < constraints.length && constraints[ci].t < ta) ci++;
    let cEnd = ci;
    while (cEnd < constraints.length && constraints[cEnd].t <= tb) cEnd++;
    const cons = constraints.slice(ci, cEnd);
    ci = cEnd;

    const N = sLast - sFirst + 1;
    if (N <= 0) { holdX = points[b].x; holdY = points[b].y; continue; }

    // The recorded path (straight between samples) on the grid.
    const hx = new Float64Array(N);
    const hy = new Float64Array(N);
    let j = a;
    for (let s = 0; s < N; s++) {
      const t = t0 + (sFirst + s) * stepMs;
      while (j < b && points[j + 1].t <= t) j++;
      if (j >= b) { hx[s] = points[b].x; hy[s] = points[b].y; continue; }
      const p = points[j];
      const q = points[j + 1];
      const span = q.t - p.t;
      const r = span > 0 ? Math.max(0, Math.min(1, (t - p.t) / span)) : 1;
      hx[s] = p.x + (q.x - p.x) * r;
      hy[s] = p.y + (q.y - p.y) * r;
    }

    let solvedX: Float64Array = hx;
    let solvedY: Float64Array = hy;
    // Fewer than 4 samples cannot form a third difference: the recorded path as it is.
    if (smooth && N >= 4) {
      const buildStart = clock();
      // Raw speed of each recorded segment, as the max over each grid cell it touches.
      const cell = new Float64Array(N);
      for (let i = a; i < b; i++) {
        const p = points[i];
        const q = points[i + 1];
        const dt = q.t - p.t;
        if (!(dt > 0)) continue;
        const v = Math.hypot((q.x - p.x) * pxX, (q.y - p.y) * pxY) / (dt / 1000);
        const lo = Math.max(0, Math.ceil((p.t - t0) / stepMs - 0.5) - sFirst);
        const hi = Math.min(N - 1, Math.floor((q.t - t0) / stepMs + 0.5) - sFirst);
        for (let s = lo; s <= hi; s++) if (v > cell[s]) cell[s] = v;
      }
      // Look-ahead envelope: max over ±ENVELOPE_MS.
      const R = Math.max(1, Math.round(ENVELOPE_MS / stepMs));
      const env = new Float64Array(N);
      for (let s = 0; s < N; s++) {
        let m = 0;
        const hiK = Math.min(N - 1, s + R);
        for (let q = Math.max(0, s - R); q <= hiK; q++) if (cell[q] > m) m = cell[q];
        env[s] = m;
      }
      // Selector: a light Gaussian of the envelope (no chatter between λ levels).
      const sig = SELECTOR_SIGMA_MS / stepMs;
      const rad = Math.ceil(sig * 3);
      const g = new Float64Array(rad * 2 + 1);
      let gSum = 0;
      for (let q = -rad; q <= rad; q++) { g[q + rad] = Math.exp(-0.5 * (q / sig) ** 2); gSum += g[q + rad]; }
      const lnFast = Math.log(lambdaFast);
      const lnStill = Math.log(lambdaStill);
      const lam = new Float64Array(N);
      for (let s = 0; s < N; s++) {
        let v = 0;
        for (let q = -rad; q <= rad; q++) v += g[q + rad] * env[Math.max(0, Math.min(N - 1, s + q))];
        v /= gSum;
        // Blended in log λ: the smoothing time scales as λ^(1/6), so a linear blend would stay
        // near the still level until close to SHARP_PX_S.
        lam[s] = Math.exp(lnStill + (lnFast - lnStill) * smoothstep(DWELL_PX_S, SHARP_PX_S, v));
      }

      const A = createBandedMatrix(N, 3);
      const band = A.band;
      const bx = new Float64Array(N);
      const by = new Float64Array(N);
      for (let s = 0; s < N; s++) {
        let w = env[s] < DWELL_PX_S ? W_DWELL : W_FREE;
        if (s === 0 || s === N - 1) w = Math.max(w, W_EDGE); // stretch ends (a re-entry is a stretch start)
        band[s] += w;
        bx[s] = w * hx[s];
        by[s] = w * hy[s];
      }
      // Third-difference rows, accumulated into the band: Σ λᵣ dᵣ dᵣᵀ with dᵣ = [−1, 3, −3, 1] at r..r+3.
      // λ of a row is the MIN over the samples it touches: fast motion anywhere keeps the row sharp.
      const coef = [-1, 3, -3, 1];
      for (let r = 0; r + 3 < N; r++) {
        const l = Math.min(lam[r], lam[r + 1], lam[r + 2], lam[r + 3]);
        for (let p = 0; p < 4; p++) {
          for (let q = 0; q <= p; q++) band[(p - q) * N + r + q] += l * coef[p] * coef[q];
        }
      }
      // Clicks and presses: hard constraints on the interpolated path at their exact time.
      // Constraints closer than one grid step are one (two different points in one cell would kink the path).
      for (let g0 = 0; g0 < cons.length;) {
        let g1 = g0 + 1;
        while (g1 < cons.length && cons[g1].t - cons[g0].t < stepMs) g1++;
        let ct = 0, cx = 0, cy = 0;
        for (let q = g0; q < g1; q++) { ct += cons[q].t; cx += cons[q].x; cy += cons[q].y; }
        const cnt = g1 - g0;
        ct /= cnt; cx /= cnt; cy /= cnt;
        g0 = g1;
        if (!Number.isFinite(ct) || !Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        const u = (ct - t0) / stepMs - sFirst;
        let i = Math.floor(u);
        let al = u - i;
        if (i < 0) { i = 0; al = 0; }
        if (i >= N - 1) { i = N - 1; al = 0; }
        const w0 = 1 - al;
        band[i] += W_CLICK * w0 * w0;
        bx[i] += W_CLICK * w0 * cx;
        by[i] += W_CLICK * w0 * cy;
        if (al > 0) {
          band[i + 1] += W_CLICK * al * al;
          band[N + i] += W_CLICK * w0 * al;
          bx[i + 1] += W_CLICK * al * cx;
          by[i + 1] += W_CLICK * al * cy;
        }
      }
      const factorStart = clock();
      timing.buildMs += factorStart - buildStart;
      if (bandedCholeskyFactor(A)) {
        const xStart = clock();
        timing.factorMs += xStart - factorStart;
        solvedX = bandedCholeskySolve(A, bx);
        const yStart = clock();
        timing.solveXMs += yStart - xStart;
        solvedY = bandedCholeskySolve(A, by);
        timing.solveYMs += clock() - yStart;
        timing.samples += N;
      } else {
        console.warn('[SmoothStudio] Cursor solve: a stretch did not factor; it keeps its recorded path.', { samples: N });
      }
    }

    for (let s = 0; s < N; s++) {
      x[sFirst + s] = solvedX[s];
      y[sFirst + s] = solvedY[s];
    }
    // Velocity of the solved path: central differences inside the stretch, one-sided at its ends.
    if (N > 1) {
      for (let s = 0; s < N; s++) {
        const lo = Math.max(0, s - 1);
        const hi = Math.min(N - 1, s + 1);
        vx[sFirst + s] = (solvedX[hi] - solvedX[lo]) / ((hi - lo) * stepS);
        vy[sFirst + s] = (solvedY[hi] - solvedY[lo]) / ((hi - lo) * stepS);
      }
    }
    holdX = solvedX[N - 1];
    holdY = solvedY[N - 1];
    filled = sLast + 1;
  }
  for (let s = filled; s < n; s++) { x[s] = holdX; y[s] = holdY; }
  timing.totalMs = clock() - started;
  return { x, y, vx, vy, jumpAt, timing };
}

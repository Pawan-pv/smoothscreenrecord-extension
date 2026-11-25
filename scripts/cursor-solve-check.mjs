#!/usr/bin/env node
/**
 * Acceptance checks for the 'solve' cursor engine (src/engine/cursor-solve.ts) and the
 * banded Cholesky it uses (src/engine/banded-cholesky.ts).
 *
 * Dev-only: never imported by src/, never bundled into dist/. Run by hand:
 *
 *     node scripts/cursor-solve-check.mjs
 *
 * It compiles the four engine modules with the repo's own tsc into a temp directory
 * (CommonJS), loads them, runs the checks and prints a PASS/FAIL table plus the
 * numbers used in CURSOR_SOLVE_REPORT.md. Exits non-zero when a check fails.
 * No network, no new dependencies, no mocks.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEP = 1000 / 120; // the 120 Hz track grid

// ---------------------------------------------------------------------------
// Compile the engine modules (tsc -> temp dir, CommonJS so Node can require them)
// ---------------------------------------------------------------------------
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothstudio-cursor-'));
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const sources = [
  'src/engine/cursor-solve.ts',
  'src/engine/banded-cholesky.ts',
  'src/engine/cursor-spline.ts',
  'src/engine/spring.ts',
  'src/engine/camera-path.ts',
  'src/engine/spring-physics.ts',
  'src/types/telemetry.ts'
].map((f) => path.join(root, f));

try {
  execFileSync(
    process.execPath,
    [tsc, '--ignoreConfig', ...sources, '--outDir', outDir, '--module', 'commonjs',
     '--target', 'es2022', '--skipLibCheck', '--strict', 'false'],
    { stdio: 'pipe' }
  );
} catch (error) {
  console.error('Could not compile the engine modules with tsc.');
  console.error(String(error.stdout ?? ''));
  console.error(String(error.stderr ?? ''));
  process.exit(2);
}

const require = createRequire(path.join(outDir, 'check.cjs'));
const {
  solveCursorTrack, lambdaForSigma, SOLVE_SIGMA_FAST_MS, SOLVE_SIGMA_STILL_MS, smoothingMultiplier
} = require(path.join(outDir, 'engine', 'cursor-solve.js'));
const {
  createBandedMatrix, bandedCholeskyFactor, bandedCholeskySolve
} = require(path.join(outDir, 'engine', 'banded-cholesky.js'));
const {
  CursorSplineEngine, CURSOR_BLUR_ONSET_PX_S, CURSOR_BLUR_FULL_PX_S
} = require(path.join(outDir, 'engine', 'cursor-spline.js'));
const { createSpring, dampingFor } = require(path.join(outDir, 'engine', 'spring.js'));
const {
  buildCameraPath, cameraZoomStiffness, DEFAULT_TRANSITION_MS, ZOOM_SPEEDS, CHAIN_DIP_FLOOR
} = require(path.join(outDir, 'engine', 'camera-path.js'));
const { generateAutoZoomPills, AUTO_ZOOM_CONFIG } = require(path.join(outDir, 'engine', 'spring-physics.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const results = [];
function check(name, detail, ok) {
  results.push({ name, detail, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(12345);
function gaussian() {
  let u = 0, v = 0;
  while (!u) u = random();
  while (!v) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function points(n, at) {
  const out = [];
  for (let s = 0; s < n; s++) {
    const t = s * STEP;
    const p = at(t, s);
    out.push({ t, x: p.x, y: p.y, c: 'default' });
  }
  return out;
}
function solve(pts, options = {}) {
  return solveCursorTrack({
    points: pts,
    stretches: options.stretches ?? [[0, pts.length - 1]],
    constraints: options.constraints ?? [],
    t0: pts.length ? pts[0].t : 0,
    stepMs: STEP,
    steps: options.steps ?? Math.max(0, pts.length - 1),
    smoothing: options.smoothing ?? 0.6,
    pxX: 1,
    pxY: 1,
    lambdaFast: options.lambdaFast,
    lambdaStill: options.lambdaStill
  });
}
function readAt(track, t) {
  const u = t / STEP;
  const i = Math.min(track.x.length - 2, Math.max(0, Math.floor(u)));
  const a = Math.min(1, Math.max(0, u - i));
  return { x: track.x[i] * (1 - a) + track.x[i + 1] * a, y: track.y[i] * (1 - a) + track.y[i + 1] * a };
}
function velocityAt(a, s) {
  const lo = Math.max(0, s - 1);
  const hi = Math.min(a.length - 1, s + 1);
  return (a[hi] - a[lo]) / ((hi - lo) * STEP / 1000);
}
function denseCholesky(A, b) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) throw new Error(`not positive definite at ${i}`);
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}
function allFinite(...arrays) {
  for (const a of arrays) for (const v of a) if (!Number.isFinite(v)) return false;
  return true;
}
/** jumpAt is NaN by design (no jump on that step): every entry must be NaN or finite. */
function jumpAtSane(a) {
  for (const v of a) if (!Number.isNaN(v) && !Number.isFinite(v)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 1. Banded Cholesky vs a dense reference solve
// ---------------------------------------------------------------------------
{
  const n = 200;
  const p = 3;
  const A = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    A[i][i] = 10;
    for (let d = 1; d <= p && i + d < n; d++) {
      const v = random() * 2 - 1;
      A[i][i + d] = v;
      A[i + d][i] = v;
      A[i][i] += Math.abs(v);
      A[i + d][i + d] += Math.abs(v);
    }
  }
  const b = Float64Array.from({ length: n }, () => random() * 10 - 5);
  const m = createBandedMatrix(n, p);
  for (let d = 0; d <= p; d++) for (let j = 0; j + d < n; j++) m.band[d * n + j] = A[j + d][j];
  const okFactor = bandedCholeskyFactor(m);
  const xb = bandedCholeskySolve(m, b.slice());
  const xd = denseCholesky(A, b);
  let err = 0;
  for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(xb[i] - xd[i]));
  check('1. banded Cholesky vs dense (random banded SPD, N=200)',
    `max |x_banded - x_dense| = ${err.toExponential(2)} (need < 1e-9)`, okFactor && err < 1e-9);

  // 1b. the accumulated D^T L D + W band equals a dense build from explicit rows
  const N = 40;
  const lam = Array.from({ length: N - 3 }, () => 1 + random() * 100);
  const w = Array.from({ length: N }, () => (random() < 0.1 ? 50 : 1));
  const D = Array.from({ length: N }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) D[i][i] += w[i];
  const coef = [-1, 3, -3, 1];
  for (let r = 0; r + 3 < N; r++) {
    for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) D[r + a][r + c] += lam[r] * coef[a] * coef[c];
  }
  const m2 = createBandedMatrix(N, 3);
  for (let i = 0; i < N; i++) m2.band[i] += w[i];
  for (let r = 0; r + 3 < N; r++) {
    for (let a = 0; a < 4; a++) for (let c = 0; c <= a; c++) m2.band[(a - c) * N + r + c] += lam[r] * coef[a] * coef[c];
  }
  let bandErr = 0;
  for (let d = 0; d <= 3; d++) for (let j = 0; j + d < N; j++) bandErr = Math.max(bandErr, Math.abs(m2.band[d * N + j] - D[j + d][j]));
  check('1b. D^T L D + W band accumulation matches a dense build',
    `max entry error = ${bandErr.toExponential(2)} (need 0)`, bandErr === 0);
}

// ---------------------------------------------------------------------------
// 2. lambda -> 0 reproduces the recorded path
// ---------------------------------------------------------------------------
{
  const pts = points(300, (t) => ({ x: 500 + 200 * Math.sin(t / 300) + gaussian(), y: 400 + gaussian() }));
  const zero = solve(pts, { lambdaFast: 0, lambdaStill: 0 });
  const tiny = solve(pts, { lambdaFast: 1e-12, lambdaStill: 1e-12 });
  let e0 = 0, e1 = 0;
  for (let s = 0; s < pts.length; s++) {
    e0 = Math.max(e0, Math.abs(zero.x[s] - pts[s].x));
    e1 = Math.max(e1, Math.abs(tiny.x[s] - pts[s].x));
  }
  check('2. lambda -> 0 reproduces x-hat',
    `lambda=0: ${e0.toExponential(2)}, lambda=1e-12: ${e1.toExponential(2)} (need < 1e-6)`, e0 < 1e-6 && e1 < 1e-6);
}

// ---------------------------------------------------------------------------
// 3. lambda -> infinity produces a quadratic (the null space of the third difference)
//    The input carries a quadratic trend; on a purely oscillating input the output
//    collapses to near-constant and R2 is measured against almost no variance.
// ---------------------------------------------------------------------------
{
  const pts = points(200, (t, s) => ({ x: 400 + 0.8 * s + 0.02 * s * s + gaussian() * 2, y: 300 }));
  const track = solve(pts, { lambdaFast: 1e9, lambdaStill: 1e9 });
  const n = pts.length;
  const S = [0, 0, 0, 0, 0];
  const T = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const u = pts[i].t / 1000;
    for (let k = 0; k < 5; k++) S[k] += Math.pow(u, k);
    for (let k = 0; k < 3; k++) T[k] += track.x[i] * Math.pow(u, k);
  }
  const fit = denseCholesky(
    [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]],
    [T[0], T[1], T[2]]
  );
  let mean = 0;
  for (let i = 0; i < n; i++) mean += track.x[i];
  mean /= n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const u = pts[i].t / 1000;
    const f = fit[0] + fit[1] * u + fit[2] * u * u;
    ssRes += (track.x[i] - f) ** 2;
    ssTot += (track.x[i] - mean) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;
  check('3. lambda -> infinity is a quadratic (parabola fit)',
    `R2 = ${r2.toFixed(9)} (need > 0.9999)`, r2 > 0.9999);
}

// ---------------------------------------------------------------------------
// 4. Click constraint: the drawn (interpolated) path passes through the click
// ---------------------------------------------------------------------------
{
  const pts = points(300, (t) => ({ x: 200 + 300 * t / 2000, y: 400 }));
  const tc = 1203.7; // deliberately between two grid samples
  const trueX = 200 + 300 * tc / 2000;
  const cases = [
    { off: 3, smoothing: 0.6 },
    { off: 40, smoothing: 0.6 },
    { off: 200, smoothing: 1 }
  ];
  let worst = 0;
  for (const c of cases) {
    const track = solve(pts, { smoothing: c.smoothing, constraints: [{ t: tc, x: trueX + c.off, y: 402 }] });
    const p = readAt(track, tc);
    worst = Math.max(worst, Math.hypot(p.x - (trueX + c.off), p.y - 402));
  }
  check('4. click constraint (offsets 3/40/200 px, smoothing 0.6/0.6/1)',
    `worst interpolated miss = ${worst.toFixed(4)} px (need < 0.1)`, worst < 0.1);
}

// ---------------------------------------------------------------------------
// 5. Zero lag: 800 px/s ramp + 2 px noise
// ---------------------------------------------------------------------------
const lagMetrics = { solve: 0, spline: {} };
{
  const pts = points(361, (t) => ({ x: 1000 + 800 * t / 1000 + gaussian() * 2, y: 500 + gaussian() * 2 }));
  const track = solve(pts);
  let sum = 0, count = 0;
  for (let s = 20; s < pts.length - 20; s++) {
    sum += track.x[s] - (1000 + 800 * pts[s].t / 1000);
    count++;
  }
  lagMetrics.solve = sum / count;
  for (const sway of [0, 50, 100]) {
    const engine = new CursorSplineEngine(pts, [], [], { engine: 'spline', motion: { sway } });
    let s2 = 0, c2 = 0;
    for (let s = 20; s < pts.length - 20; s++) {
      s2 += engine.getCursorAt(pts[s].t).x - (1000 + 800 * pts[s].t / 1000);
      c2++;
    }
    lagMetrics.spline[sway] = s2 / c2;
  }
  check('5. zero lag on an 800 px/s ramp (solve passes, spring engine fails)',
    `solve ${lagMetrics.solve.toFixed(3)} px (< 0.5); spline sway 50 ${lagMetrics.spline[50].toFixed(2)} px (> 0.5)`,
    Math.abs(lagMetrics.solve) < 0.5 && Math.abs(lagMetrics.spline[50]) > 0.5);
}

// ---------------------------------------------------------------------------
// 6. Tremor rejection: 2 px, 12 Hz on a still path
// ---------------------------------------------------------------------------
const tremorMetrics = { solve: 0, spline: 0 };
{
  const pts = points(361, (t) => ({ x: 1000 + 2 * Math.sin(2 * Math.PI * 12 * t / 1000), y: 500 }));
  const track = solve(pts);
  for (let s = 20; s < pts.length - 20; s++) tremorMetrics.solve = Math.max(tremorMetrics.solve, Math.abs(track.x[s] - 1000));
  const engine = new CursorSplineEngine(pts, [], [], { engine: 'spline', motion: { sway: 50 } });
  for (let s = 20; s < pts.length - 20; s++) tremorMetrics.spline = Math.max(tremorMetrics.spline, Math.abs(engine.getCursorAt(pts[s].t).x - 1000));
  check('6. tremor rejection (2 px @ 12 Hz, still path)',
    `solve residual ${tremorMetrics.solve.toExponential(2)} px (need < 0.2); spline ${tremorMetrics.spline.toExponential(2)} px`,
    tremorMetrics.solve < 0.2);
}

// ---------------------------------------------------------------------------
// 7. Flick preservation: 300 px in 150 ms
// ---------------------------------------------------------------------------
const flickMetrics = { solve: 0, spline: 0, input: 0 };
{
  const start = 0.4, dur = 0.15;
  const pts = points(121, (tms) => {
    const t = tms / 1000;
    if (t <= start) return { x: 300, y: 400 };
    if (t >= start + dur) return { x: 600, y: 400 };
    const s = (t - start) / dur;
    return { x: 300 + 300 * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5), y: 400 };
  });
  const track = solve(pts);
  const inX = pts.map((p) => p.x);
  let peakIn = 0, peakSolve = 0;
  for (let s = 1; s < pts.length - 1; s++) {
    peakIn = Math.max(peakIn, Math.abs(velocityAt(inX, s)));
    peakSolve = Math.max(peakSolve, Math.abs(velocityAt(track.x, s)));
  }
  const engine = new CursorSplineEngine(pts, [], [], { engine: 'spline', motion: { sway: 50 } });
  const outX = pts.map((p) => engine.getCursorAt(p.t).x);
  let peakSpline = 0;
  for (let s = 1; s < pts.length - 1; s++) peakSpline = Math.max(peakSpline, Math.abs(velocityAt(outX, s)));
  flickMetrics.input = peakIn;
  flickMetrics.solve = peakSolve / peakIn;
  flickMetrics.spline = peakSpline / peakIn;
  check('7. flick preservation (300 px / 150 ms)',
    `solve retains ${(100 * flickMetrics.solve).toFixed(1)}% (need >= 90%); spline ${(100 * flickMetrics.spline).toFixed(1)}%`,
    flickMetrics.solve >= 0.9);
}

// ---------------------------------------------------------------------------
// 8. Determinism: same input -> bit-identical output
// ---------------------------------------------------------------------------
{
  const pts = points(200, (t, s) => ({ x: 500 + 100 * Math.sin(s / 11) + gaussian(), y: 300 + gaussian() }));
  const a = solve(pts, { constraints: [{ t: 700, x: 640, y: 300 }] });
  const b = solve(pts, { constraints: [{ t: 700, x: 640, y: 300 }] });
  let same = true;
  for (const key of ['x', 'y', 'vx', 'vy', 'jumpAt']) {
    for (let i = 0; i < a[key].length; i++) if (!Object.is(a[key][i], b[key][i])) same = false;
  }
  // Two engine instances (the preview / export path) must agree too.
  const info = console.info;
  console.info = () => {};
  const e1 = new CursorSplineEngine(pts, [], [], { engine: 'solve' });
  const e2 = new CursorSplineEngine(pts, [], [], { engine: 'solve' });
  let enginesAgree = true;
  for (let s = 0; s < pts.length; s += 7) {
    const p1 = e1.getCursorAt(pts[s].t);
    const p2 = e2.getCursorAt(pts[s].t);
    if (p1.x !== p2.x || p1.y !== p2.y) enginesAgree = false;
  }
  console.info = info;
  check('8. determinism (two solves and two engine instances are bit-identical)',
    `arrays identical: ${same}; engine instances identical: ${enginesAgree}`, same && enginesAgree);
}

// ---------------------------------------------------------------------------
// 9. Edge cases: no NaN, no throw
// ---------------------------------------------------------------------------
{
  const cases = [];
  cases.push(['no points', [], [[0, -1]], [], 0]);
  cases.push(['1 sample', points(1, () => ({ x: 1, y: 2 })), undefined, [], 0]);
  cases.push(['3 samples', points(3, (t) => ({ x: 1 + t / 10, y: 2 })), undefined, [], 2]);
  cases.push(['4 samples', points(4, (t) => ({ x: 1 + t / 10, y: 2 })), undefined, [], 3]);
  cases.push(['all dwell', points(120, () => ({ x: 500 + gaussian() * 0.2, y: 400 })), undefined, [], 119]);
  {
    // a stretch that lands inside a single grid cell -> zero grid samples
    const gap = points(4, (t) => ({ x: 100, y: 100 }));
    gap.push({ t: 1001, x: 200, y: 200, c: 'default' });
    gap.push({ t: 1002, x: 201, y: 200, c: 'default' });
    cases.push(['zero-sample stretch', gap, [[0, 3], [4, 5]], [], Math.ceil(1002 / STEP)]);
  }
  {
    const pts = points(60, (t) => ({ x: 500 + t / 10, y: 400 }));
    cases.push(['two clicks in one cell', pts, undefined, [{ t: 100.1, x: 505, y: 400 }, { t: 103.2, x: 507, y: 400 }], 59]);
  }
  let ok = true;
  const failed = [];
  for (const [name, pts, stretches, constraints, steps] of cases) {
    try {
      const track = solve(pts, { stretches, constraints, steps });
      if (!allFinite(track.x, track.y, track.vx, track.vy) || !jumpAtSane(track.jumpAt)) {
        ok = false;
        failed.push(`${name} (NaN)`);
      }
    } catch (error) {
      ok = false;
      failed.push(`${name} (${error.message})`);
    }
  }
  check('9. edge cases: 0/1/3/4 samples, all-dwell, zero-sample stretch, two clicks one cell',
    ok ? `${cases.length} cases, no NaN, no throw` : `failed: ${failed.join(', ')}`, ok);
}

// ---------------------------------------------------------------------------
// 10. Performance: a 10-minute recording (~72,000 samples)
// ---------------------------------------------------------------------------
const perf = { perAxis: 0, total: 0, factor: 0, build: 0, runs: [] };
{
  const n = 10 * 60 * 120 + 1;
  const pts = points(n, (t, s) => ({
    x: 960 + 400 * Math.sin(s / 900) + 30 * Math.sin(s / 7),
    y: 540 + 250 * Math.cos(s / 1100) + 20 * Math.sin(s / 9)
  }));
  const lambdaFast = lambdaForSigma(SOLVE_SIGMA_FAST_MS, STEP);
  const lambdaStill = lambdaForSigma(SOLVE_SIGMA_STILL_MS, STEP);
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    const track = solve(pts, { lambdaFast, lambdaStill });
    const wall = performance.now() - started;
    perf.runs.push({
      wall,
      x: track.timing.solveXMs,
      y: track.timing.solveYMs,
      perAxis: Math.max(track.timing.solveXMs, track.timing.solveYMs),
      total: track.timing.totalMs,
      factor: track.timing.factorMs,
      build: track.timing.buildMs
    });
  }
  const median = (values) => values.slice().sort((a, b) => a - b)[1];
  perf.x = median(perf.runs.map((r) => r.x));
  perf.y = median(perf.runs.map((r) => r.y));
  perf.perAxis = median(perf.runs.map((r) => r.perAxis));
  perf.total = median(perf.runs.map((r) => r.wall));
  perf.factor = median(perf.runs.map((r) => r.factor));
  perf.build = median(perf.runs.map((r) => r.build));
  check('10. performance: 72,001 samples (10 minutes at 120 Hz)',
    `per axis ${perf.perAxis.toFixed(1)} ms (need < 200); x ${perf.x.toFixed(1)} ms, y ${perf.y.toFixed(1)} ms; ` +
    `whole precompute ${perf.total.toFixed(0)} ms (factor ${perf.factor.toFixed(1)} ms, build ${perf.build.toFixed(0)} ms)`,
    perf.perAxis < 200);
}

// ---------------------------------------------------------------------------
// 11-15. Click press physics: attack, tap floor, release pop, double-click, cuts
// ---------------------------------------------------------------------------
{
  const stillPts = points(361, () => ({ x: 0.5, y: 0.5 }));
  const makePress = (events, options = {}) =>
    new CursorSplineEngine(stillPts, [], events, { engine: 'solve', ...options });

  // 11. Fast attack: the exact critically damped spring, not an Euler approximation.
  const attackEngine = makePress([
    { t: 1000, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1200, type: 'up', x: 0.5, y: 0.5, button: 0 }
  ]);
  const attack25 = attackEngine.getPressProgressAt(1025);
  const attack35 = attackEngine.getPressProgressAt(1035);
  check('11. click press: fast attack (>=80% at 25 ms, >=90% at 35 ms)',
    `progress at 25 ms ${(attack25 * 100).toFixed(1)}% (need >= 80%); at 35 ms ${(attack35 * 100).toFixed(1)}% (need >= 90%)`,
    attack25 >= 0.80 && attack35 >= 0.90);

  // 12. Trackpad tap floor: a 4 ms tap is narrower than one 120 Hz step and must not be skipped.
  const tapEngine = makePress([
    { t: 1000, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1004, type: 'up', x: 0.5, y: 0.5, button: 0 }
  ]);
  let tapMin = 1;
  for (let t = 1000; t <= 1110; t += 0.5) tapMin = Math.min(tapMin, tapEngine.getPressScaleAt(t));
  check('12. click press: 4 ms trackpad tap still reaches <= 0.76 press scale',
    `min pressScale ${tapMin.toFixed(4)} (need <= 0.76, not skipped)`, tapMin <= 0.76);

  // 13. Release: one clean underdamped pop past 1.0, then settle.
  const releaseEngine = makePress([
    { t: 1000, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1105, type: 'up', x: 0.5, y: 0.5, button: 0 }
  ]);
  let overshoot = 0;
  for (let t = 1105; t <= 1355; t += 0.5) overshoot = Math.max(overshoot, releaseEngine.getPressScaleAt(t));
  const settled = releaseEngine.getPressScaleAt(1355);
  check('13. click press: release overshoot ~1.025x and settle by +250 ms',
    `max pressScale ${overshoot.toFixed(4)} (need 1.015..1.04); at release+250 ms ${settled.toFixed(4)} (need |x-1| <= 0.005)`,
    overshoot >= 1.015 && overshoot <= 1.04 && Math.abs(settled - 1) <= 0.005);

  // 14. Double-click separation: click 1 fully compresses, the trough rebounds, click 2 compresses.
  // Includes the click events so the orphan-click fallback is exercised too.
  const doubleEngine = new CursorSplineEngine(stillPts, [
    { t: 1000, x: 0.5, y: 0.5, button: 0, targetTag: 'button' },
    { t: 1170, x: 0.5, y: 0.5, button: 0, targetTag: 'button' }
  ], [
    { t: 1000, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1004, type: 'up', x: 0.5, y: 0.5, button: 0 },
    { t: 1170, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1174, type: 'up', x: 0.5, y: 0.5, button: 0 }
  ], { engine: 'solve' });
  let click1Min = 1, troughMax = 0, click2Min = 1;
  for (let t = 1000; t <= 1105; t += 0.5) click1Min = Math.min(click1Min, doubleEngine.getPressScaleAt(t));
  for (let t = 1105; t <= 1170; t += 0.5) troughMax = Math.max(troughMax, doubleEngine.getPressScaleAt(t));
  for (let t = 1170; t <= 1275; t += 0.5) click2Min = Math.min(click2Min, doubleEngine.getPressScaleAt(t));
  check('14. click press: 170 ms double-click separation',
    `click 1 min ${click1Min.toFixed(4)} (<= 0.76); trough max ${troughMax.toFixed(4)} (>= 0.92); click 2 min ${click2Min.toFixed(4)} (<= 0.76)`,
    click1Min <= 0.76 && troughMax >= 0.92 && click2Min <= 0.76);

  // 14b. Brisk real double-click: up1 (1020) lands before down2 (1120). Click 1's
  // 105 ms tap floor must still be clamped by MIN_DOUBLE_GAP_MS so the two presses
  // stay separate instead of merging into one long squish.
  const briskEngine = new CursorSplineEngine(stillPts, [
    { t: 1000, x: 0.5, y: 0.5, button: 0, targetTag: 'button' },
    { t: 1120, x: 0.5, y: 0.5, button: 0, targetTag: 'button' }
  ], [
    { t: 1000, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1020, type: 'up', x: 0.5, y: 0.5, button: 0 },
    { t: 1120, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1140, type: 'up', x: 0.5, y: 0.5, button: 0 }
  ], { engine: 'solve' });
  let briskClick1Min = 1, briskTroughMax = 0, briskClick2Min = 1;
  for (let t = 1000; t <= 1065; t += 0.5) briskClick1Min = Math.min(briskClick1Min, briskEngine.getPressScaleAt(t));
  for (let t = 1065; t <= 1120; t += 0.5) briskTroughMax = Math.max(briskTroughMax, briskEngine.getPressScaleAt(t));
  for (let t = 1120; t <= 1225; t += 0.5) briskClick2Min = Math.min(briskClick2Min, briskEngine.getPressScaleAt(t));
  check('14b. click press: 120 ms brisk double-click (up1 before down2)',
    `click 1 min ${briskClick1Min.toFixed(4)} (<= 0.76); trough max ${briskTroughMax.toFixed(4)} (>= 0.92); click 2 min ${briskClick2Min.toFixed(4)} (<= 0.76)`,
    briskClick1Min <= 0.76 && briskTroughMax >= 0.92 && briskClick2Min <= 0.76);

  // 15. Cut-seam isolation: the press spring resets at a removed-silence cut.
  const cutEngine = new CursorSplineEngine(stillPts, [], [
    { t: 1000, type: 'down', x: 0.5, y: 0.5, button: 0 },
    { t: 1400, type: 'up', x: 0.5, y: 0.5, button: 0 }
  ], { engine: 'solve', cutRanges: [{ startTime: 1050, endTime: 1150 }] });
  const beforeCut = cutEngine.getPressScaleAt(1040);
  let afterCutDeviation = 0;
  for (let t = 1050; t <= 1300; t += 0.5) afterCutDeviation = Math.max(afterCutDeviation, Math.abs(cutEngine.getPressScaleAt(t) - 1));
  check('15. click press: no press bleed across a cut seam',
    `before cut pressScale ${beforeCut.toFixed(4)} (< 0.8); max |pressScale-1| from the cut ${afterCutDeviation.toExponential(2)} (<= 0.001)`,
    beforeCut < 0.8 && afterCutDeviation <= 0.001);
}

// ---------------------------------------------------------------------------
// Report metrics: BOTH engines on ONE synthetic recording
//   still + tremor | 800 px/s ramp | still | 300 px flick | still, with clicks
// ---------------------------------------------------------------------------
const recording = { lag: { solve: 0, spline: 0 }, tremor: { solve: 0, spline: 0 }, flick: { solve: 0, spline: 0, input: 0 }, click: 0 };
{
  const minJerk = (s) => 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5;
  const ramp = (t) => 1000 + 800 * (t - 1500) / 1000;
  const at = (t) => {
    if (t < 1500) return { x: 1000 + 2 * Math.sin(2 * Math.PI * 12 * t / 1000), y: 500 };
    if (t < 3000) return { x: ramp(t) + gaussian() * 2, y: 500 + gaussian() * 2 };
    if (t < 3400) return { x: 2200, y: 500 };
    if (t < 3550) return { x: 2200 + 300 * minJerk((t - 3400) / 150), y: 500 };
    return { x: 2500, y: 500 };
  };
  const pts = points(Math.round(5000 / STEP) + 1, at);
  const truth = (t) => (t >= 1500 && t < 3000 ? ramp(t) : at(t).x);
  const track = solve(pts, { constraints: [{ t: 3200, x: 2200, y: 500 }, { t: 4000, x: 2500, y: 500 }] });
  const engine = new CursorSplineEngine(pts, [], [], { engine: 'spline', motion: { sway: 50 } });

  let lagSum = 0, lagCount = 0;
  for (let s = 0; s < pts.length; s++) {
    const t = pts[s].t;
    if (t >= 1800 && t <= 2800) {
      lagSum += track.x[s] - truth(t);
      lagCount++;
    }
  }
  recording.lag.solve = lagSum / lagCount;
  lagSum = 0; lagCount = 0;
  for (let s = 0; s < pts.length; s++) {
    const t = pts[s].t;
    if (t >= 1800 && t <= 2800) {
      lagSum += engine.getCursorAt(t).x - truth(t);
      lagCount++;
    }
  }
  recording.lag.spline = lagSum / lagCount;

  for (let s = 0; s < pts.length; s++) {
    const t = pts[s].t;
    if (t >= 200 && t <= 1300) {
      recording.tremor.solve = Math.max(recording.tremor.solve, Math.abs(track.x[s] - 1000));
      recording.tremor.spline = Math.max(recording.tremor.spline, Math.abs(engine.getCursorAt(t).x - 1000));
    }
  }

  const inX = pts.map((p) => p.x);
  const outSolve = Array.from(track.x);
  const outSpline = pts.map((p) => engine.getCursorAt(p.t).x);
  let peakIn = 0, peakSolve = 0, peakSpline = 0;
  for (let s = 0; s < pts.length; s++) {
    if (pts[s].t < 3400 || pts[s].t > 3550) continue;
    peakIn = Math.max(peakIn, Math.abs(velocityAt(inX, s)));
    peakSolve = Math.max(peakSolve, Math.abs(velocityAt(outSolve, s)));
    peakSpline = Math.max(peakSpline, Math.abs(velocityAt(outSpline, s)));
  }
  recording.flick.input = peakIn;
  recording.flick.solve = peakSolve / peakIn;
  recording.flick.spline = peakSpline / peakIn;

  const clickPoint = readAt(track, 3200);
  recording.click = Math.hypot(clickPoint.x - 2200, clickPoint.y - 500);
}

// ---------------------------------------------------------------------------
// Opt-in camera smoothness checks (node scripts/cursor-solve-check.mjs --camera)
// Kept out of the 11-check summary so the default run stays 11/11.
// ---------------------------------------------------------------------------
const cameraMode = process.argv.includes('--camera');
const cameraResults = [];
function cameraCheck(name, detail, ok) {
  cameraResults.push({ name, detail, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}
const cameraMetrics = {};

function makePill(id, startTime, endTime, targetX, targetY, targetScale, transitionDuration) {
  return {
    id, startTime, endTime, targetX, targetY, targetScale,
    tiltX: 0, tiltY: 0, spotlight: false, label: id, autoGenerated: true, transitionDuration
  };
}

/** The pre-polish camera (linear ramps, linear hop, hard dead zone, fixed 625/400 springs), for before/after numbers. */
function legacyCameraPath(pills, cursorAt) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const sorted = pills
    .filter((p) => p && p.endTime > p.startTime)
    .map((p) => ({ ...p }))
    .sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < sorted[i - 1].endTime) sorted[i - 1].endTime = sorted[i].startTime;
  }
  const zooms = sorted.map((p) => ({
    start: p.startTime,
    end: p.endTime,
    ramp: Math.max(1, Math.min(p.transitionDuration > 0 ? p.transitionDuration : 600, (p.endTime - p.startTime) * 0.35)),
    scale: Math.max(1, p.targetScale),
    x: clamp01(p.targetX),
    y: clamp01(p.targetY)
  }));
  const chained = (a, b) => b.start - a.end <= 800;
  const follow = (z, t, f) => {
    const raw = cursorAt(t);
    if (!raw) return f;
    const cx = clamp01(raw.x), cy = clamp01(raw.y);
    const safeX = 0.25 / z.scale, safeY = 0.25 / z.scale;
    return {
      x: Math.max(cx - safeX, Math.min(cx + safeX, f.x)),
      y: Math.max(cy - safeY, Math.min(cy + safeY, f.y))
    };
  };
  const targetAt = (t) => {
    let i = -1;
    for (let j = 0; j < zooms.length; j++) if (zooms[j].start <= t) i = j;
    if (i < 0) return { x: 0.5, y: 0.5, scale: 1 };
    const z = zooms[i];
    const prev = i > 0 ? zooms[i - 1] : null;
    const next = i < zooms.length - 1 ? zooms[i + 1] : null;
    if (t <= z.end) {
      const wIn = prev && chained(prev, z) ? 1 : clamp01((t - z.start) / z.ramp);
      const wOut = next && chained(z, next) ? 1 : clamp01((z.end - t) / z.ramp);
      const w = Math.min(wIn, wOut);
      const f = follow(z, t, { x: z.x, y: z.y });
      return { scale: 1 + (z.scale - 1) * w, x: f.x, y: f.y };
    }
    if (next && chained(z, next)) {
      const p = clamp01((t - z.end) / Math.max(1, next.start - z.end));
      return { scale: z.scale + (next.scale - z.scale) * p, x: z.x + (next.x - z.x) * p, y: z.y + (next.y - z.y) * p };
    }
    return { x: 0.5, y: 0.5, scale: 1 };
  };
  const t0 = zooms[0].start;
  const tEnd = Math.max(...zooms.map((z) => z.end)) + 2500;
  const steps = Math.max(1, Math.ceil((tEnd - t0) / STEP));
  const table = Array.from({ length: 3 }, () => new Float64Array(steps + 1));
  const springs = [
    createSpring(625, dampingFor(625), 1),
    createSpring(400, dampingFor(400), 0.5),
    createSpring(400, dampingFor(400), 0.5)
  ];
  const dt = STEP / 1000;
  for (let s = 0; s <= steps; s++) {
    const goal = targetAt(t0 + s * STEP);
    const goals = [goal.scale, goal.x, goal.y];
    for (let c = 0; c < 3; c++) {
      table[c][s] = springs[c].value;
      springs[c].step(goals[c], dt);
    }
  }
  return {
    at(timeMs) {
      if (!Number.isFinite(timeMs) || timeMs <= t0 || timeMs >= tEnd) return { x: 0.5, y: 0.5, scale: 1 };
      const f = Math.min(steps, (timeMs - t0) / STEP);
      const i = Math.min(steps - 1, Math.floor(f));
      const r = f - i;
      const read = (c) => table[c][i] + (table[c][i + 1] - table[c][i]) * r;
      const scale = Math.max(1, read(0));
      const half = 0.5 / scale;
      return {
        x: Math.max(half, Math.min(1 - half, read(1))),
        y: Math.max(half, Math.min(1 - half, read(2))),
        scale
      };
    }
  };
}

function accelStats(path, t0, t1) {
  const xs = [], ys = [], ss = [];
  for (let t = t0; t <= t1; t += STEP) {
    const c = path.at(t);
    xs.push(c.x); ys.push(c.y); ss.push(c.scale);
  }
  const dt = STEP / 1000;
  const stats = (a) => {
    let max = 0, step = 0;
    for (let i = 1; i < a.length - 1; i++) {
      const ac = (a[i + 1] - 2 * a[i] + a[i - 1]) / (dt * dt);
      max = Math.max(max, Math.abs(ac));
    }
    for (let i = 2; i < a.length - 1; i++) {
      const a0 = (a[i] - 2 * a[i - 1] + a[i - 2]) / (dt * dt);
      const a1 = (a[i + 1] - 2 * a[i] + a[i - 1]) / (dt * dt);
      step = Math.max(step, Math.abs(a1 - a0));
    }
    return { max, step };
  };
  return { x: stats(xs), y: stats(ys), scale: stats(ss) };
}

if (cameraMode) {
  console.log('\n=== Camera smoothness checks ===');
  const cursorAt = (t) => ({ x: 0.5 + 0.42 * Math.sin(t / 650), y: 0.5 + 0.32 * Math.cos(t / 900) });
  const pills = [
    makePill('A', 1000, 3000, 0.30, 0.35, 1.7, 500),
    makePill('B', 5000, 7000, 0.72, 0.62, 2.0, 500),
    // 500 ms after B: chained, and a wide move (distance 0.68) -> the mid-gap dip.
    makePill('C', 7500, 9500, 0.18, 0.20, 1.8, 700)
  ];
  const options = { followCursor: true, cursorAt, viewportWidth: 1920, viewportHeight: 1080 };
  const path = buildCameraPath(pills, options);
  const legacy = legacyCameraPath(pills, cursorAt);

  let minScale = Infinity, boundViolations = 0;
  for (let t = 900; t <= 12000; t += STEP) {
    const c = path.at(t);
    minScale = Math.min(minScale, c.scale);
    const half = 0.5 / c.scale;
    if (c.x < half - 1e-9 || c.x > 1 - half + 1e-9 || c.y < half - 1e-9 || c.y > 1 - half + 1e-9) boundViolations++;
  }
  cameraCheck('C1. scale floor and viewport clamp (120 Hz, 0.9-12 s)',
    `min scale ${minScale.toFixed(6)} (need >= 1); viewport-bound violations ${boundViolations} (need 0)`,
    minScale >= 1 - 1e-9 && boundViolations === 0);

  const now = accelStats(path, 1000, 11990);
  const before = accelStats(legacy, 1000, 11990);
  cameraMetrics.now = now;
  cameraMetrics.before = before;
  cameraCheck('C2. acceleration is lower than the linear-ramp camera (pan x/y)',
    `max |a| x ${now.x.max.toFixed(3)} vs ${before.x.max.toFixed(3)}; y ${now.y.max.toFixed(3)} vs ${before.y.max.toFixed(3)}; ` +
    `max |da| x ${now.x.step.toFixed(3)} vs ${before.x.step.toFixed(3)}`,
    Number.isFinite(now.x.max) && Number.isFinite(now.y.max) && now.x.max <= before.x.max && now.y.max <= before.y.max);

  const pathB = buildCameraPath(pills, options);
  let identical = true;
  for (let t = 1000; t <= 11990; t += 7) {
    const a = path.at(t), b = pathB.at(t);
    if (!Object.is(a.x, b.x) || !Object.is(a.y, b.y) || !Object.is(a.scale, b.scale)) identical = false;
  }
  cameraCheck('C3. deterministic rebuild (bit-identical at 120 Hz lookups)', `identical: ${identical}`, identical);

  const wideDip = path.targetAt(7250).scale;
  const closePills = [
    makePill('A', 1000, 3000, 0.30, 0.35, 1.7, 500),
    makePill('B', 5000, 7000, 0.72, 0.62, 2.0, 500),
    makePill('C', 7500, 9500, 0.74, 0.64, 1.8, 700)
  ];
  const closeDip = buildCameraPath(closePills, options).targetAt(7250).scale;
  cameraCheck('C4. chained hop: dip only on a wide move',
    `wide mid-gap scale ${wideDip.toFixed(3)} (need ${CHAIN_DIP_FLOOR}..1.5); close mid-gap scale ${closeDip.toFixed(3)} (need >= 1.7)`,
    wideDip >= CHAIN_DIP_FLOOR - 1e-9 && wideDip <= 1.5 && closeDip >= 1.7);

  const single = generateAutoZoomPills([{ t: 1000, x: 0.3, y: 0.4 }], 10000, 1920, 1080, { depth: 1.5, transitionMs: 500 });
  const merged = generateAutoZoomPills(
    [{ t: 1000, x: 0.3, y: 0.4 }, { t: 2400, x: 0.34, y: 0.42 }],
    10000, 1920, 1080, { depth: 1.5, transitionMs: 500 }
  );
  const singleDuration = single[0].endTime - single[0].startTime;
  cameraCheck('C5. auto zoom: 1.8 s single-click pill, 500 ms ramp, 1.4 s clicks merge',
    `duration ${singleDuration.toFixed(0)} ms (need ${AUTO_ZOOM_CONFIG.LEAD_IN_MS + AUTO_ZOOM_CONFIG.HOLD_OUT_MS}); ` +
    `ramp ${single[0].transitionDuration} ms; 1.4 s-apart clicks -> ${merged.length} pill`,
    Math.abs(singleDuration - (AUTO_ZOOM_CONFIG.LEAD_IN_MS + AUTO_ZOOM_CONFIG.HOLD_OUT_MS)) < 1e-6 &&
    single[0].transitionDuration === 500 && merged.length === 1);

  const clickPts = points(601, (t) => ({ x: 0.2 + 0.6 * Math.min(1, t / 5000), y: 0.5 }));
  const click = { t: 2500.5, x: 0.5, y: 0.5, targetText: 'Button' };
  const clickEngine = new CursorSplineEngine(clickPts, [click], [], { engine: 'solve' });
  const atClick = clickEngine.getCursorAt(click.t);
  const missPx = Math.hypot((atClick.x - click.x) * 1920, (atClick.y - click.y) * 1080);
  let pressMin = 1;
  for (let t = click.t - 60; t <= click.t + 120; t += 1) pressMin = Math.min(pressMin, clickEngine.getPressScaleAt(t));
  cameraCheck('C6. ripple/press on the solved click point',
    `click miss ${missPx.toFixed(4)} px (need < 0.1); press min ${pressMin.toFixed(3)} (need <= 0.9)`,
    missPx < 0.1 && pressMin <= 0.9);

  const fastPts = points(121, (t) => ({ x: 0.02 + 0.96 * Math.min(1, t / 1000), y: 0.5 }));
  const fastEngine = new CursorSplineEngine(fastPts, [], [], { engine: 'solve' });
  const fastTrail = fastEngine.getTrailAt(500, 4, 60);
  const fast20 = fastEngine.getTrailAt(500, 4, 20);
  const slowPts = points(241, (t) => ({ x: 0.5 + 0.001 * Math.sin(t / 100), y: 0.5 }));
  const slowTrail = new CursorSplineEngine(slowPts, [], [], { engine: 'solve' }).getTrailAt(1000, 4, 60);
  const maxOpacity = fastTrail.reduce((m, p) => Math.max(m, p.opacity), 0);
  cameraCheck('C7. glide trail: 800 px/s onset, 20 fps gate, smooth opacity',
    `fast samples ${fastTrail.length} (>0), 20 fps ${fast20.length} (0), slow ${slowTrail.length} (0); ` +
    `max opacity ${maxOpacity.toFixed(3)} (0..0.25); onset ${CURSOR_BLUR_ONSET_PX_S}-${CURSOR_BLUR_FULL_PX_S} px/s`,
    fastTrail.length > 0 && fast20.length === 0 && slowTrail.length === 0 && maxOpacity > 0 && maxOpacity <= 0.25);

  console.log('\n=== Camera metrics (new vs legacy) ===');
  console.log(`preset springs          Snap ${cameraZoomStiffness(320)}, Smooth ${cameraZoomStiffness(500)}, Cinematic ${cameraZoomStiffness(700)}; default ${DEFAULT_TRANSITION_MS} ms (${ZOOM_SPEEDS.map((s) => s.label).join('/')})`);
  console.log(`max |a| x               new ${now.x.max.toFixed(3)}   legacy ${before.x.max.toFixed(3)}`);
  console.log(`max |a| y               new ${now.y.max.toFixed(3)}   legacy ${before.y.max.toFixed(3)}`);
  console.log(`max |da| per step x     new ${now.x.step.toFixed(3)}   legacy ${before.x.step.toFixed(3)}`);
  console.log(`max |da| per step y     new ${now.y.step.toFixed(3)}   legacy ${before.y.step.toFixed(3)}`);
  console.log(`max |a| scale           new ${now.scale.max.toFixed(3)}   legacy ${before.scale.max.toFixed(3)}`);
  console.log(`min scale               ${minScale.toFixed(6)}; viewport violations ${boundViolations}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log('\n=== Summary ===');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log(`FAILED: ${failed.map((r) => r.name).join(' | ')}`);
if (cameraMode) {
  const cameraFailed = cameraResults.filter((r) => !r.ok);
  console.log(`Camera: ${cameraResults.length - cameraFailed.length}/${cameraResults.length} checks passed`);
  if (cameraFailed.length) console.log(`CAMERA FAILED: ${cameraFailed.map((r) => r.name).join(' | ')}`);
}

console.log('\n=== Report data (one synthetic recording, both engines) ===');
console.log(`lambda fast (${SOLVE_SIGMA_FAST_MS} ms) = ${lambdaForSigma(SOLVE_SIGMA_FAST_MS, STEP).toFixed(1)}; ` +
  `still (${SOLVE_SIGMA_STILL_MS} ms) = ${lambdaForSigma(SOLVE_SIGMA_STILL_MS, STEP).toExponential(2)}; ` +
  `smoothing multiplier at 0.6 = ${smoothingMultiplier(0.6).toFixed(3)}`);
console.log(`lag on 800 px/s ramp       solve ${recording.lag.solve.toFixed(2)} px   spline ${recording.lag.spline.toFixed(2)} px`);
console.log(`tremor residual (12 Hz)    solve ${recording.tremor.solve.toExponential(2)} px   spline ${recording.tremor.spline.toExponential(2)} px`);
console.log(`flick retention            solve ${(100 * recording.flick.solve).toFixed(1)}%   spline ${(100 * recording.flick.spline).toFixed(1)}%   (input peak ${recording.flick.input.toFixed(0)} px/s)`);
console.log(`click miss at 3.2 s        solve ${recording.click.toFixed(4)} px`);
console.log(`72k solve, per axis        ${perf.perAxis.toFixed(1)} ms (x ${perf.x.toFixed(1)}, y ${perf.y.toFixed(1)})   whole precompute ${perf.total.toFixed(0)} ms ` +
  `(factor ${perf.factor.toFixed(1)} ms, build ${perf.build.toFixed(0)} ms; runs ${perf.runs.map((r) => r.wall.toFixed(0)).join('/')} ms)`);

fs.rmSync(outDir, { recursive: true, force: true });
const cameraFailed = cameraMode ? cameraResults.filter((r) => !r.ok) : [];
process.exit(failed.length || cameraFailed.length ? 1 : 0);

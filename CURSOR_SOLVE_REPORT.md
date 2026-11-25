# Cursor solve — acceptance report

The `solve` cursor engine (`src/engine/cursor-solve.ts` + `src/engine/banded-cholesky.ts`)
replaces the Gaussian/spline/spring stack with one global constrained solve. This report
records what was measured, on what input, and how to reproduce it.

Default engine is now `'solve'`. The editor switch is **Cursor → Cursor engine →
Solve (default) / Spline (classic)**, persisted in `localStorage` (`smoothstudio.cursorEngine`).
An install saved on the old default migrates to `'solve'` once (`cursorEngineVersion`); a
manual switch back to `'spline'` is kept afterwards.

## Reproduce

```bash
node scripts/cursor-solve-check.mjs            # 11/11 checks, prints the table below
node scripts/cursor-solve-check.mjs --camera   # + 7 camera smoothness checks
npx vitest run                        # this repo has no test files: exits 1, "No test files found"
npm run build                         # tsc + vite build, exit 0
```

`scripts/cursor-solve-check.mjs` is a dev-only harness: it is not imported by `src/`, is
not bundled, and compiles the engine modules into a temp directory with the repo's own
`tsc`. It is the agreed exception to AGENTS.md §3.1; there is still no test runner, no
mock and no `window.__*` hook.

## The engine, briefly

For each on-page stretch and each axis, on the 120 Hz grid, the output `x` minimises

```
Σ wᵢ (xᵢ − x̂ᵢ)²  +  Σ λᵣ (x[r+3] − 3x[r+2] + 3x[r+1] − x[r])²
```

with `w = 1` free flight, `50` dwell (envelope speed < 60 px/s), `5` stretch ends,
`1e6` at clicks/presses, and `λ` from the speed envelope (max over ±60 ms, σ = 30 ms
selector) between a 12 ms and a 100 ms Gaussian-equivalent. `W + DᵀΛD` is SPD with
bandwidth 3; `DᵀΛD` is accumulated row by row (correct natural boundary conditions, per-row
λ), then one banded Cholesky, O(N). Clicks constrain the **interpolated** value at the exact
event time, `(1−α)x[i] + αx[i+1] = click`, so the drawn path passes through the click
between grid samples too.

## Side by side — one synthetic recording, both engines

Recording: still + 2 px 12 Hz tremor (0–1.5 s), 800 px/s ramp + 2 px noise (1.5–3 s),
still, 300 px flick in 150 ms (3.4–3.55 s), still; clicks at 3.2 s and 4.0 s.
Spline at its default smoothing (0.6) and sway 50.

| metric | spline | solve |
|---|---|---|
| mean signed lag, 800 px/s ramp | **−28.88 px** | **+0.04 px** |
| tremor residual, 2 px @ 12 Hz | 0.185 px | 0.052 px |
| flick peak-velocity retention | **51.7 %** (1922 / 3719 px/s) | **99.8 %** (3711 / 3719 px/s) |
| click miss at the click time | (snapped ±60 ms) | **0.0000 px** |
| 72,001 samples, 10 min @ 120 Hz | — | **4.9 ms per axis** (x 4.9, y 4.9); 140 ms whole precompute |

## Acceptance checks (all pass)

| # | check | expected | measured |
|---|---|---|---|
| 1 | banded vs dense Cholesky, random banded SPD, N=200 | < 1e-9 | **1.11e-16** |
| 1b | `DᵀΛD + W` band accumulation vs dense build | exact | **0.0** |
| 2 | λ→0 reproduces x̂ (λ=0 and λ=1e-12) | < 1e-6 | **0.0 / 1.01e-10** |
| 3 | λ→∞ is a quadratic (parabola R²) | > 0.9999 | **0.999999990** |
| 4 | click constraint, offsets 3/40/200 px, smoothing 0.6/0.6/1 | < 0.1 px | **0.0100 px** |
| 5 | zero lag: 800 px/s + 2 px noise | < 0.5 px | **0.081 px** (spline: −28.88 px, asserted to fail) |
| 6 | tremor rejection, 2 px @ 12 Hz | < 0.2 px | **0.032 px** |
| 7 | flick 300 px / 150 ms | ≥ 90 % | **99.8 %** |
| 8 | determinism, two solves and two engine instances | bit-identical | **true / true** |
| 9 | edge cases: 0/1/3/4 samples, all-dwell, zero-sample stretch, two clicks one cell | no NaN, no throw | **7/7 clean** |
| 10 | 72,001 samples, per axis | < 200 ms | **4.9 ms** (x 4.9, y 4.9) |

Notes:

- **Test 3** uses a quadratic trend + noise on purpose. On a purely oscillating input a
  very large λ collapses the output to near-constant, so R² is measured against almost no
  variance (that input reads 0.99982 and says nothing about the null space).
- **Test 4** measures the value the renderer actually draws: linear interpolation between
  the two grid samples around the click time.
- **Test 9**'s zero-sample stretch is two samples 1 ms apart after a break, so they fall
  inside one grid cell and the stretch contributes no grid sample.

## λ calibration

`λ = 0.41 / (ω_c·h)⁶` with `ω_c = 0.83/σ`, on the 120 Hz grid (`h = 1/120`):

| matched Gaussian | λ | note |
|---|---|---|
| 12 ms (fast) | **11.2** | used by the engine |
| 51 ms (spec's "narrow") | 6.6e4 | would fail check 7 |
| 100 ms (still) | **3.74e6** | used by the engine |

The fast bound deviates from the original 51 ms suggestion on purpose: measured flick
retention is **99.8 % at 12 ms vs 50.1 % at 51 ms**, and check 7 requires ≥ 90 %. The cost
is noise at speed (0.35 → 0.90 px rms at 800 px/s). The "Cursor Smoothing" slider scales
both bounds by `((18 + 55·s)/51)⁶`, so at the default 0.6 the multiplier is 1.000 and the
slider still spans about three decades of λ.

## Performance

72,001 samples (10 minutes at 120 Hz), one stretch, median of three runs on this machine:

| phase | time |
|---|---|
| banded factor | 5.1 ms |
| x solve | 4.9 ms |
| y solve | 4.9 ms |
| whole precompute (grid resample, speed envelope, selector, band, factor, both solves) | 140 ms |

Run spread: 208 / 140 / 122 ms (first run is cold; the per-axis figure is stable at
4.9–5.6 ms). The stated budget of < 200 ms per axis is met by a wide margin; the whole
precompute is reported separately because it is the number the editor actually waits for.

## Known limitations

- **Two constraints in one 8 ms cell are averaged.** A click and a press at the same point
  merge harmlessly; two *different* points within one cell (e.g. a click and a release 3 ms
  apart, 2 px apart) become one averaged constraint and each is missed by ~0.84 px. Real
  click/release pairs are far enough apart in time that this does not occur.
- The click safety net is ±20 ms and only corrects the solve's residual; it logs a warning
  when it has to move the cursor more than 1 px. In these runs it never fired.
- `npx vitest run` exits 1 because the repository has no test files. Nothing was deleted:
  `git ls-files tests` is empty, so there were none to keep.

## Integration checks

- **Export parity.** Preview, MP4 and GIF all receive the same `CursorSplineEngine`
  instance: `EditorStudio.tsx:1751` (MP4) and `:1834` (GIF) pass `cursorEngineRef.current`;
  the exporters only set cut/trim options (`mp4-exporter.ts:265`, `gif-exporter.ts:312`)
  and never touch `engine`; the renderer reads `cursorEngine.getCursorAt` at
  `renderer.ts:556`. Switching the dropdown therefore changes preview and both exports.
- **UI clarity.** With Solve selected, the Sway row reads "No effect with Solve" and the
  slider is disabled (`VibePresetsPanel.tsx:1084` and `:1092`).
- **Camera / cursor alignment.** The camera's dead-zone pan reads the same solved 120 Hz
  track (`getCameraCursorAt` → `getTrackedCursorAt` → `getSolvedCursorAt`); the click
  ripple is placed on `getCursorAt(click.t)`, the exact solved click point, and the press
  squish uses the same path. Shape-aware lean: full around the hotspot for arrow/pointer,
  none for text, half around the palm for grab/grabbing. Glide trail starts at 800 px/s
  (full at 1200) and is off at <= 20 fps and across cuts/re-entries.

## Manual A/B

1. `npm run build`, reload the unpacked extension, reload the recorded page.
2. Open a recording in the editor → Cursor → **Cursor engine: Solve (default)**.
3. Watch a click, a dwell and a fast flick. The cursor should arrive with no trailing lag,
   sit still through the dwell, pass exactly through each click, and keep the flick's speed.
4. Compare with **Spline (classic)** on the same recording. The solve's build line appears
   in the console as `[SmoothStudio] Cursor solve: … ms`.
5. Export a short MP4 and GIF; the cursor must match the preview frame for frame.

## Camera polish (Camera Smoothness & Cursor-Animation Alignment)

The camera target is C² at every handoff:

- Zoom ramps: quintic `ease5` (zero velocity and acceleration at both ends). Arrival is
  the preset; release is `0.75 ×` arrival (Smooth 500 in / 375 out, Snap 320/240,
  Cinematic 700/525), and `in + out <= 0.65 × pill` keeps a readable full-zoom hold.
- Focus keyframes: monotone cubic (PCHIP), C¹ and no overshoot, so a merged multi-click
  shot pans without a speed corner at each click.
- Follow Cursor dead zone: polynomial soft min/max with a 0.35 × feather, so crossing the
  box does not step the pan velocity.
- Chained hops (`<= 1400 ms`): quintic pan; a move wider than `0.25` normalised dips
  mid-gap to `max(1.25, min(scaleA, scaleB) × 0.78)` via `sin²(πp)`.
- Critically damped follower springs: Snap 750, Smooth 550, Cinematic 380; focus =
  `0.64 × zoom`. The preset is the active auto-zoom speed (the most common pill ramp), so
  preview, MP4 and GIF build the same schedule.
- `scale >= 1` and the viewport box `[0.5/scale, 1 - 0.5/scale]` are enforced after
  smoothing.

Auto zooms: `LEAD_IN_MS = 300`, `HOLD_OUT_MS = 1500` (single-click pill = 1.8 s), clicks
within 1.4 s merge into one pill, and the timeline shows a clean duration (icon + duration
when narrow, full label in the tooltip/inspector) instead of a clipped label.

Measured with `node scripts/cursor-solve-check.mjs --camera` (7/7):

```
min scale 1.000000; viewport violations 0
max |a| x        new 8.654    legacy 168.417
max |a| y        new 22.830   legacy 55.464
max |da| step x  new 12.472   legacy 132.980
max |da| step y  new 17.317   legacy 55.908
max |a| scale    new 31.263   legacy 17.879
wide chained dip 1.404 (close move 1.900, no dip)
single pill 1800 ms, ramp 500 ms, 1.4 s clicks -> 1 pill
click miss 0.0000 px; press min 0.835
trail: 4 samples fast, 0 at 20 fps, 0 slow; max opacity 0.192
```

/**
 * The cursor trajectory filter must stay LINEAR in the number of samples, must
 * not be recomputed by edits that cannot change it (trim handles, silence cuts),
 * and must still remove hand jitter at every preset and sample rate while
 * leaving a click exactly where it happened.
 */
import { describe, it, expect, vi } from 'vitest';
import { CursorSplineEngine } from '../../src/engine/cursor-spline';
import type { MousePoint, ClickEvent } from '../../src/types/telemetry';

/** The original quadratic filter, kept verbatim as the reference for exact equivalence. */
function referenceFilter(mousePoints: MousePoint[], smoothing: number): MousePoint[] {
  if (mousePoints.length === 0 || smoothing <= 0) return mousePoints.map((p) => ({ ...p }));
  const maxCoordinate = mousePoints.reduce((max, point) => Math.max(max, Math.abs(point.x), Math.abs(point.y)), 0);
  const coordinateScale = maxCoordinate <= 1.01 ? 1 / 1920 : 1;
  const deadband = 2 * coordinateScale;
  const sigmaMs = 18 + smoothing * 55;
  const radiusMs = sigmaMs * 3;
  const filtered: MousePoint[] = [];
  for (let i = 0; i < mousePoints.length; i++) {
    const point = mousePoints[i];
    let weightSum = 0;
    let x = 0;
    let y = 0;
    for (const candidate of mousePoints) {
      const distance = Math.abs(candidate.t - point.t);
      if (distance > radiusMs) continue;
      const weight = Math.exp(-0.5 * (distance / sigmaMs) ** 2);
      weightSum += weight;
      x += candidate.x * weight;
      y += candidate.y * weight;
    }
    const previous = filtered[i - 1];
    let nextX = weightSum > 0 ? x / weightSum : point.x;
    let nextY = weightSum > 0 ? y / weightSum : point.y;
    if (previous) {
      const dt = Math.max(1, point.t - mousePoints[i - 1].t);
      const rawDistance = Math.hypot(point.x - mousePoints[i - 1].x, point.y - mousePoints[i - 1].y);
      const filteredDistance = Math.hypot(nextX - previous.x, nextY - previous.y);
      if (filteredDistance < deadband && rawDistance / dt * 1000 < 120 * coordinateScale) {
        nextX = previous.x;
        nextY = previous.y;
      }
    }
    filtered.push({ ...point, x: nextX, y: nextY });
  }
  if (filtered.length > 0) filtered[0] = { ...mousePoints[0] };
  if (filtered.length > 1) filtered[filtered.length - 1] = { ...mousePoints[mousePoints.length - 1] };
  return filtered;
}

/** A diagonal drag with perpendicular hand jitter, sampled at `hz`. */
function jitteryDrag(hz: number, seconds: number, amp: number, jitterHz: number, dir: 'diag' | 'horiz' | 'vert') {
  const pts: MousePoint[] = [];
  const truth: Array<{ x: number; y: number }> = [];
  const n = Math.floor(seconds * hz);
  for (let i = 0; i <= n; i++) {
    const t = Math.round((i * 1000) / hz);
    const base = { x: 200 + t * 0.24, y: dir === 'horiz' ? 400 : 200 + t * 0.24 };
    const w = amp * Math.sin(2 * Math.PI * jitterHz * (t / 1000) + 0.37);
    const jx = dir === 'horiz' ? 0 : dir === 'vert' ? w : -w * Math.SQRT1_2;
    const jy = dir === 'horiz' ? w : dir === 'vert' ? 0 : w * Math.SQRT1_2;
    if (dir === 'vert') base.x = 400;
    truth.push(base);
    pts.push({ t, x: base.x + jx, y: base.y + jy, c: 'default' });
  }
  return { pts, truth };
}

const filteredOf = (engine: CursorSplineEngine): MousePoint[] => (engine as any).filteredMousePoints;
const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('cursor filter: linear-time rewrite is exactly the old filter', () => {
  for (const smoothing of [0.2, 0.6, 0.9]) {
    it(`matches the quadratic reference bit-for-bit at smoothing ${smoothing} (120 Hz, irregular + duplicate timestamps)`, () => {
      const { pts } = jitteryDrag(120, 6, 6, 23, 'diag');
      // Real telemetry pushes an extra point on press/click at the SAME timestamp, and has gaps.
      const messy: MousePoint[] = [];
      pts.forEach((p, i) => {
        if (i % 97 === 50) return; // dropped sample (gap)
        messy.push(p);
        if (i % 41 === 0) messy.push({ ...p }); // duplicate timestamp
      });
      const engine = new CursorSplineEngine(messy, [], [], { smoothing });
      const expected = referenceFilter([...messy].sort((a, b) => a.t - b.t), smoothing);
      expect(filteredOf(engine)).toEqual(expected);
    });
  }

  it('matches the reference for normalised (0..1) coordinates and fractional timestamps', () => {
    const pts: MousePoint[] = [];
    for (let i = 0; i < 900; i++) pts.push({ t: i * 8.333, x: 0.2 + i * 0.0004 + (i % 2) * 0.0006, y: 0.5 + Math.sin(i / 9) * 0.01, c: 'default' });
    const engine = new CursorSplineEngine(pts, [], [], { smoothing: 0.6 });
    expect(filteredOf(engine)).toEqual(referenceFilter(pts, 0.6));
  });
});

describe('cursor filter: only recomputed when it can change', () => {
  const build = () => {
    const { pts } = jitteryDrag(120, 4, 4, 20, 'diag');
    const engine = new CursorSplineEngine(pts, [], [], { smoothing: 0.6 });
    const rebuild = vi.spyOn(engine as any, 'rebuildFilteredMousePoints');
    return { engine, rebuild };
  };

  it('trim handle drags never rebuild it', () => {
    const { engine, rebuild } = build();
    for (let i = 0; i < 200; i++) engine.setOptions({ trimStartMs: i * 5, trimEndMs: 3900 - i });
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('silence-cut toggles never rebuild it', () => {
    const { engine, rebuild } = build();
    engine.setOptions({ cutRanges: [{ startTime: 500, endTime: 1700 }] });
    engine.setOptions({ cutRanges: [] });
    engine.setOptions({ cutRanges: [{ startTime: 500, endTime: 1700 }, { startTime: 2500, endTime: 3000 }] });
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('re-sending the same smoothing is free; changing it rebuilds exactly once', () => {
    const { engine, rebuild } = build();
    engine.setOptions({ smoothing: 0.6 });
    expect(rebuild).not.toHaveBeenCalled();
    engine.setOptions({ smoothing: 0.9 });
    expect(rebuild).toHaveBeenCalledTimes(1);
    engine.setOptions({ smoothing: 0.9, trimStartMs: 10 });
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('new raw data rebuilds it, and the result follows the new data', () => {
    const { engine, rebuild } = build();
    const next = jitteryDrag(60, 2, 4, 20, 'horiz').pts;
    engine.setData(next, [], []);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(filteredOf(engine)).toHaveLength(next.length);
  });

  it('cut and trim options are still honoured at query time without a rebuild', () => {
    const { pts } = jitteryDrag(120, 4, 4, 20, 'diag');
    const engine = new CursorSplineEngine(pts, [], [], { smoothing: 0.6 });
    const before = engine.getCursorAt(2000);
    engine.setOptions({ cutRanges: [{ startTime: 1000, endTime: 1500 }], trimStartMs: 200, trimEndMs: 3500 });
    expect((engine as any).cutRanges).toEqual([{ startTime: 1000, endTime: 1500 }]);
    expect(engine.getCursorAt(2000)).toEqual(before);
  });
});

describe('cursor filter: jitter removal at 120 Hz for every preset', () => {
  const presets: Array<[string, number]> = [['Crisp', 0.2], ['Smooth', 0.6], ['Cinematic', 0.9]];
  for (const [name, smoothing] of presets) {
    for (const dir of ['horiz', 'vert', 'diag'] as const) {
      for (const jitterHz of [15, 30, 45]) {
        it(`${name} (${smoothing}) cuts ${jitterHz} Hz hand jitter by >= 60% on a ${dir} drag, click pinned <= 1 px`, () => {
          const { pts, truth } = jitteryDrag(120, 3, 8, jitterHz, dir);
          const clickAt = pts[Math.floor(pts.length / 2)];
          const click: ClickEvent = { t: clickAt.t, x: clickAt.x, y: clickAt.y, button: 0, targetTag: 'BUTTON' };
          const engine = new CursorSplineEngine(pts, [click], [], { smoothing });
          const raw: number[] = [];
          const filtered: number[] = [];
          for (let i = 12; i < pts.length - 12; i++) {
            const c = engine.getCursorAt(pts[i].t);
            raw.push(Math.hypot(pts[i].x - truth[i].x, pts[i].y - truth[i].y));
            filtered.push(Math.hypot(c.x - truth[i].x, c.y - truth[i].y));
          }
          expect(1 - rms(filtered) / rms(raw)).toBeGreaterThanOrEqual(0.6);
          const pinned = engine.getCursorAt(click.t);
          expect(Math.hypot(pinned.x - click.x, pinned.y - click.y)).toBeLessThanOrEqual(1);
        });
      }
    }
  }
});

describe('cursor filter: long recordings stay interactive', () => {
  it('5 minutes at 120 Hz (36,000 points): build and re-smooth are fast, trim/cut edits are free', () => {
    const { pts } = jitteryDrag(120, 300, 4, 20, 'diag');
    expect(pts.length).toBeGreaterThanOrEqual(36000);

    const time = (fn: () => void) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
    let engine!: CursorSplineEngine;
    time(() => { engine = new CursorSplineEngine(pts, [], [], { smoothing: 0.6 }); }); // warm the JIT
    const build = time(() => { engine = new CursorSplineEngine(pts, [], [], { smoothing: 0.6 }); });
    const resmooth = time(() => engine.setOptions({ smoothing: 0.9 }));
    const trimDrag = time(() => { for (let i = 0; i < 1000; i++) engine.setOptions({ trimStartMs: i, trimEndMs: 299000, cutRanges: [{ startTime: 1000 + i, endTime: 4000 }] }); });

    // The quadratic version took ~13,000 ms here. The bounds are deliberately
    // loose (CI noise) yet still three orders of magnitude below it.
    expect(build).toBeLessThan(250);
    expect(resmooth).toBeLessThan(250);
    expect(trimDrag, '1000 trim-handle updates').toBeLessThan(100);
  });
});

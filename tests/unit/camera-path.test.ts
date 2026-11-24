/**
 * The camera is a deterministic schedule: a pure function of time built from the
 * zooms and the smoothed cursor path. These tests pin its behaviour: the ease,
 * the per-zoom transition, the Dead-Zone Smart Pan, the medium-distance hop, the
 * edge clamp, and that scrubbing / export sampling can never disagree.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCameraPath,
  cubicBezier,
  CAMERA_EASE,
  DEFAULT_TRANSITION_MS,
  DEAD_ZONE_FRACTION,
  HOP_MIN_SCALE,
  HOP_DIP_FACTOR
} from '../../src/engine/camera-path';
import { computeCinematicCameraState } from '../../src/engine/spring-physics';
import type { ZoomPill } from '../../src/types/telemetry';

const pill = (over: Partial<ZoomPill> = {}): ZoomPill => ({
  id: 'p',
  startTime: 1000,
  endTime: 7000,
  targetX: 0.5,
  targetY: 0.5,
  targetScale: 2,
  tiltX: 0,
  tiltY: 0,
  spotlight: false,
  ...over
});

/** A cursor path from keyframes (linear between them), normalized. */
const cursorFrom = (frames: Array<[number, number, number]>) => (t: number) => {
  if (t <= frames[0][0]) return { x: frames[0][1], y: frames[0][2] };
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i][0]) {
      const [t0, x0, y0] = frames[i - 1];
      const [t1, x1, y1] = frames[i];
      const k = (t - t0) / (t1 - t0);
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
    }
  }
  const last = frames[frames.length - 1];
  return { x: last[1], y: last[2] };
};

describe('camera ease', () => {
  const ease = cubicBezier(...CAMERA_EASE);

  it('runs 0 -> 1 and is monotonic', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let p = 0.01; p <= 1; p += 0.01) {
      const v = ease(p);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('is front-loaded: launches crisply and settles softly (not symmetric)', () => {
    expect(ease(0.2)).toBeGreaterThan(0.55);   // most of the move is done in the first fifth
    expect(ease(0.5)).toBeGreaterThan(0.9);
    expect(ease(0.5)).toBeGreaterThan(ease(0.5) * 0 + 0.5); // and well past the linear midpoint
    expect(ease(0.9) - ease(0.8)).toBeLessThan(ease(0.2) - ease(0.1)); // slow tail, fast head
  });
});

describe('zoom in / hold / zoom out', () => {
  const path = buildCameraPath([pill()], { followCursor: false });

  it('is idle (1.0x, centred) before and after the zoom', () => {
    expect(path.at(0)).toEqual({ x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 });
    expect(path.at(999).scale).toBe(1);
    expect(path.at(7001)).toEqual({ x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 });
    expect(path.at(60_000).scale).toBe(1);
  });

  it('reaches the target at the end of the default 450 ms move and holds it', () => {
    expect(DEFAULT_TRANSITION_MS).toBe(450);
    expect(path.at(1000).scale).toBe(1);
    expect(path.at(1450).scale).toBeCloseTo(2, 6);
    expect(path.at(3000).scale).toBeCloseTo(2, 6);
    expect(path.at(5000).scale).toBeCloseTo(2, 6);
  });

  it('zooms out to exactly 1.0x by the end of the pill', () => {
    expect(path.at(6549).scale).toBeCloseTo(2, 1);
    expect(path.at(7000).scale).toBeCloseTo(1, 6);
  });

  it('is >= 90% in by 300 ms (the click lands at pre-roll 300 ms)', () => {
    const settled = (path.at(1300).scale - 1) / (2 - 1);
    expect(settled).toBeGreaterThanOrEqual(0.9);
  });

  it('honours a per-zoom transition duration (Fast 300 / Slow 650)', () => {
    const fast = buildCameraPath([pill({ transitionDuration: 300 })], { followCursor: false });
    const slow = buildCameraPath([pill({ transitionDuration: 650 })], { followCursor: false });
    expect(fast.at(1300).scale).toBeCloseTo(2, 6);
    expect(slow.at(1300).scale).toBeLessThan(1.95);
    expect(slow.at(1650).scale).toBeCloseTo(2, 6);
    expect(fast.at(1150).scale).toBeGreaterThan(slow.at(1150).scale);
  });

  it('limits the move to 35% of a short zoom', () => {
    const short = buildCameraPath([pill({ startTime: 0, endTime: 1000, transitionDuration: 650 })], { followCursor: false });
    expect(short.at(350).scale).toBeCloseTo(2, 6); // 35% of 1000 ms, not 650 ms
  });

  it('tilt follows the same move', () => {
    const tilted = buildCameraPath([pill({ tiltX: 4, tiltY: -6 })], { followCursor: false });
    expect(tilted.at(1000).tiltX).toBe(0);
    expect(tilted.at(3000).tiltX).toBeCloseTo(4, 6);
    expect(tilted.at(3000).tiltY).toBeCloseTo(-6, 6);
  });
});

describe('Dead-Zone Smart Pan', () => {
  // scale 2 => the view is 0.5 wide; the safe box is the central 50% of it: +-0.125 around the focus.
  const safeHalf = DEAD_ZONE_FRACTION * (0.5 / 2);

  it('keeps the dead zone at 50% of the zoomed view', () => {
    expect(DEAD_ZONE_FRACTION).toBe(0.5);
    expect(safeHalf).toBeCloseTo(0.125, 9);
  });

  it('a cursor that stays inside the central safe zone leaves the camera completely still', () => {
    // Wanders +-0.1 (inside +-0.125) for 5 seconds.
    const wander = (t: number) => ({ x: 0.5 + 0.1 * Math.sin(t / 170), y: 0.5 + 0.1 * Math.cos(t / 230) });
    const path = buildCameraPath([pill()], { followCursor: true, cursorAt: wander });
    const first = path.at(1500);
    for (let t = 1500; t <= 6500; t += 7) {
      const s = path.at(t);
      expect(s.x).toBe(first.x);
      expect(s.y).toBe(first.y);
    }
  });

  it('pans only when the cursor pushes past the boundary, and only as far as needed', () => {
    // Cursor sits still, then moves to x = 0.8 (boundary is 0.5 + 0.125 = 0.625).
    const path = buildCameraPath([pill()], {
      followCursor: true,
      cursorAt: cursorFrom([[0, 0.5, 0.5], [2500, 0.5, 0.5], [2900, 0.8, 0.5]])
    });
    expect(path.at(2400).x).toBe(path.at(1500).x); // nothing moved before the push
    const settled = path.at(6500);
    expect(settled.x).toBeCloseTo(0.8 - safeHalf, 2);   // cursor ends on the box edge: 0.675
    expect(settled.y).toBeCloseTo(0.5, 6);              // other axis untouched
  });

  it('pans smoothly (no overshoot, no jump)', () => {
    const path = buildCameraPath([pill()], {
      followCursor: true,
      cursorAt: cursorFrom([[0, 0.5, 0.5], [2500, 0.5, 0.5], [2600, 0.8, 0.5]])
    });
    let prev = path.at(2500).x;
    let maxStep = 0;
    for (let t = 2500; t <= 6500; t += 8.33) {
      const x = path.at(t).x;
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9);       // never moves back
      expect(x).toBeLessThanOrEqual(0.8 - safeHalf + 1e-3); // never overshoots the target
      maxStep = Math.max(maxStep, x - prev);
      prev = x;
    }
    expect(maxStep).toBeLessThan(0.01); // a gentle per-frame move
  });

  it('once the cursor is back inside the box the camera settles and is still again', () => {
    const path = buildCameraPath([pill()], {
      followCursor: true,
      cursorAt: cursorFrom([[0, 0.5, 0.5], [2000, 0.5, 0.5], [2300, 0.7, 0.5], [2400, 0.7, 0.5]])
    });
    expect(path.at(5000).x).toBe(path.at(6000).x);
  });

  it('never leaves the frame: the camera is clamped at the edges', () => {
    const path = buildCameraPath([pill({ targetX: 0.9, targetY: 0.9 })], {
      followCursor: true,
      cursorAt: cursorFrom([[0, 0.9, 0.9], [3000, 0.99, 0.99]])
    });
    for (let t = 0; t <= 8000; t += 25) {
      const s = path.at(t);
      const half = 0.5 / s.scale;
      expect(s.x).toBeGreaterThanOrEqual(half - 1e-9);
      expect(s.x).toBeLessThanOrEqual(1 - half + 1e-9);
      expect(s.y).toBeGreaterThanOrEqual(half - 1e-9);
      expect(s.y).toBeLessThanOrEqual(1 - half + 1e-9);
    }
  });

  it('Follow Cursor OFF is a fixed focus: the cursor is ignored', () => {
    const off = buildCameraPath([pill()], { followCursor: false, cursorAt: cursorFrom([[0, 0.5, 0.5], [3000, 0.95, 0.95]]) });
    for (let t = 1500; t <= 6500; t += 100) {
      expect(off.at(t).x).toBeCloseTo(0.5, 9);
      expect(off.at(t).y).toBeCloseTo(0.5, 9);
    }
    const on = buildCameraPath([pill()], { followCursor: true, cursorAt: cursorFrom([[0, 0.5, 0.5], [3000, 0.95, 0.95]]) });
    expect(on.at(6000).x).toBeGreaterThan(0.6);
  });
});

describe('scrub / preview / export parity', () => {
  const cursorAt = cursorFrom([[0, 0.5, 0.5], [2500, 0.5, 0.5], [3200, 0.85, 0.2], [5500, 0.3, 0.7]]);
  const pills = [pill(), pill({ id: 'b', startTime: 8000, endTime: 12000, targetX: 0.3, targetY: 0.4, targetScale: 1.7 })];

  it('is a pure function of time: random-order scrubbing equals sequential evaluation', () => {
    const path = buildCameraPath(pills, { followCursor: true, cursorAt });
    const times = Array.from({ length: 400 }, (_, i) => i * 31);
    const sequential = times.map((t) => path.at(t));
    const shuffled = [...times.keys()].sort((a, b) => ((a * 7919) % 401) - ((b * 7919) % 401));
    for (const i of shuffled) expect(path.at(times[i])).toEqual(sequential[i]);
  });

  it('two independent builds (preview vs export) give bit-identical cameras', () => {
    const a = buildCameraPath(pills, { followCursor: true, cursorAt });
    const b = buildCameraPath(pills.map((p) => ({ ...p })), { followCursor: true, cursorAt });
    for (let t = 0; t <= 13_000; t += 16.667) expect(a.at(t)).toEqual(b.at(t));
  });

  it('the camera at a given time does not depend on the frame rate it is sampled at', () => {
    const path = buildCameraPath(pills, { followCursor: true, cursorAt });
    const at = (fps: number) => {
      const out = new Map<number, unknown>();
      for (let f = 0; f * (1000 / fps) <= 12_000; f++) out.set(Math.round(f * (1000 / fps) * 1000), path.at(f * (1000 / fps)));
      return out;
    };
    const hz60 = at(60);
    for (const [key, state] of at(15)) if (hz60.has(key)) expect(hz60.get(key)).toEqual(state);
    for (const [key, state] of at(120)) if (hz60.has(key)) expect(hz60.get(key)).toEqual(state);
  });

  it('computeCinematicCameraState (the single-cursor form) agrees with a path built the same way', () => {
    const pillsArr = [pill()];
    const cursor = { x: 0.5, y: 0.5 };
    const path = buildCameraPath(pillsArr, { followCursor: true, cursorAt: () => cursor });
    for (let t = 0; t <= 8000; t += 250) expect(computeCinematicCameraState(t, pillsArr, cursor, 1920, 1080, true)).toEqual(path.at(t));
  });
});

describe('medium-distance camera hop', () => {
  const A = (over: Partial<ZoomPill> = {}) => pill({ id: 'a', startTime: 0, endTime: 3000, targetX: 0.3, targetY: 0.5, targetScale: 2, ...over });
  const B = (over: Partial<ZoomPill> = {}) => pill({ id: 'b', startTime: 3000, endTime: 7000, targetX: 0.6, targetY: 0.5, targetScale: 2, ...over });
  // Chained with a 0 ms gap: the move is [3000, 3450]; its midpoint is 3225.
  const mid = 3000 + DEFAULT_TRANSITION_MS / 2;

  it('dips to max(1.25, min(a, b) * 0.72) at the midpoint: 2.0x -> ~1.44x -> 2.0x', () => {
    expect(HOP_DIP_FACTOR).toBe(0.72);
    expect(HOP_MIN_SCALE).toBe(1.25);
    const path = buildCameraPath([A(), B()], { followCursor: false });
    expect(path.at(2999).scale).toBeCloseTo(2, 3);
    expect(path.at(mid).scale).toBeCloseTo(1.44, 6);
    expect(path.at(3450).scale).toBeCloseTo(2, 6);
    // It is a dip, not a snap back: never below the dip, never near 1.0x.
    for (let t = 3000; t <= 3450; t += 5) expect(path.at(t).scale).toBeGreaterThanOrEqual(1.44 - 1e-6);
  });

  it('pans while it dips: the focus travels from the first target to the second', () => {
    const path = buildCameraPath([A(), B()], { followCursor: false });
    expect(path.at(2999).x).toBeCloseTo(0.3, 2);
    expect(path.at(3450).x).toBeCloseTo(0.6, 6);
    expect(path.at(mid).x).toBeGreaterThan(0.3);
    expect(path.at(mid).x).toBeLessThanOrEqual(0.6);
  });

  it('the dip is relative to the smaller of the two scales, with a floor of 1.25x', () => {
    const lowFloor = buildCameraPath([A({ targetScale: 2.5 }), B({ targetScale: 1.6 })], { followCursor: false });
    expect(lowFloor.at(mid).scale).toBeCloseTo(Math.max(1.25, 1.6 * 0.72) /* 1.25 */, 1);
    const high = buildCameraPath([A({ targetScale: 2.5 }), B({ targetScale: 2.5 })], { followCursor: false });
    expect(high.at(mid).scale).toBeCloseTo(2.5 * 0.72, 6);
  });

  it('works across a small gap (<= 800 ms) as well', () => {
    const path = buildCameraPath([A({ endTime: 3000 }), B({ startTime: 3600 })], { followCursor: false });
    // The move spans the whole gap [3000, 3600]; its midpoint is 3300.
    expect(path.at(3300).scale).toBeCloseTo(1.44, 6);
    expect(path.at(3000).scale).toBeCloseTo(2, 6);
    expect(path.at(3600).scale).toBeCloseTo(2, 6);
  });

  it('no dip for targets closer than 0.25 or farther than 0.55 (flat pan)', () => {
    const near = buildCameraPath([A(), B({ targetX: 0.4 })], { followCursor: false });  // 0.1 apart
    const far = buildCameraPath([A({ targetX: 0.2 }), B({ targetX: 0.85 })], { followCursor: false }); // 0.65 apart
    for (const path of [near, far]) {
      for (let t = 3000; t <= 3450; t += 25) expect(path.at(t).scale).toBeCloseTo(2, 6);
    }
  });

  it('boundary distances 0.25 and 0.55 hop; the in-between scale still reaches the second zoom', () => {
    const lo = buildCameraPath([A({ targetX: 0.3 }), B({ targetX: 0.55 })], { followCursor: false });
    const hi = buildCameraPath([A({ targetX: 0.2 }), B({ targetX: 0.75 })], { followCursor: false });
    expect(lo.at(mid).scale).toBeLessThan(1.5);
    expect(hi.at(mid).scale).toBeLessThan(1.5);
  });

  it('zooms further apart than 800 ms go back to 1.0x in between', () => {
    const path = buildCameraPath([A({ endTime: 3000 }), B({ startTime: 4200 })], { followCursor: false });
    expect(path.at(3800).scale).toBeCloseTo(1, 6);
  });
});

describe('robustness', () => {
  it('no zooms: the neutral camera', () => {
    expect(buildCameraPath([], {}).at(1234)).toEqual({ x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 });
  });

  it('overlapping manual zooms hand over instead of fighting', () => {
    const path = buildCameraPath(
      [pill({ id: 'a', startTime: 0, endTime: 5000, targetX: 0.3 }), pill({ id: 'b', startTime: 3000, endTime: 8000, targetX: 0.7 })],
      { followCursor: false }
    );
    for (let t = 0; t <= 8500; t += 50) {
      const s = path.at(t);
      expect(Number.isFinite(s.x) && Number.isFinite(s.scale)).toBe(true);
    }
    expect(path.at(6000).x).toBeCloseTo(0.7, 6);
  });

  it('ignores zooms with invalid times and NaN query times', () => {
    const path = buildCameraPath([pill({ startTime: NaN }), pill({ startTime: 500, endTime: 400 })], {});
    expect(path.at(NaN)).toEqual({ x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 });
    expect(path.at(2000).scale).toBe(1);
  });

  it('legacy pixel cursor coordinates are normalized by the viewport', () => {
    const px = buildCameraPath([pill()], { followCursor: true, viewportWidth: 1920, viewportHeight: 1080, cursorAt: () => ({ x: 960, y: 540 }) });
    const norm = buildCameraPath([pill()], { followCursor: true, cursorAt: () => ({ x: 0.5, y: 0.5 }) });
    expect(px.at(4000)).toEqual(norm.at(4000));
  });
});

import { describe, expect, it } from 'vitest';
import { CursorSplineEngine } from '../../src/engine/cursor-spline';
import { ClickEvent, MousePoint } from '../../src/types/telemetry';

const points: MousePoint[] = [
  { t: 0, x: 0.1, y: 0.1, c: 'default' },
  { t: 4700, x: 0.2, y: 0.2, c: 'pointer' },
  { t: 6900, x: 0.8, y: 0.8, c: 'pointer' },
  { t: 7000, x: 0.9, y: 0.9, c: 'pointer' },
];

describe('cut-aware cursor spline', () => {
  it('snaps to the post-cut sample without interpolating across a removed span', () => {
    const engine = new CursorSplineEngine(points, [], [], {
      cutRanges: [{ startTime: 4700, endTime: 6900 }],
    });

    const seam = engine.getCursorAt(6916);
    expect(seam.x).toBeCloseTo(0.8, 3);
    expect(seam.y).toBeCloseTo(0.8, 3);
    expect(seam.speed).toBe(0);
    expect(seam.opacity).toBeGreaterThan(0);
    expect(seam.opacity).toBeLessThan(1);
  });

  it('keeps the exact click coordinate while smoothing surrounding motion', () => {
    const clicks: ClickEvent[] = [{ t: 100, x: 0.5, y: 0.5, button: 0, targetTag: 'BUTTON' }];
    const engine = new CursorSplineEngine([
      { t: 0, x: 0.2, y: 0.2, c: 'default' },
      { t: 100, x: 0.5, y: 0.5, c: 'pointer' },
      { t: 200, x: 0.8, y: 0.8, c: 'pointer' },
    ], clicks, [], { smoothing: 1 });

    const atClick = engine.getCursorAt(100);
    expect(atClick.x).toBe(0.5);
    expect(atClick.y).toBe(0.5);
  });

  it('suppresses the glide trail for low-FPS GIF output', () => {
    const engine = new CursorSplineEngine([
      { t: 0, x: 0.1, y: 0.1, c: 'default' },
      { t: 50, x: 0.8, y: 0.8, c: 'default' },
      { t: 100, x: 0.95, y: 0.95, c: 'default' },
    ]);

    expect(engine.getTrailAt(75, 4, 15)).toEqual([]);
    expect(engine.getTrailAt(75, 4, 60).length).toBeGreaterThan(0);
  });
});

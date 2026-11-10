import { describe, it, expect } from 'vitest';
import { CursorSplineEngine } from '../../src/engine/cursor-spline';
import { MousePoint, ClickEvent } from '../../src/types/telemetry';

describe('CursorSplineEngine', () => {
  it('returns default zero state when no mouse points exist', () => {
    const engine = new CursorSplineEngine([]);
    const pos = engine.getCursorAt(100);

    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
    expect(pos.style).toBe('default');
    expect(pos.speed).toBe(0);
  });

  it('clamps to first mouse point when time is prior to first timestamp', () => {
    const points: MousePoint[] = [
      { t: 1000, x: 200, y: 300, c: 'pointer' },
      { t: 2000, x: 500, y: 600, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);
    const pos = engine.getCursorAt(500);

    expect(pos.x).toBe(200);
    expect(pos.y).toBe(300);
    expect(pos.style).toBe('pointer');
    expect(pos.speed).toBe(0);
  });

  it('clamps to last mouse point when time exceeds last timestamp', () => {
    const points: MousePoint[] = [
      { t: 1000, x: 200, y: 300, c: 'pointer' },
      { t: 2000, x: 500, y: 600, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);
    const pos = engine.getCursorAt(3000);

    expect(pos.x).toBe(500);
    expect(pos.y).toBe(600);
    expect(pos.style).toBe('default');
    expect(pos.speed).toBe(0);
  });

  it('smoothly interpolates between points using Catmull-Rom spline', () => {
    const points: MousePoint[] = [
      { t: 0, x: 0, y: 0, c: 'default' },
      { t: 1000, x: 100, y: 100, c: 'default' },
      { t: 2000, x: 200, y: 200, c: 'default' },
      { t: 3000, x: 300, y: 300, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);

    // Midpoint at 1500ms
    const pos = engine.getCursorAt(1500);
    expect(pos.x).toBeGreaterThan(100);
    expect(pos.x).toBeLessThan(200);
    expect(pos.y).toBeGreaterThan(100);
    expect(pos.y).toBeLessThan(200);
  });

  it('computes instantaneous velocity and speed on rapid movement', () => {
    const points: MousePoint[] = [
      { t: 0, x: 0, y: 0, c: 'default' },
      { t: 50, x: 100, y: 0, c: 'default' },
      { t: 100, x: 200, y: 0, c: 'default' },
      { t: 150, x: 300, y: 0, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);

    const pos = engine.getCursorAt(75);
    expect(pos.vx).toBeGreaterThan(0);
    expect(pos.speed).toBeGreaterThan(0);
  });
});

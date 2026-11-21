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

  it('interpolates normalized 0..1 coordinates accurately', () => {
    const points: MousePoint[] = [
      { t: 0, x: 0.1, y: 0.2, c: 'default' },
      { t: 1000, x: 0.5, y: 0.6, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);
    const pos = engine.getCursorAt(500);

    expect(pos.x).toBeCloseTo(0.3, 2);
    expect(pos.y).toBeCloseTo(0.4, 2);
    expect(pos.x).toBeLessThanOrEqual(1.0);
    expect(pos.y).toBeLessThanOrEqual(1.0);
  });

  it('scales normalized coordinates in drawCursor fallback to canvas dimensions', () => {
    const points: MousePoint[] = [
      { t: 0, x: 0.5, y: 0.5, c: 'default' }
    ];
    const clicks: ClickEvent[] = [
      { t: 0, x: 0.5, y: 0.5, button: 0, targetTag: 'button' }
    ];
    const engine = new CursorSplineEngine(points, clicks);

    const translateCalls: [number, number][] = [];
    const arcCalls: [number, number, number][] = [];
    const mockCtx = {
      canvas: { width: 1920, height: 1080 },
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      arc: (x: number, y: number, r: number) => { arcCalls.push([x, y, r]); },
      stroke: () => {},
      fill: () => {},
      translate: (x: number, y: number) => { translateCalls.push([x, y]); },
      moveTo: () => {},
      lineTo: () => {},
    } as unknown as CanvasRenderingContext2D;

    const cursor = engine.getCursorAt(0);
    engine.drawCursor(mockCtx, cursor, 50);

    // Ripple click position scaled to canvas (960, 540) not (0.5, 0.5)
    expect(arcCalls.length).toBeGreaterThan(0);
    expect(arcCalls[0][0]).toBe(960);
    expect(arcCalls[0][1]).toBe(540);

    // Vector cursor translation scaled to canvas (960, 540) not (0.5, 0.5)
    expect(translateCalls.length).toBe(1);
    expect(translateCalls[0][0]).toBe(960);
    expect(translateCalls[0][1]).toBe(540);
  });
});

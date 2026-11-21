import { describe, it, expect } from 'vitest';
import {
  CursorSplineEngine,
  CURSOR_IDLE_TIMEOUT_MS,
  CURSOR_IDLE_FADE_MS
} from '../../src/engine/cursor-spline';
import { MousePoint, ClickEvent } from '../../src/types/telemetry';

describe('OS Cursor Suppression & Idle Cursor Fade', () => {
  it('maintains full opacity (1.0) while active and under 1500 ms idle', () => {
    const points: MousePoint[] = [
      { t: 0, x: 100, y: 100, c: 'default' },
      { t: 1000, x: 200, y: 200, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);

    // During active movement
    expect(engine.getCursorOpacityAt(500)).toBe(1.0);
    expect(engine.getCursorAt(500).opacity).toBe(1.0);

    // Under 1500ms after last point (t=1000)
    expect(engine.getCursorOpacityAt(1500)).toBe(1.0); // 500ms idle
    expect(engine.getCursorOpacityAt(2000)).toBe(1.0); // 1000ms idle
    expect(engine.getCursorOpacityAt(2500)).toBe(1.0); // 1500ms idle (exact threshold)
  });

  it('smoothly ramps opacity from 1.0 down to 0.0 over 300 ms (1500 ms to 1800 ms idle)', () => {
    const points: MousePoint[] = [
      { t: 1000, x: 100, y: 100, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);

    // 1500ms idle => opacity 1.0
    expect(engine.getCursorOpacityAt(2500)).toBe(1.0);

    // 1650ms idle (150ms into 300ms fade) => halfway cosine ramp (0.5)
    const midOpacity = engine.getCursorOpacityAt(2650);
    expect(midOpacity).toBeCloseTo(0.5, 4);

    // 1800ms idle (300ms into fade) => 0.0
    expect(engine.getCursorOpacityAt(2800)).toBeCloseTo(0.0, 4);

    // Beyond 1800ms idle => stays 0.0
    expect(engine.getCursorOpacityAt(3500)).toBe(0.0);
    expect(engine.getCursorAt(3500).opacity).toBe(0.0);
  });

  it('immediately restores full opacity on next mouse movement after being idle', () => {
    const points: MousePoint[] = [
      { t: 1000, x: 100, y: 100, c: 'default' },
      { t: 5000, x: 300, y: 300, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);

    // Deep in idle (t=4000 => 3000ms idle) => 0.0
    expect(engine.getCursorOpacityAt(4000)).toBe(0.0);

    // Right before next movement at 5000ms
    expect(engine.getCursorOpacityAt(4999)).toBe(0.0);

    // Exact moment of movement at 5000ms => IMMEDIATELY 1.0
    expect(engine.getCursorOpacityAt(5000)).toBe(1.0);
    expect(engine.getCursorAt(5000).opacity).toBe(1.0);

    // After movement
    expect(engine.getCursorOpacityAt(5500)).toBe(1.0);
  });

  it('immediately restores full opacity on click event during idle', () => {
    const points: MousePoint[] = [
      { t: 1000, x: 100, y: 100, c: 'default' }
    ];
    const clicks: ClickEvent[] = [
      { t: 3500, x: 100, y: 100, button: 0, targetTag: 'button' }
    ];
    const engine = new CursorSplineEngine(points, clicks);

    // At t=3000: 2000ms since point at 1000 => idle > 1800ms => 0.0
    expect(engine.getCursorOpacityAt(3000)).toBe(0.0);

    // At t=3500: click occurred! Immediately 1.0
    expect(engine.getCursorOpacityAt(3500)).toBe(1.0);
    expect(engine.getCursorAt(3500).opacity).toBe(1.0);

    // 1000ms after click (t=4500) => still under 1500ms => 1.0
    expect(engine.getCursorOpacityAt(4500)).toBe(1.0);

    // 1800ms after click (t=5300) => faded to 0.0
    expect(engine.getCursorOpacityAt(5300)).toBe(0.0);
  });

  it('skips cursor canvas rendering when cursor opacity <= 0.001', () => {
    const points: MousePoint[] = [
      { t: 0, x: 100, y: 100, c: 'default' }
    ];
    const engine = new CursorSplineEngine(points);

    let pathDrawn = false;
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => { pathDrawn = true; },
      arc: () => {},
      stroke: () => {},
      fill: () => {},
      translate: () => {},
      scale: () => {},
      moveTo: () => {},
      lineTo: () => {},
      globalAlpha: 1.0
    } as any;

    // At t=3000: idle > 1800ms => opacity is 0.0
    const cursor = engine.getCursorAt(3000);
    expect(cursor.opacity).toBe(0.0);

    engine.drawCursorAt(mockCtx, cursor, 100, 100, 3000);
    expect(pathDrawn).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { CursorSplineEngine } from '../../src/engine/cursor-spline';
import { MousePoint, ClickEvent } from '../../src/types/telemetry';

describe('Cursor Smoother: Inertial Gliding, Spline Paths, & Click Snapping', () => {
  describe('1. Linear & Catmull-Rom Spline Interpolation Paths', () => {
    it('dampens sudden directional spikes across high-frequency 120Hz micro-movements', () => {
      // Jagged high-frequency path simulating nervous hand jitter (< 120ms between points)
      const jitteryPoints: MousePoint[] = [
        { t: 0, x: 100, y: 100, c: 'default' },
        { t: 20, x: 140, y: 80, c: 'default' },  // Sharp spike upwards-right
        { t: 40, x: 180, y: 130, c: 'default' }, // Sharp spike downwards-right
        { t: 60, x: 220, y: 90, c: 'default' },  // Sharp spike upwards-right
        { t: 80, x: 260, y: 110, c: 'default' }
      ];

      const engine = new CursorSplineEngine(jitteryPoints);

      // Sample midpoint between jagged points (t = 30ms, between t=20 and t=40)
      const smoothed = engine.getCursorAt(30);

      // The Catmull-Rom cubic polynomial continuous curvature must dampen extreme peak/valley overshoot
      expect(smoothed.x).toBeGreaterThan(140);
      expect(smoothed.x).toBeLessThan(180);
      expect(smoothed.y).toBeGreaterThan(80);
      expect(smoothed.y).toBeLessThan(130);
    });

    it('falls back to linear interpolation during long pauses to prevent cubic spline overshoot', () => {
      // Long dwell time (> 120ms interval)
      const pausePoints: MousePoint[] = [
        { t: 0, x: 100, y: 100, c: 'default' },
        { t: 500, x: 300, y: 300, c: 'default' } // 500ms segment (> 120ms)
      ];

      const engine = new CursorSplineEngine(pausePoints);

      // Midpoint at 250ms must evaluate to exact linear mid-coordinate (200, 200)
      const mid = engine.getCursorAt(250);
      expect(mid.x).toBeCloseTo(200, 2);
      expect(mid.y).toBeCloseTo(200, 2);
    });

    it('calculates instantaneous directional velocity vectors and scalar speed', () => {
      const movingPoints: MousePoint[] = [
        { t: 0, x: 0, y: 0, c: 'default' },
        { t: 50, x: 100, y: 0, c: 'default' }, // Moving horizontally at 2000 px/sec
        { t: 100, x: 200, y: 0, c: 'default' }
      ];

      const engine = new CursorSplineEngine(movingPoints);
      const cursor = engine.getCursorAt(25);

      expect(cursor.vx).toBeGreaterThan(0);
      expect(cursor.vy).toBe(0);
      expect(cursor.speed).toBeCloseTo(cursor.vx, 2);
    });

    it('dampens velocity vector to zero during stationary pauses (segment >= 300ms)', () => {
      const dwellPoints: MousePoint[] = [
        { t: 0, x: 500, y: 500, c: 'default' },
        { t: 600, x: 500, y: 500, c: 'default' } // Paused for 600ms
      ];

      const engine = new CursorSplineEngine(dwellPoints);
      const cursor = engine.getCursorAt(300);

      expect(cursor.vx).toBe(0);
      expect(cursor.vy).toBe(0);
      expect(cursor.speed).toBe(0);
    });
  });

  describe('2. Click Event Coordinate Snapping & Alignment', () => {
    it('snaps tightly to recorded click coordinate without asynchronous lag', () => {
      const mousePoints: MousePoint[] = [
        { t: 900, x: 440, y: 290, c: 'default' },
        { t: 1000, x: 450, y: 300, c: 'pointer' },
        { t: 1100, x: 460, y: 310, c: 'default' }
      ];

      const clicks: ClickEvent[] = [
        { t: 1000, x: 450, y: 300, button: 0, targetTag: 'BUTTON' }
      ];

      const engine = new CursorSplineEngine(mousePoints, clicks);

      // At exactly t = 1000ms, cursor should align perfectly with the click point
      const cursorAtClick = engine.getCursorAt(1000);
      expect(cursorAtClick.x).toBe(450);
      expect(cursorAtClick.y).toBe(300);
      expect(cursorAtClick.style).toBe('pointer');
    });

    it.each([
      ['Smooth', 0.6],
      ['Cinematic', 0.9]
    ])('removes at least 65%% of diagonal jitter in %s while pinning a click', (_preset, smoothing) => {
      const points: MousePoint[] = [];
      for (let i = 0; i <= 120; i++) {
        const t = i * (1000 / 60);
        const x = 200 + i * 4;
        const lateralJitter = i % 2 === 0 ? -8 : 8;
        points.push({ x, y: x + lateralJitter, t, c: i === 30 ? 'pointer' : 'default' });
      }
      const click = points[30];
      const engine = new CursorSplineEngine(points, [
        { t: click.t, x: click.x, y: click.y, button: 0, targetTag: 'BUTTON' }
      ], [], { smoothing });

      const errors: number[] = [];
      for (let i = 3; i < points.length - 3; i++) {
        const point = points[i];
        const cursor = engine.getCursorAt(point.t);
        errors.push((cursor.y - cursor.x) / Math.sqrt(2));
      }
      const rms = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
      const rawRms = 8 / Math.sqrt(2);
      expect(1 - rms / rawRms).toBeGreaterThanOrEqual(0.65);

      const atClick = engine.getCursorAt(click.t);
      expect(Math.hypot(atClick.x - click.x, atClick.y - click.y)).toBeLessThanOrEqual(1);
    });

    it('robustly sorts chronological telemetry entries arriving out-of-order', () => {
      // Unsorted telemetry arrays
      const unsortedPoints: MousePoint[] = [
        { t: 2000, x: 800, y: 800, c: 'default' },
        { t: 500, x: 200, y: 200, c: 'pointer' },
        { t: 1000, x: 400, y: 400, c: 'default' }
      ];

      const engine = new CursorSplineEngine(unsortedPoints);

      // Querying before t = 500ms should clamp to the earliest point (t=500, x=200)
      const early = engine.getCursorAt(200);
      expect(early.x).toBe(200);
      expect(early.y).toBe(200);

      // Querying past t = 2000ms should clamp to the latest point (t=2000, x=800)
      const late = engine.getCursorAt(2500);
      expect(late.x).toBe(800);
      expect(late.y).toBe(800);
    });

    it('tracks recorded clicks array accurately for physics ripple overlays', () => {
      const clicks: ClickEvent[] = [
        { t: 100, x: 150, y: 250, button: 0, targetTag: 'BUTTON' },
        { t: 800, x: 350, y: 450, button: 0, targetTag: 'INPUT' }
      ];

      const engine = new CursorSplineEngine([], clicks);
      const registeredClicks = engine.getClicks();

      expect(registeredClicks.length).toBe(2);
      expect(registeredClicks[0].x).toBe(150);
      expect(registeredClicks[1].x).toBe(350);
    });
  });
});

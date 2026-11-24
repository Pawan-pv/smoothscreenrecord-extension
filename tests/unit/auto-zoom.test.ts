import { describe, it, expect } from 'vitest';
import {
  generateAutoZoomPills,
  calculateIsometricTilt,
  computeCinematicCameraState,
  CameraState
} from '../../src/engine/spring-physics';
import { ClickEvent, InputFocusEvent, ZoomPill, BoundingBox } from '../../src/types/telemetry';

describe('Auto-Zoom Core Logic: Coordinate Bounds, Dynamic Scaling, & Indicators', () => {
  const VIEWPORT_W = 1920;
  const VIEWPORT_H = 1080;

  describe('1. Coordinate Bounds Targeting & Click Mapping', () => {
    it('accurately maps direct pixel click coordinates to normalized center space', () => {
      const click: ClickEvent = {
        t: 1000,
        x: 960,
        y: 540,
        button: 0,
        targetTag: 'BUTTON'
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      const pill = pills[0];
      // Exactly in center of 1920x1080 canvas
      expect(pill.targetX).toBeCloseTo(0.5, 2);
      expect(pill.targetY).toBeCloseTo(0.5, 2);
    });

    it('isolates container bounding box center when climbing parent DOM elements with click near center', () => {
      // Card spans 600x400 centered around (800, 500), click near center (750, 480) within 250px
      const containerBounds: BoundingBox = {
        x: 500,
        y: 300,
        width: 600,
        height: 400
      };

      const click: ClickEvent = {
        t: 1200,
        x: 750,
        y: 480,
        button: 0,
        targetTag: 'BUTTON',
        containerBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      const pill = pills[0];
      // Expected center: (500 + 300) = 800px -> 800 / 1920 = 0.4166
      // (300 + 200) = 500px -> 500 / 1080 = 0.4629
      expect(pill.targetX).toBeCloseTo(800 / VIEWPORT_W, 2);
      expect(pill.targetY).toBeCloseTo(500 / VIEWPORT_H, 2);
    });

    it('blends 70% click + 30% container center when click is distant (> 250px) or container is wide', () => {
      // Click at top-left of a modal card (520, 310), card spans 600x400 centered at (800, 500), dist = 338px > 250px
      const containerBounds: BoundingBox = {
        x: 500,
        y: 300,
        width: 600,
        height: 400
      };

      const click: ClickEvent = {
        t: 1200,
        x: 520,
        y: 310,
        button: 0,
        targetTag: 'BUTTON',
        containerBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      const pill = pills[0];
      // Expected blend: 0.7 * 520 + 0.3 * 800 = 364 + 240 = 604px
      // 0.7 * 310 + 0.3 * 500 = 217 + 150 = 367px
      expect(pill.targetX).toBeCloseTo(604 / VIEWPORT_W, 2);
      expect(pill.targetY).toBeCloseTo(367 / VIEWPORT_H, 2);
    });

    it('enforces safety margin clamping [0.12, 0.88] preventing viewport clipping off-screen', () => {
      const edgeClicks: ClickEvent[] = [
        { t: 1000, x: 10, y: 10, button: 0, targetTag: 'A' }, // Extreme top-left
        { t: 6000, x: 1910, y: 1070, button: 0, targetTag: 'A' } // Extreme bottom-right
      ];

      const pills = generateAutoZoomPills(edgeClicks, [], 15000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(2);

      // Top-left click clamped to safe margin
      expect(pills[0].targetX).toBeGreaterThanOrEqual(0.12);
      expect(pills[0].targetY).toBeGreaterThanOrEqual(0.12);

      // Bottom-right click clamped to safe margin
      expect(pills[1].targetX).toBeLessThanOrEqual(0.88);
      expect(pills[1].targetY).toBeLessThanOrEqual(0.88);
    });
  });

  describe('2. Dynamic Viewport Scaling & Hierarchy Adaptation', () => {
    it('applies punchy 2.1x scale to tiny interactive elements (< 20% canvas width)', () => {
      const smallBtnBounds: BoundingBox = {
        x: 400,
        y: 300,
        width: 120, // 120 / 1920 = 0.0625 (< 0.20)
        height: 40
      };

      const click: ClickEvent = {
        t: 1500,
        x: 460,
        y: 320,
        button: 0,
        targetTag: 'BUTTON',
        containerBounds: smallBtnBounds
      };

      const pills = generateAutoZoomPills([click], [], 8000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);
      expect(pills[0].targetScale).toBe(2.1);
    });

    it('applies gentle 1.35x scale to large full-width forms and modals (> 60% canvas width)', () => {
      const modalBounds: BoundingBox = {
        x: 200,
        y: 150,
        width: 1300, // 1300 / 1920 = 0.677 (> 0.60)
        height: 700
      };

      const click: ClickEvent = {
        t: 2000,
        x: 350,
        y: 200,
        button: 0,
        targetTag: 'INPUT',
        containerBounds: modalBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);
      expect(pills[0].targetScale).toBe(1.35);
    });

    it('applies balanced 1.7x scale to medium cards and content panels (20% - 60% width)', () => {
      const cardBounds: BoundingBox = {
        x: 300,
        y: 200,
        width: 650, // 650 / 1920 = 0.338 (20% - 60%)
        height: 450
      };

      const click: ClickEvent = {
        t: 2500,
        x: 400,
        y: 300,
        button: 0,
        targetTag: 'DIV',
        containerBounds: cardBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);
      expect(pills[0].targetScale).toBe(1.7);
    });

    it('calculates dynamic isometric perspective tilt opposing target displacement', () => {
      // Right quadrant target (x > 0.5) should tilt surface slightly left (negative tiltY)
      const rightTilt = calculateIsometricTilt(0.85, 0.5, 2.0);
      expect(rightTilt.tiltY).toBeLessThan(0);

      // Left quadrant target (x < 0.5) should tilt surface slightly right (positive tiltY)
      const leftTilt = calculateIsometricTilt(0.15, 0.5, 2.0);
      expect(leftTilt.tiltY).toBeGreaterThan(0);

      // Bottom quadrant target (y > 0.5) should tilt surface slightly back (positive tiltX)
      const bottomTilt = calculateIsometricTilt(0.5, 0.85, 2.0);
      expect(bottomTilt.tiltX).toBeGreaterThan(0);

      // Flat scale (<= 1.15) should produce zero perspective distortion
      const neutralTilt = calculateIsometricTilt(0.9, 0.9, 1.05);
      expect(neutralTilt.tiltX).toBe(0);
      expect(neutralTilt.tiltY).toBe(0);
    });
  });

  describe('3. Zoom Indicator Bounding Box & Temporal Clustering', () => {
    it('clusters rapid sequential clicks within 320px and 3.8s into a single continuous pill', () => {
      const clusteredClicks: ClickEvent[] = [
        { t: 1000, x: 500, y: 400, button: 0, targetTag: 'BUTTON' },
        { t: 1800, x: 550, y: 420, button: 0, targetTag: 'INPUT' }, // 53px away, 800ms later
        { t: 2600, x: 520, y: 410, button: 0, targetTag: 'BUTTON' } // 31px away, 800ms later
      ];

      const pills = generateAutoZoomPills(clusteredClicks, [], 10000, VIEWPORT_W, VIEWPORT_H);

      // Should coalesce into exactly 1 stable zoom pill rather than 3 jittery pills
      expect(pills.length).toBe(1);
      // Anticipates click by 300ms for smooth cinematic pre-framing (>= 90% settled at click)
      expect(pills[0].startTime).toBe(700);
      // Holds across all three clicks plus comfortable margin
      expect(pills[0].endTime).toBeGreaterThanOrEqual(2600);
    });

    it('splits distant or delayed clicks into discrete zoom sessions', () => {
      const separateClicks: ClickEvent[] = [
        { t: 1000, x: 300, y: 200, button: 0, targetTag: 'NAV' },
        // Displaced by 900px and 5 seconds later
        { t: 6000, x: 1200, y: 800, button: 0, targetTag: 'FOOTER' }
      ];

      const pills = generateAutoZoomPills(separateClicks, [], 15000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(2);
      expect(pills[0].targetX).toBeCloseTo(300 / VIEWPORT_W, 2);
      expect(pills[1].targetX).toBeCloseTo(1200 / VIEWPORT_W, 2);
    });

    it('generates focused zoom pills for text input typing events', () => {
      const inputEvent: InputFocusEvent = {
        t: 3000,
        type: 'focus',
        bounds: { x: 700, y: 400, width: 400, height: 60 }
      };

      const pills = generateAutoZoomPills([], [inputEvent], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);
      expect(pills[0].label).toBe('Typing Focus');
      expect(pills[0].targetX).toBeCloseTo(900 / VIEWPORT_W, 2);
      expect(pills[0].targetY).toBeCloseTo(430 / VIEWPORT_H, 2);
      expect(pills[0].targetScale).toBe(1.8);
    });
  });
});

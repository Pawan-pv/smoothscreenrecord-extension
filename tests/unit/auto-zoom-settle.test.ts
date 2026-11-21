import { describe, it, expect } from 'vitest';
import {
  generateAutoZoomPills,
  settleAndMergePills,
  computeCinematicCameraState
} from '../../src/engine/spring-physics';
import { normalizeCaptureCoordinates } from '../../src/content/dom-tracker';
import { ClickEvent, ZoomPill } from '../../src/types/telemetry';

describe('Requirement R4: Cursor Accuracy & Auto-Zoom Polish', () => {
  const VIEWPORT_W = 1920;
  const VIEWPORT_H = 1080;

  describe('1. Click Coalescing (< 400ms) & Minimum Settle Hold (1500ms)', () => {
    it('coalesces rapid double-clicks (< 400ms) into a single pill cluster', () => {
      const rapidClicks: ClickEvent[] = [
        { t: 1000, x: 0.3, y: 0.4, button: 0, targetTag: 'BUTTON' },
        { t: 1250, x: 0.31, y: 0.41, button: 0, targetTag: 'BUTTON' } // 250ms later (< 400ms)
      ];

      const pills = generateAutoZoomPills(rapidClicks, [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);
      expect(pills[0].startTime).toBe(700);
      expect(pills[0].targetX).toBeCloseTo(0.305, 2);
    });

    it('generates zero overlapping pills for rapid sequential clicks', () => {
      // Click 1 at 1000ms, Click 2 at 1800ms (800ms apart, > 400ms, different locations)
      const clicks: ClickEvent[] = [
        { t: 1000, x: 0.2, y: 0.3, button: 0, targetTag: 'BUTTON' },
        { t: 1800, x: 0.7, y: 0.6, button: 0, targetTag: 'A' }
      ];

      const pills = generateAutoZoomPills(clicks, [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(2);

      // Verify zero overlap: pill 1 ends exactly when or before pill 2 starts
      expect(pills[0].endTime).toBeLessThanOrEqual(pills[1].startTime);

      // Verify minimum settle hold on first pill (at least 1500ms duration)
      expect(pills[0].endTime - pills[0].startTime).toBeGreaterThanOrEqual(1500);

      // Second pill starts at or after first pill ends
      expect(pills[1].startTime).toBe(pills[0].endTime);
    });

    it('merges spatially close clicks (< 0.25 distance) into a single continuous pill', () => {
      // Two distinct clicks at 1000ms and 2000ms, but close together on the screen
      const rawPills: ZoomPill[] = [
        {
          id: 'p1',
          startTime: 700,
          endTime: 2500,
          targetX: 0.5,
          targetY: 0.5,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        },
        {
          id: 'p2',
          startTime: 1800,
          endTime: 4000,
          targetX: 0.55,
          targetY: 0.53, // distance ~0.058 < 0.25
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        }
      ];

      const merged = settleAndMergePills(rawPills, 10000);
      expect(merged.length).toBe(1);
      expect(merged[0].startTime).toBe(700);
      expect(merged[0].endTime).toBe(4000);
    });
  });

  describe('2. Inter-Pill Gap Bridging (< 800ms)', () => {
    it('bridges small gaps (< 800ms) between adjacent pills to eliminate zoom-out dips', () => {
      // Pill 1 ends at 2500ms, Pill 2 starts at 2900ms (gap = 400ms < 800ms)
      const rawPills: ZoomPill[] = [
        {
          id: 'p1',
          startTime: 1000,
          endTime: 2500,
          targetX: 0.2,
          targetY: 0.3,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        },
        {
          id: 'p2',
          startTime: 2900,
          endTime: 4500,
          targetX: 0.8,
          targetY: 0.7,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        }
      ];

      const bridged = settleAndMergePills(rawPills, 10000);
      expect(bridged.length).toBe(2);
      // Pill 1 is extended to meet Pill 2's start time exactly
      expect(bridged[0].endTime).toBe(bridged[1].startTime);
      expect(bridged[0].endTime).toBe(2900);
    });

    it('preserves large gaps (>= 800ms) allowing intentional camera zoom-out', () => {
      // Pill 1 ends at 2500ms, Pill 2 starts at 4000ms (gap = 1500ms >= 800ms)
      const rawPills: ZoomPill[] = [
        {
          id: 'p1',
          startTime: 1000,
          endTime: 2500,
          targetX: 0.2,
          targetY: 0.3,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        },
        {
          id: 'p2',
          startTime: 4000,
          endTime: 6000,
          targetX: 0.8,
          targetY: 0.7,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        }
      ];

      const result = settleAndMergePills(rawPills, 10000);
      expect(result.length).toBe(2);
      expect(result[0].endTime).toBe(2500);
      expect(result[1].startTime).toBe(4000);
    });
  });

  describe('3. Camera Transition Continuity without Dips or Snaps', () => {
    it('maintains continuous zoom scale across chained pills without dipping to 1.0', () => {
      const pills: ZoomPill[] = [
        {
          id: 'p1',
          startTime: 1000,
          endTime: 3000,
          targetX: 0.2,
          targetY: 0.2,
          targetScale: 2.0,
          tiltX: 0,
          tiltY: 0
        },
        {
          id: 'p2',
          startTime: 3000,
          endTime: 5000,
          targetX: 0.8,
          targetY: 0.8,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        }
      ];

      // Test across the junction (2700ms to 3300ms) in 50ms increments
      for (let t = 2700; t <= 3300; t += 50) {
        const state = computeCinematicCameraState(t, pills, undefined, VIEWPORT_W, VIEWPORT_H, false);
        // Scale should remain between 1.8 and 2.0 at all times, NEVER dipping towards neutral 1.0
        expect(state.scale).toBeGreaterThanOrEqual(1.75);
        expect(state.scale).toBeLessThanOrEqual(2.05);
      }
    });

    it('smoothly glides across unbridged inter-pill gaps (<= 800ms) without dipping to 1.0', () => {
      // Even if pills have a small 300ms gap (2500ms to 2800ms)
      const pills: ZoomPill[] = [
        {
          id: 'p1',
          startTime: 1000,
          endTime: 2500,
          targetX: 0.3,
          targetY: 0.3,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        },
        {
          id: 'p2',
          startTime: 2800,
          endTime: 4500,
          targetX: 0.7,
          targetY: 0.7,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        }
      ];

      // Sample inside the 300ms gap at 2650ms
      const midGapState = computeCinematicCameraState(2650, pills, undefined, VIEWPORT_W, VIEWPORT_H, false);
      expect(midGapState.scale).toBeGreaterThanOrEqual(1.7);
      expect(midGapState.x).toBeGreaterThan(0.3);
      expect(midGapState.x).toBeLessThan(0.7);
    });
  });

  describe('4. Coordinate Normalization & Backward Compatibility', () => {
    it('correctly interprets both capture-time normalized (<= 1.0) and legacy pixel coordinates (> 1.0)', () => {
      // Normalized click
      const normClick: ClickEvent = {
        t: 1000,
        x: 0.5,
        y: 0.5,
        button: 0,
        targetTag: 'BUTTON'
      };

      // Legacy pixel click (1920x1080 center is 960, 540)
      const pixelClick: ClickEvent = {
        t: 5000,
        x: 960,
        y: 540,
        button: 0,
        targetTag: 'BUTTON'
      };

      const pills = generateAutoZoomPills([normClick, pixelClick], [], 15000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(2);

      // Both should resolve to 0.5 normalized center
      expect(pills[0].targetX).toBeCloseTo(0.5, 2);
      expect(pills[0].targetY).toBeCloseTo(0.5, 2);
      expect(pills[1].targetX).toBeCloseTo(0.5, 2);
      expect(pills[1].targetY).toBeCloseTo(0.5, 2);
    });

    it('computes camera state correctly with normalized vs pixel cursor coordinates', () => {
      const pills: ZoomPill[] = [
        {
          id: 'p1',
          startTime: 1000,
          endTime: 3000,
          targetX: 0.5,
          targetY: 0.5,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0
        }
      ];

      // Normalized cursor at (0.8, 0.2)
      const stateNorm = computeCinematicCameraState(2000, pills, { x: 0.8, y: 0.2 }, VIEWPORT_W, VIEWPORT_H, true);

      // Legacy pixel cursor at (0.8 * 1920 = 1536, 0.2 * 1080 = 216)
      const statePixel = computeCinematicCameraState(2000, pills, { x: 1536, y: 216 }, VIEWPORT_W, VIEWPORT_H, true);

      // Camera focal position should match within 0.01
      expect(stateNorm.x).toBeCloseTo(statePixel.x, 2);
      expect(stateNorm.y).toBeCloseTo(statePixel.y, 2);
    });
  });

  describe('5. Capture-Time Coordinate Normalization & Same-Origin Iframe Offsets', () => {
    it('normalizes client coordinates against top window viewport and iframe offsets', () => {
      // Mock top window with 1920x1080 viewport
      const mockTopWindow = {
        innerWidth: 1920,
        innerHeight: 1080,
        devicePixelRatio: 2.0,
        document: {
          documentElement: { clientWidth: 1920, clientHeight: 1080 }
        }
      } as unknown as Window;

      // Event directly on top window
      const topEvent = {
        clientX: 960,
        clientY: 540,
        target: { ownerDocument: mockTopWindow.document }
      } as unknown as MouseEvent;

      const normTop = normalizeCaptureCoordinates(topEvent, mockTopWindow);
      expect(normTop.x).toBeCloseTo(0.5, 3);
      expect(normTop.y).toBeCloseTo(0.5, 3);
      expect(normTop.offsetX).toBe(0);
      expect(normTop.offsetY).toBe(0);

      // Event inside a same-origin iframe located at (200, 150) in the top window
      const mockIframeElement = {
        getBoundingClientRect: () => ({ left: 200, top: 150, width: 800, height: 600 }),
        ownerDocument: mockTopWindow.document
      };
      const mockIframeWindow = {
        frameElement: mockIframeElement,
        document: {}
      };
      const iframeEvent = {
        clientX: 100,
        clientY: 50,
        target: {
          ownerDocument: mockIframeWindow.document
        },
        view: mockIframeWindow
      } as unknown as MouseEvent;
      (mockIframeWindow.document as any).defaultView = mockIframeWindow;

      const normIframe = normalizeCaptureCoordinates(iframeEvent, mockTopWindow);
      // Absolute top coords: X = 100 + 200 = 300 -> 300 / 1920 = 0.15625
      // Absolute top coords: Y = 50 + 150 = 200 -> 200 / 1080 = 0.18518
      expect(normIframe.offsetX).toBe(200);
      expect(normIframe.offsetY).toBe(150);
      expect(normIframe.x).toBeCloseTo(300 / 1920, 3);
      expect(normIframe.y).toBeCloseTo(200 / 1080, 3);
    });
  });
});

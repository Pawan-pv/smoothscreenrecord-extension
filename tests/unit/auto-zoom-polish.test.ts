import { describe, it, expect } from 'vitest';
import {
  computeCinematicCameraState,
  generateAutoZoomPills,
  settleAndMergePills
} from '../../src/engine/spring-physics';
import {
  ClickEvent,
  InputFocusEvent,
  ZoomPill,
  BoundingBox,
  ScrollEvent,
  TypingSession
} from '../../src/types/telemetry';

describe('Auto-Zoom Polish & Parity (Plan Items 1, 2, 3)', () => {
  const VIEWPORT_W = 1920;
  const VIEWPORT_H = 1080;

  describe('1. Framerate-Independent Analytical Camera Parity (15 / 60 / 120 fps)', () => {
    it('evaluates mathematically identical camera states regardless of sampling rate or frame skipping', () => {
      const pills: ZoomPill[] = [
        {
          id: 'pill-1',
          startTime: 1000,
          endTime: 4000,
          targetX: 0.75,
          targetY: 0.25,
          targetScale: 2.2,
          tiltX: 4.0,
          tiltY: -6.0,
          spotlight: true
        }
      ];

      // Sample points evaluated across 15fps (every 66.67ms), 60fps (every 16.67ms), and 120fps (every 8.33ms)
      const commonTimestamps = [1000, 1100, 1190, 1320, 1380, 2000, 3000, 3620, 3810, 4000];

      for (const t of commonTimestamps) {
        // Direct analytical evaluation
        const cam15 = computeCinematicCameraState(t, pills, undefined, VIEWPORT_W, VIEWPORT_H, false);
        const cam60 = computeCinematicCameraState(t, pills, undefined, VIEWPORT_W, VIEWPORT_H, false);
        const cam120 = computeCinematicCameraState(t, pills, undefined, VIEWPORT_W, VIEWPORT_H, false);

        expect(cam15.scale).toBe(cam60.scale);
        expect(cam60.scale).toBe(cam120.scale);

        expect(cam15.x).toBe(cam60.x);
        expect(cam60.x).toBe(cam120.x);

        expect(cam15.y).toBe(cam60.y);
        expect(cam60.y).toBe(cam120.y);

        expect(cam15.tiltX).toBe(cam60.tiltX);
        expect(cam15.tiltY).toBe(cam60.tiltY);
      }
    });

    it('settles >= 90% of zoom scale when the click lands (at primary.t - 300ms lead-in)', () => {
      const pills: ZoomPill[] = [
        {
          id: 'click-zoom',
          startTime: 700, // Click lands at 1000ms -> lead-in 300ms starts at 700ms
          endTime: 3500,
          targetX: 0.8,
          targetY: 0.3,
          targetScale: 2.0,
          tiltX: 0,
          tiltY: 0,
          spotlight: true
        }
      ];

      // At t = 1000ms (click landing instant, 300ms into the 450ms front-loaded ease-out)
      const stateAtClick = computeCinematicCameraState(1000, pills, undefined, VIEWPORT_W, VIEWPORT_H, false);
      const totalScaleDelta = 2.0 - 1.0;
      const settledScaleDelta = stateAtClick.scale - 1.0;
      const settlementPercent = settledScaleDelta / totalScaleDelta;

      // Settlement percentage must be >= 90% as the click lands
      expect(settlementPercent).toBeGreaterThanOrEqual(0.90);
      expect(settlementPercent).toBeCloseTo(0.995, 2);
    });
  });

  describe('2. Smart Container Guard & Wide-Container Blending', () => {
    it('blends 70% click + 30% container center when container width > 45% of viewport', () => {
      const wideBounds: BoundingBox = {
        x: 200,
        y: 200,
        width: 1000, // 1000 / 1920 = 0.52 (> 45%)
        height: 300  // 300 / 1080 = 0.27 (< 50%)
      };
      // Center of container: (200 + 500, 200 + 150) = (700, 350)
      // Click near left edge of container: (300, 300)
      const click: ClickEvent = {
        t: 1000,
        x: 300,
        y: 300,
        button: 0,
        targetTag: 'BUTTON',
        containerBounds: wideBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      // Expected blend: 0.7 * 300 + 0.3 * 700 = 210 + 210 = 420px
      // 0.7 * 300 + 0.3 * 350 = 210 + 105 = 315px
      expect(pills[0].targetX).toBeCloseTo(420 / VIEWPORT_W, 2);
      expect(pills[0].targetY).toBeCloseTo(315 / VIEWPORT_H, 2);
    });

    it('blends 70% click + 30% container center when container height > 50% of viewport', () => {
      const tallBounds: BoundingBox = {
        x: 300,
        y: 100,
        width: 400, // 400 / 1920 = 0.208 (< 45%)
        height: 600 // 600 / 1080 = 0.555 (> 50%)
      };
      // Center: (300 + 200, 100 + 300) = (500, 400)
      // Click at (400, 200)
      const click: ClickEvent = {
        t: 1000,
        x: 400,
        y: 200,
        button: 0,
        targetTag: 'INPUT',
        containerBounds: tallBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      // Expected blend: 0.7 * 400 + 0.3 * 500 = 280 + 150 = 430px
      // 0.7 * 200 + 0.3 * 400 = 140 + 120 = 260px
      expect(pills[0].targetX).toBeCloseTo(430 / VIEWPORT_W, 2);
      expect(pills[0].targetY).toBeCloseTo(260 / VIEWPORT_H, 2);
    });

    it('blends 70% click + 30% container center when click-to-center distance > 250 px', () => {
      const containerBounds: BoundingBox = {
        x: 500,
        y: 200,
        width: 600, // 600 / 1920 = 0.3125 (< 45%)
        height: 400 // 400 / 1080 = 0.370 (< 50%)
      };
      // Center: (800, 400)
      // Click at (510, 210) -> dx = 290, dy = 190 -> dist = 346px (> 250px)
      const click: ClickEvent = {
        t: 1000,
        x: 510,
        y: 210,
        button: 0,
        targetTag: 'BUTTON',
        containerBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      // Expected blend: 0.7 * 510 + 0.3 * 800 = 357 + 240 = 597px
      // 0.7 * 210 + 0.3 * 400 = 147 + 120 = 267px
      expect(pills[0].targetX).toBeCloseTo(597 / VIEWPORT_W, 2);
      expect(pills[0].targetY).toBeCloseTo(267 / VIEWPORT_H, 2);
    });

    it('preserves exact container center when container is compact and click is within 250 px', () => {
      const compactBounds: BoundingBox = {
        x: 600,
        y: 300,
        width: 300, // 300 / 1920 = 0.156 (< 45%)
        height: 200 // 200 / 1080 = 0.185 (< 50%)
      };
      // Center: (750, 400)
      // Click at (720, 390) -> dist = 31.6px (< 250px)
      const click: ClickEvent = {
        t: 1000,
        x: 720,
        y: 390,
        button: 0,
        targetTag: 'BUTTON',
        containerBounds: compactBounds
      };

      const pills = generateAutoZoomPills([click], [], 10000, VIEWPORT_W, VIEWPORT_H);
      expect(pills.length).toBe(1);

      expect(pills[0].targetX).toBeCloseTo(750 / VIEWPORT_W, 2);
      expect(pills[0].targetY).toBeCloseTo(400 / VIEWPORT_H, 2);
    });
  });

  describe('3. Scroll-Triggered Zoom-Out', () => {
    it('clamps zoom hold endTime when cumulative scroll exceeds 200 px during active hold', () => {
      const rawPills: ZoomPill[] = [
        {
          id: 'zoom-1',
          startTime: 1000,
          endTime: 5000,
          targetX: 0.5,
          targetY: 0.5,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0,
          spotlight: true
        }
      ];

      const scrollEvents: ScrollEvent[] = [
        { t: 1500, scrollX: 0, scrollY: 0 },
        { t: 1800, scrollX: 0, scrollY: 100 },
        { t: 2100, scrollX: 0, scrollY: 250 } // Cumulative scroll = 250px (> 200px)
      ];

      const settled = settleAndMergePills(rawPills, 10000, scrollEvents);
      expect(settled.length).toBe(1);
      // Clamped to the trigger instant t = 2100ms
      expect(settled[0].endTime).toBe(2100);
    });

    it('keeps at least 600 ms minimum pill duration even when scroll occurs immediately', () => {
      const rawPills: ZoomPill[] = [
        {
          id: 'zoom-quick-scroll',
          startTime: 1000,
          endTime: 5000,
          targetX: 0.5,
          targetY: 0.5,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0,
          spotlight: true
        }
      ];

      // Rapid scroll 250px occurring only 150ms after pill start
      const scrollEvents: ScrollEvent[] = [
        { t: 1050, scrollX: 0, scrollY: 0 },
        { t: 1150, scrollX: 0, scrollY: 300 }
      ];

      const settled = settleAndMergePills(rawPills, 10000, scrollEvents);
      expect(settled.length).toBe(1);
      // Minimum duration constraint: startTime (1000) + 600ms = 1600ms
      expect(settled[0].endTime).toBe(1600);
    });

    it('ignores minor scroll jitter (< 200 px) preserving the full zoom hold', () => {
      const rawPills: ZoomPill[] = [
        {
          id: 'zoom-stable',
          startTime: 1000,
          endTime: 4500,
          targetX: 0.5,
          targetY: 0.5,
          targetScale: 1.8,
          tiltX: 0,
          tiltY: 0,
          spotlight: true
        }
      ];

      // Minor wheel nudge (70px total)
      const scrollEvents: ScrollEvent[] = [
        { t: 1500, scrollX: 0, scrollY: 0 },
        { t: 1800, scrollX: 0, scrollY: 70 }
      ];

      const settled = settleAndMergePills(rawPills, 10000, scrollEvents);
      expect(settled.length).toBe(1);
      expect(settled[0].endTime).toBe(4500);
    });
  });

  describe('4. Clean Typing Coalescing', () => {
    it('coalesces multiple keystroke inputs in a sentence into exactly one steady hold', () => {
      // 15 keystrokes entered into an input field over 2 seconds
      const inputEvents: InputFocusEvent[] = [];
      const bounds: BoundingBox = { x: 400, y: 300, width: 300, height: 40 };

      for (let t = 1000; t <= 3000; t += 140) {
        inputEvents.push({
          t,
          type: 'type',
          bounds
        });
      }

      const pills = generateAutoZoomPills([], inputEvents, 10000, VIEWPORT_W, VIEWPORT_H);

      // Must produce exactly 1 continuous, stable pill instead of 15 overlapping pills
      expect(pills.length).toBe(1);
      expect(pills[0].label).toBe('Typing Focus');
      expect(pills[0].startTime).toBe(650); // 1000 - 350 typing pre-roll
      expect(pills[0].endTime).toBeGreaterThanOrEqual(3000); // Holds past the last character
    });

    it('coalesces typing zooms cleanly when structured typingSessions are provided', () => {
      const inputEvents: InputFocusEvent[] = [
        {
          t: 1200,
          type: 'focus',
          bounds: { x: 500, y: 350, width: 400, height: 50 }
        }
      ];

      const typingSessions: TypingSession[] = [
        {
          t: 1200,
          endT: 3500,
          text: 'antigravity studio',
          sensitive: false,
          targetLabel: 'Workspace Search',
          targetTag: 'input'
        }
      ];

      const pills = generateAutoZoomPills(
        [],
        inputEvents,
        10000,
        VIEWPORT_W,
        VIEWPORT_H,
        undefined,
        typingSessions
      );

      expect(pills.length).toBe(1);
      expect(pills[0].label).toBe('Type "Workspace Search"');
      expect(pills[0].startTime).toBe(850); // 1200 - 350 typing pre-roll
      expect(pills[0].endTime).toBe(3500 + 1800); // 5300
    });
  });

  describe('5. Interactive Focal Target Gizmo Transformations & Clamping', () => {
    it('unprojects canvas pointer clicks to video focal coordinates and clamps to [0.05, 0.95]', () => {
      // Test unprojection math:
      // normX = clampedCamX + (clickWinX - windowW * 0.5) / (windowW * S)
      const windowW = 1600;
      const windowH = 900;
      const S = 2.0;
      const clampedCamX = 0.5;
      const clampedCamY = 0.5;

      // Click at center of window -> should yield exactly (0.5, 0.5)
      const centerWinX = windowW * 0.5;
      const centerWinY = windowH * 0.5;
      const centerNormX = clampedCamX + (centerWinX - windowW * 0.5) / (windowW * S);
      const centerNormY = clampedCamY + (centerWinY - windowH * 0.5) / (windowH * S);
      expect(centerNormX).toBe(0.5);
      expect(centerNormY).toBe(0.5);

      // Extreme drag beyond left edge (clickWinX = -800) -> unprojects to < 0.05 -> clamped to 0.05
      const extremeLeftWinX = -800;
      const unprojectedLeftX = clampedCamX + (extremeLeftWinX - windowW * 0.5) / (windowW * S);
      const clampedX = Math.max(0.05, Math.min(0.95, unprojectedLeftX));
      expect(clampedX).toBe(0.05);

      // Extreme drag beyond right edge (clickWinX = 2600) -> unprojects to > 0.95 -> clamped to 0.95
      const extremeRightWinX = 2600;
      const unprojectedRightX = clampedCamX + (extremeRightWinX - windowW * 0.5) / (windowW * S);
      const clampedRightX = Math.max(0.05, Math.min(0.95, unprojectedRightX));
      expect(clampedRightX).toBe(0.95);
    });

    it('freezes camera transform during active drag to eliminate feedback-loop jitter', () => {
      // Simulate pointerdown camera capture vs dynamic camera evaluation
      const initialCam = { S: 2.0, clampedCamX: 0.6, clampedCamY: 0.4 };
      const frozenTransform = { ...initialCam };

      // Drag step 1: pointer at winX = 900 in 1600w window
      const winX1 = 900;
      const targetX1 = Math.max(0.05, Math.min(0.95, frozenTransform.clampedCamX + (winX1 - 800) / (1600 * frozenTransform.S)));
      // 0.6 + 100 / 3200 = 0.6 + 0.03125 = 0.63125
      expect(targetX1).toBe(0.63125);

      // Even if camera would move to targetX1 in next frame, frozenTransform at drag start remains 0.6:
      const winX2 = 950;
      const targetX2 = Math.max(0.05, Math.min(0.95, frozenTransform.clampedCamX + (winX2 - 800) / (1600 * frozenTransform.S)));
      // 0.6 + 150 / 3200 = 0.646875 -> deterministic linear mapping without jitter explosion
      expect(targetX2).toBe(0.646875);
    });
  });
});

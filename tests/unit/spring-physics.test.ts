import { describe, it, expect } from 'vitest';
import {
  SpringVariable,
  SpringCameraSolver,
  computeCinematicCameraState,
  DEFAULT_SPRING_CONFIG,
  CameraState
} from '../../src/engine/spring-physics';
import { ZoomPill } from '../../src/types/telemetry';

describe('Spring Physics Engine', () => {
  describe('SpringVariable', () => {
    it('initializes with current = target and zero velocity', () => {
      const spring = new SpringVariable(1.5);
      expect(spring.current).toBe(1.5);
      expect(spring.target).toBe(1.5);
      expect(spring.velocity).toBe(0);
    });

    it('accelerates towards new target during Euler integration', () => {
      const spring = new SpringVariable(0, DEFAULT_SPRING_CONFIG);
      spring.setTarget(10);
      const nextVal = spring.update(0.016); // 1 frame at ~60fps
      expect(nextVal).toBeGreaterThan(0);
      expect(spring.velocity).toBeGreaterThan(0);
      expect(spring.current).toBe(nextVal);
    });

    it('settles smoothly to the target after sufficient time without divergence', () => {
      const spring = new SpringVariable(1.0);
      spring.setTarget(2.5);

      // Simulate 120 frames (~2 seconds at 60fps)
      for (let i = 0; i < 120; i++) {
        spring.update(0.016);
      }

      expect(spring.current).toBeCloseTo(2.5, 3);
      expect(spring.velocity).toBe(0);
    });

    it('instantly snaps to value with snapTo()', () => {
      const spring = new SpringVariable(0);
      spring.setTarget(100);
      spring.update(0.016);
      expect(spring.velocity).toBeGreaterThan(0);

      spring.snapTo(42);
      expect(spring.current).toBe(42);
      expect(spring.target).toBe(42);
      expect(spring.velocity).toBe(0);
    });

    it('clamps invalid dt to safe boundaries and recovers from NaN/Infinity', () => {
      const spring = new SpringVariable(5);
      spring.setTarget(10);

      // Pass NaN and extreme dt
      spring.update(NaN);
      expect(Number.isFinite(spring.current)).toBe(true);

      spring.update(9999);
      expect(Number.isFinite(spring.current)).toBe(true);
    });
  });

  describe('SpringCameraSolver', () => {
    it('initializes to default camera state (center 0.5, scale 1.0, tilt 0)', () => {
      const solver = new SpringCameraSolver();
      const state = solver.getState();

      expect(state.x).toBe(0.5);
      expect(state.y).toBe(0.5);
      expect(state.scale).toBe(1.0);
      expect(state.tiltX).toBe(0);
      expect(state.tiltY).toBe(0);
    });

    it('updates targets and smoothly moves all dimensions', () => {
      const solver = new SpringCameraSolver();
      solver.setTarget({ x: 0.8, y: 0.2, scale: 2.0, tiltX: 5 });

      const updated = solver.update(0.016);
      expect(updated.x).toBeGreaterThan(0.5);
      expect(updated.y).toBeLessThan(0.5);
      expect(updated.scale).toBeGreaterThan(1.0);
      expect(updated.tiltX).toBeGreaterThan(0);
    });

    it('snaps cleanly to a given camera state', () => {
      const solver = new SpringCameraSolver();
      const targetState: CameraState = { x: 0.2, y: 0.3, scale: 2.2, tiltX: -8, tiltY: 6 };
      solver.snapTo(targetState);

      const state = solver.getState();
      expect(state.x).toBe(0.2);
      expect(state.y).toBe(0.3);
      expect(state.scale).toBe(2.2);
      expect(state.tiltX).toBe(-8);
      expect(state.tiltY).toBe(6);
    });
  });

  describe('computeCinematicCameraState', () => {
    const dummyPills: ZoomPill[] = [
      {
        id: 'pill-1',
        startTime: 1000,
        endTime: 3000,
        targetX: 0.7,
        targetY: 0.4,
        targetScale: 2.0,
        tiltX: 4,
        tiltY: -2
      }
    ];

    it('returns default camera when time is outside pills and no cursor is present', () => {
      const state = computeCinematicCameraState(0, dummyPills, undefined, 1920, 1080, false);
      expect(state.scale).toBe(1.0);
      expect(state.x).toBe(0.5);
      expect(state.y).toBe(0.5);
    });

    it('smoothly zooms into active pill focus coordinates', () => {
      // At 2000ms, pill is fully active (past 500ms transition)
      const state = computeCinematicCameraState(2000, dummyPills, undefined, 1920, 1080, false);
      expect(state.scale).toBeCloseTo(2.0, 1);
      expect(state.x).toBeCloseTo(0.7, 1);
      expect(state.y).toBeCloseTo(0.4, 1);
    });

    it('smoothly eases out after pill ends', () => {
      // At 4000ms, pill ended 1000ms ago (transition is 500ms, so back to 1.0)
      const state = computeCinematicCameraState(4000, dummyPills, undefined, 1920, 1080, false);
      expect(state.scale).toBe(1.0);
    });
  });
});

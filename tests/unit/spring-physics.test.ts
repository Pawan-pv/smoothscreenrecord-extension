import { describe, it, expect } from 'vitest';
import {
  SpringVariable,
  SpringCameraSolver,
  computeCinematicCameraState,
  DEFAULT_SPRING_CONFIG,
  CameraState
} from '../../src/engine/spring-physics';
import { ZoomPill } from '../../src/types/telemetry';

describe('Spring Physics: High-Frequency Vector Tracking Calculations', () => {
  describe('1. Kinematic Accumulation & Velocity Dynamics', () => {
    it('initializes in equilibrium with zero velocity', () => {
      const spring = new SpringVariable(1.0);
      expect(spring.current).toBe(1.0);
      expect(spring.target).toBe(1.0);
      expect(spring.velocity).toBe(0);
    });

    it('accumulates positive structural velocity toward target across 60 FPS increments', () => {
      const spring = new SpringVariable(0.0, DEFAULT_SPRING_CONFIG);
      spring.setTarget(100.0);

      const DT_60FPS = 0.016; // Standard 16.6ms frame delta
      let previousCurrent = spring.current;

      // Track first 6 kinematic integration frames
      for (let frame = 1; frame <= 6; frame++) {
        const nextValue = spring.update(DT_60FPS);

        // Current value should smoothly advance toward target without backwards jumping
        expect(nextValue).toBeGreaterThan(previousCurrent);

        // Velocity should remain strongly positive in the trajectory toward target
        expect(spring.velocity).toBeGreaterThan(0);

        previousCurrent = nextValue;
      }

      // Confirm velocity was actively accumulating during early frames
      expect(spring.current).toBeGreaterThan(10);
      expect(Number.isFinite(spring.current)).toBe(true);
      expect(Number.isFinite(spring.velocity)).toBe(true);
    });

    it('instantly snaps kinematic state to arbitrary coordinate without inertia bleed', () => {
      const spring = new SpringVariable(0.0);
      spring.setTarget(250.0);
      spring.update(0.016);
      expect(spring.velocity).toBeGreaterThan(0);

      // Snap to neutral
      spring.snapTo(42.5);

      expect(spring.current).toBe(42.5);
      expect(spring.target).toBe(42.5);
      expect(spring.velocity).toBe(0);

      // Subsequent update should remain locked at snap coordinate
      const postSnapValue = spring.update(0.016);
      expect(postSnapValue).toBe(42.5);
      expect(spring.velocity).toBe(0);
    });
  });

  describe('2. Damping Precision Limits & Numerical Stability', () => {
    it('settles cleanly to exact target within 3 decimal boundaries over 120 steps', () => {
      const spring = new SpringVariable(1.0, DEFAULT_SPRING_CONFIG);
      const TARGET = 2.85;
      spring.setTarget(TARGET);

      const DT_60FPS = 0.016;
      const history: number[] = [];

      // Run 120 continuous simulation steps (~2.0 seconds at 60 FPS)
      for (let step = 0; step < 120; step++) {
        const val = spring.update(DT_60FPS);
        history.push(val);

        // Ensure zero NaN or divergence at any point during trajectory
        expect(Number.isFinite(val)).toBe(true);
        expect(Number.isFinite(spring.velocity)).toBe(true);
      }

      // Assert precision convergence within 3 decimal boundaries (tolerance 0.001)
      expect(spring.current).toBeCloseTo(TARGET, 3);
      expect(spring.velocity).toBe(0);

      // Verify no harmonic oscillation overshoot after step 90
      const lateSteps = history.slice(90);
      for (const sample of lateSteps) {
        expect(Math.abs(sample - TARGET)).toBeLessThan(0.005);
      }
    });

    it('safely clamps corrupted or extreme delta-time spikes without exploding', () => {
      const spring = new SpringVariable(5.0);
      spring.setTarget(10.0);

      // Pass NaN delta-time
      spring.update(NaN);
      expect(Number.isFinite(spring.current)).toBe(true);
      expect(Number.isFinite(spring.velocity)).toBe(true);

      // Pass extreme frame drop (5.0 seconds freeze)
      spring.update(5.0);
      expect(Number.isFinite(spring.current)).toBe(true);
      expect(Number.isFinite(spring.velocity)).toBe(true);
      expect(spring.current).toBeLessThanOrEqual(10.5);
    });
  });

  describe('3. Multi-Axis Camera Solver & Cinematics', () => {
    it('synchronously coordinates 5 degrees of freedom across kinematic Euler integration', () => {
      const solver = new SpringCameraSolver({
        x: 0.5,
        y: 0.5,
        scale: 1.0,
        tiltX: 0,
        tiltY: 0
      });

      solver.setTarget({
        x: 0.85,
        y: 0.25,
        scale: 2.2,
        tiltX: 6.0,
        tiltY: -4.0
      });

      // Advance by 30 frames (0.5s)
      for (let i = 0; i < 30; i++) {
        solver.update(0.016);
      }

      const state = solver.getState();
      expect(state.x).toBeGreaterThan(0.5);
      expect(state.y).toBeLessThan(0.5);
      expect(state.scale).toBeGreaterThan(1.0);
      expect(state.tiltX).toBeGreaterThan(0);
      expect(state.tiltY).toBeLessThan(0);
    });

    it('evaluates analytical smootherstep camera trajectories within zoom pills', () => {
      const pills: ZoomPill[] = [
        {
          id: 'pill-focal',
          startTime: 1000,
          endTime: 3000,
          targetX: 0.72,
          targetY: 0.38,
          targetScale: 2.4,
          tiltX: 5.0,
          tiltY: -3.0
        }
      ];

      // Neutral prior to start
      const preState = computeCinematicCameraState(500, pills, undefined, 1920, 1080, false);
      expect(preState.scale).toBe(1.0);
      expect(preState.x).toBe(0.5);
      expect(preState.y).toBe(0.5);

      // Fully settled inside pill plateau at 2000ms
      const activeState = computeCinematicCameraState(2000, pills, undefined, 1920, 1080, false);
      expect(activeState.scale).toBeCloseTo(2.4, 2);
      expect(activeState.x).toBeCloseTo(0.72, 2);
      expect(activeState.y).toBeCloseTo(0.38, 2);
      expect(activeState.tiltX).toBeCloseTo(5.0, 1);

      // Restored to neutral after pill completion
      const postState = computeCinematicCameraState(4000, pills, undefined, 1920, 1080, false);
      expect(postState.scale).toBe(1.0);
      expect(postState.x).toBe(0.5);
    });
  });
});

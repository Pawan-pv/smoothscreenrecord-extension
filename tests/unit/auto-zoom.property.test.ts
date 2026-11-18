/**
 * Property tests for the auto-zoom pill generator.
 *
 * Invariant: every generated pill must live inside the recording
 *   0 <= startTime <= endTime <= videoDurationMs
 * because the exporter seeks the video to the pill times; a pill beyond the end
 * makes the seek wait for a frame that does not exist (QA-001).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateAutoZoomPills } from '../../src/engine/spring-physics';
import type { ClickEvent, InputFocusEvent } from '../../src/types/telemetry';

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;

const arbitraryClick = fc.record({
  t: fc.integer({ min: -3000, max: 60000 }),
  x: fc.integer({ min: -400, max: 2400 }),
  y: fc.integer({ min: -400, max: 1500 }),
  button: fc.constant(0),
  targetTag: fc.constantFrom('BUTTON', 'A', 'INPUT', 'DIV')
});

const arbitraryInput = fc.record({
  t: fc.integer({ min: -3000, max: 60000 }),
  type: fc.constantFrom('focus', 'type', 'blur'),
  bounds: fc.record({
    x: fc.integer({ min: -500, max: 2500 }),
    y: fc.integer({ min: -500, max: 1600 }),
    width: fc.integer({ min: -100, max: 3000 }),
    height: fc.integer({ min: -100, max: 1600 })
  })
});

function expectPillInsideRecording(pills: ReturnType<typeof generateAutoZoomPills>, duration: number) {
  for (const pill of pills) {
    expect(Number.isFinite(pill.startTime), `startTime is not finite: ${pill.startTime}`).toBe(true);
    expect(Number.isFinite(pill.endTime), `endTime is not finite: ${pill.endTime}`).toBe(true);
    expect(pill.startTime).toBeGreaterThanOrEqual(0);
    expect(pill.endTime).toBeGreaterThanOrEqual(pill.startTime);
    expect(pill.endTime, `pill ${pill.id} outlives the recording`).toBeLessThanOrEqual(duration);
    expect(pill.targetX).toBeGreaterThanOrEqual(0.1);
    expect(pill.targetX).toBeLessThanOrEqual(0.9);
    expect(pill.targetY).toBeGreaterThanOrEqual(0.1);
    expect(pill.targetY).toBeLessThanOrEqual(0.9);
    expect(pill.targetScale).toBeGreaterThan(0);
  }
}

describe('Auto-zoom pills: temporal bounds are a hard invariant', () => {
  it('never generates a pill outside [0, videoDurationMs] (property)', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryClick, { maxLength: 40 }),
        fc.array(arbitraryInput, { maxLength: 20 }),
        fc.integer({ min: 1, max: 30000 }),
        (clicks, inputs, duration) => {
          const pills = generateAutoZoomPills(
            clicks as unknown as ClickEvent[],
            inputs as unknown as InputFocusEvent[],
            duration,
            VIEWPORT_W,
            VIEWPORT_H
          );
          expectPillInsideRecording(pills, duration);
        }
      ),
      { numRuns: 150 }
    );
  });

  it('ignores a click that happened after the recording ended', () => {
    const lateClick: ClickEvent = { t: 9000, x: 900, y: 400, button: 0, targetTag: 'BUTTON' };
    const pills = generateAutoZoomPills([lateClick], [], 2000, VIEWPORT_W, VIEWPORT_H);
    expect(pills).toHaveLength(0);
  });

  it('ignores typing that started after the recording ended', () => {
    const lateInput: InputFocusEvent = {
      t: 9000,
      type: 'focus',
      bounds: { x: 700, y: 400, width: 400, height: 60 }
    };
    const pills = generateAutoZoomPills([], [lateInput], 2000, VIEWPORT_W, VIEWPORT_H);
    expect(pills).toHaveLength(0);
  });

  it('keeps the last click of the recording inside the timeline', () => {
    const click: ClickEvent = { t: 1990, x: 900, y: 400, button: 0, targetTag: 'BUTTON' };
    const pills = generateAutoZoomPills([click], [], 2000, VIEWPORT_W, VIEWPORT_H);
    expect(pills).toHaveLength(1);
    expect(pills[0].startTime).toBe(1690);
    expect(pills[0].endTime).toBe(2000);
  });

  it('keeps the typing lens on screen for its full hold, inside the timeline', () => {
    const input: InputFocusEvent = {
      t: 1000,
      type: 'focus',
      bounds: { x: 700, y: 400, width: 400, height: 60 }
    };
    const pills = generateAutoZoomPills([], [input], 10000, VIEWPORT_W, VIEWPORT_H);
    expect(pills).toHaveLength(1);
    expect(pills[0].startTime).toBe(600);
    expect(pills[0].endTime).toBe(3200);
  });

  it('clamps a late typing lens to the recording end instead of dropping the hold', () => {
    const input: InputFocusEvent = {
      t: 1990,
      type: 'focus',
      bounds: { x: 700, y: 400, width: 400, height: 60 }
    };
    const pills = generateAutoZoomPills([], [input], 2000, VIEWPORT_W, VIEWPORT_H);
    expect(pills).toHaveLength(1);
    expect(pills[0].startTime).toBe(1590);
    expect(pills[0].endTime).toBe(2000);
  });

  it('returns no pills for a zero/negative/NaN duration instead of inventing time', () => {
    const click: ClickEvent = { t: 1000, x: 900, y: 400, button: 0, targetTag: 'BUTTON' };
    for (const duration of [0, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(generateAutoZoomPills([click], [], duration, VIEWPORT_W, VIEWPORT_H)).toHaveLength(0);
    }
  });
});

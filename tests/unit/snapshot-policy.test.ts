/**
 * QA-030: snapshot capture ran a synchronous toDataURL JPEG on the capture
 * thread and allocated a canvas per snapshot. The policy that decides when a
 * snapshot is taken and how large it is now lives in a pure module so the
 * rules can be tested without a browser.
 */
import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_IDLE_INTERVAL_MS,
  SNAPSHOT_MAX_WIDTH,
  SNAPSHOT_MIN_INTERVAL_MS,
  computeSnapshotSize,
  shouldCaptureSnapshot
} from '../../src/engine/snapshot-policy';

describe('QA-030 snapshot policy', () => {
  it('downscales to the 1024 px ceiling and keeps the aspect ratio', () => {
    expect(computeSnapshotSize(1920, 1080)).toEqual({ width: 1024, height: 576 });
    expect(computeSnapshotSize(2560, 1440)).toEqual({ width: 1024, height: 576 });
    expect(computeSnapshotSize(1280, 720)).toEqual({ width: 1024, height: 576 });
    expect(SNAPSHOT_MAX_WIDTH).toBe(1024);
  });

  it('never upscales a picture that is already small', () => {
    expect(computeSnapshotSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(computeSnapshotSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('survives a zero or missing source size without producing NaN', () => {
    for (const [w, h] of [[0, 0], [Number.NaN, 1080], [1920, Number.NaN], [-10, 20]]) {
      const size = computeSnapshotSize(w, h);
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
    }
  });

  it('takes the first snapshot immediately', () => {
    expect(shouldCaptureSnapshot({
      recording: true,
      inFlight: false,
      transition: false,
      sinceLastMs: Infinity
    })).toBe(true);
  });

  it('never overlaps two encodes', () => {
    expect(shouldCaptureSnapshot({
      recording: true,
      inFlight: true,
      transition: true,
      sinceLastMs: 10_000
    })).toBe(false);
  });

  it('never captures when not recording', () => {
    expect(shouldCaptureSnapshot({
      recording: false,
      inFlight: false,
      transition: true,
      sinceLastMs: 10_000
    })).toBe(false);
  });

  it('throttles transitions to one per 700 ms', () => {
    const base = { recording: true, inFlight: false, transition: true };
    expect(shouldCaptureSnapshot({ ...base, sinceLastMs: SNAPSHOT_MIN_INTERVAL_MS - 1 })).toBe(false);
    expect(shouldCaptureSnapshot({ ...base, sinceLastMs: SNAPSHOT_MIN_INTERVAL_MS })).toBe(true);
  });

  it('uses the slower idle cadence when nothing changed', () => {
    const base = { recording: true, inFlight: false, transition: false };
    expect(shouldCaptureSnapshot({ ...base, sinceLastMs: SNAPSHOT_MIN_INTERVAL_MS })).toBe(false);
    expect(shouldCaptureSnapshot({ ...base, sinceLastMs: SNAPSHOT_IDLE_INTERVAL_MS - 1 })).toBe(false);
    expect(shouldCaptureSnapshot({ ...base, sinceLastMs: SNAPSHOT_IDLE_INTERVAL_MS })).toBe(true);
    expect(SNAPSHOT_IDLE_INTERVAL_MS).toBeGreaterThan(SNAPSHOT_MIN_INTERVAL_MS);
  });
});

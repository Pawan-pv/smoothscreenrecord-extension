/**
 * Documentation-snapshot policy (QA-030).
 *
 * Snapshots are taken from the capture path, so the decision to take one and
 * the size of the image must be cheap and predictable. Keeping them here (no
 * DOM) also makes the rules testable.
 */

/** Longest edge of a documentation screenshot. */
export const SNAPSHOT_MAX_WIDTH = 1024;

/**
 * Minimum time between transition snapshots. A 1280 px JPEG used to cost tens
 * of ms on the main thread; on an animating page the detector took 6.4
 * snapshots/s and kept the editor busy 39 % of the time (M1-03).
 */
export const SNAPSHOT_MIN_INTERVAL_MS = 700;

/** Periodic cadence when no visual transition is detected. */
export const SNAPSHOT_IDLE_INTERVAL_MS = 1800;

/** Downscaled size for a source picture; never upscales. */
export function computeSnapshotSize(
  srcWidth: number,
  srcHeight: number,
  maxWidth = SNAPSHOT_MAX_WIDTH
): { width: number; height: number } {
  const w = Number.isFinite(srcWidth) && srcWidth > 0 ? srcWidth : 1;
  const h = Number.isFinite(srcHeight) && srcHeight > 0 ? srcHeight : 1;
  const scale = Math.min(1, maxWidth / w);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale))
  };
}

/**
 * One snapshot at a time, at most one transition per interval, and a slower
 * cadence when nothing changed. `sinceLastMs` is Infinity before the first.
 */
export function shouldCaptureSnapshot(input: {
  recording: boolean;
  inFlight: boolean;
  transition: boolean;
  sinceLastMs: number;
}): boolean {
  if (!input.recording || input.inFlight) return false;
  const minGap = input.transition ? SNAPSHOT_MIN_INTERVAL_MS : SNAPSHOT_IDLE_INTERVAL_MS;
  return input.sinceLastMs >= minGap;
}

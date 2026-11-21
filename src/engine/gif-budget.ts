/**
 * GIF export memory budget.
 *
 * `omggif` writes into one pre-allocated buffer, so the exporter used to size
 * it from a pixel-count estimate with no upper bound: a long 1080p clip asked
 * for gigabytes and hung or killed the tab (QA-028). These helpers keep the
 * allocation bounded and fail with a clear message instead of an OOM.
 *
 * Pure module (no DOM) so the arithmetic is unit-testable.
 */

/** Nothing the GIF UI offers goes above 840 px; 1024 is the hard ceiling. */
export const GIF_MAX_DIMENSION = 1024;
export const GIF_MIN_DIMENSION = 64;

/** Hard cap on the pre-allocated GIF buffer (and therefore on the GIF bytes). */
export const GIF_MAX_BUFFER_BYTES = 192 * 1024 * 1024;

/** Smallest buffer worth allocating, so a short clip still has room. */
export const GIF_MIN_BUFFER_BYTES = 4 * 1024 * 1024;

/** Bytes reserved for the GIF trailer and the last frame. */
const GIF_TRAILER_BYTES = 1024 * 1024;

/** Clamp a requested longest-edge size into the supported range. */
export function resolveGifMaxDimension(requested: number | undefined): number {
  const n = Number.isFinite(requested) ? Math.round(requested as number) : GIF_MAX_DIMENSION;
  return Math.min(GIF_MAX_DIMENSION, Math.max(GIF_MIN_DIMENSION, n));
}

/** Buffer to allocate: the estimate, clamped to [min, cap]. */
export function planGifBufferBytes(outW: number, outH: number, frameCount: number): number {
  const pixels = Math.max(1, Math.round(outW)) * Math.max(1, Math.round(outH));
  const frames = Math.max(1, Math.round(frameCount));
  const estimate = Math.ceil(pixels * frames * 0.4) + GIF_TRAILER_BYTES;
  return Math.max(GIF_MIN_BUFFER_BYTES, Math.min(GIF_MAX_BUFFER_BYTES, estimate));
}

/**
 * Worst-case bytes one frame can occupy. LZW output is never much larger than
 * the raw pixel count; 1.5x plus the frame header is a safe ceiling.
 */
export function gifFrameHeadroomBytes(outW: number, outH: number): number {
  return Math.ceil(Math.max(1, outW) * Math.max(1, outH) * 1.5) + 4096;
}

/**
 * Throws before a frame is written when it cannot fit. The error names the cap
 * and the frame, so the editor can tell the user which preset to pick.
 */
export function assertGifBufferHasRoom(
  writtenBytes: number,
  capacityBytes: number,
  frameHeadroomBytes: number,
  frameIndex: number
): void {
  if (writtenBytes + frameHeadroomBytes <= capacityBytes) return;
  const capMb = Math.round(capacityBytes / (1024 * 1024));
  throw new Error(
    `GIF export stopped at the ${capMb} MB safety limit (frame ${frameIndex}). ` +
    `The clip is too long or too detailed for this preset: choose a smaller GIF preset or a shorter range.`
  );
}

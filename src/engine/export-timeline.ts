/**
 * Export timeline arithmetic for the MP4 exporter.
 *
 * Kept in its own module (no DOM, no WebCodecs) so the clamping rules can be
 * unit-tested without a browser.
 */

export interface ExportTimelineInput {
  /** Wall-clock duration the editor measured for the recording. */
  wallClockDurationMs: number;
  /** Container duration of the WebM (may include encoder padding). */
  containerDurationMs: number;
  /** Decoded audio track length, 0 when there is no audio. */
  audioEndMs: number;
  /** Presentation timestamp of the last real decoded video frame, 0 when unknown. */
  lastVideoPtsMs: number;
}

/**
 * Length of the exported timeline.
 *
 * QA-002: the longest real track is authoritative. Audio that genuinely
 * outlives the video must not be lost; the video holds its last frame for the
 * tail.
 *
 * QA-009: but the *video* end must be the last real decoded frame PTS, not the
 * wall clock or the WebM container duration. Both include trailing encoder
 * padding (~190 ms measured on a 20 s capture), which made the export repeat
 * the last frame for the whole padding.
 */
export function resolveExportTimelineMs(input: ExportTimelineInput): number {
  const wallClock = Number.isFinite(input.wallClockDurationMs) && input.wallClockDurationMs > 0
    ? input.wallClockDurationMs
    : 0;
  const container = Number.isFinite(input.containerDurationMs) && input.containerDurationMs > 0
    ? input.containerDurationMs
    : 0;
  const audioEnd = Number.isFinite(input.audioEndMs) && input.audioEndMs > 0 ? input.audioEndMs : 0;
  const lastVideoPts = Number.isFinite(input.lastVideoPtsMs) && input.lastVideoPtsMs > 0
    ? input.lastVideoPtsMs
    : 0;

  const claimedVideoEnd = Math.max(wallClock, container);
  const videoEnd = lastVideoPts > 0
    // Never let the padded duration win over the real last frame.
    ? Math.min(claimedVideoEnd || lastVideoPts, lastVideoPts)
    : claimedVideoEnd;

  return Math.ceil(Math.max(videoEnd, audioEnd));
}

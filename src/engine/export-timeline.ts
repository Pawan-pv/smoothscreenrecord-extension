/**
 * Export timeline arithmetic for the MP4 exporter and GIF exporter.
 *
 * Kept in its own module (no DOM, no WebCodecs) so the clamping and composition rules can be
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

export interface TimeRangeMs {
  startTime: number;
  endTime: number;
}

/**
 * Resolves safe, clamped trim start and trim end bounds.
 * Enforces:
 * - 0 <= trimStartMs <= trimEndMs <= durationMs
 * - (trimEndMs - trimStartMs) >= minDurationMs (unless durationMs < minDurationMs)
 */
export function clampTrimBounds(
  durationMs: number,
  trimStartMs?: number,
  trimEndMs?: number,
  minDurationMs = 500
): { trimStartMs: number; trimEndMs: number } {
  const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (safeDur <= 0) {
    return { trimStartMs: 0, trimEndMs: 0 };
  }

  const effectiveMin = Math.min(minDurationMs, safeDur);

  let start = Number.isFinite(trimStartMs) ? Math.max(0, Math.min(safeDur, trimStartMs!)) : 0;
  let end = Number.isFinite(trimEndMs) ? Math.max(0, Math.min(safeDur, trimEndMs!)) : safeDur;

  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  if (end - start < effectiveMin) {
    if (start + effectiveMin <= safeDur) {
      end = start + effectiveMin;
    } else {
      start = Math.max(0, end - effectiveMin);
    }
  }

  return { trimStartMs: start, trimEndMs: end };
}

/**
 * Composes silence cuts with trim bounds [trimStartMs, trimEndMs],
 * returning the kept spans inside the trim window.
 *
 * Spans outside [trimStartMs, trimEndMs] are discarded.
 * Silence cuts partially overlapping trim edges are clipped to [trimStartMs, trimEndMs].
 */
export function composeTrimAndCuts(
  cuts: TimeRangeMs[],
  durationMs: number,
  trimStartMs: number = 0,
  trimEndMs?: number
): TimeRangeMs[] {
  const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (safeDur <= 0) return [];

  const { trimStartMs: effStart, trimEndMs: effEnd } = clampTrimBounds(
    safeDur,
    trimStartMs,
    trimEndMs ?? safeDur,
    0
  );

  if (effEnd <= effStart) return [];

  // Filter, clamp and sort cuts within [effStart, effEnd]
  const normalized: Array<{ start: number; end: number }> = [];
  for (const c of cuts) {
    if (!Number.isFinite(c?.startTime) || !Number.isFinite(c?.endTime)) continue;
    const start = Math.max(effStart, Math.min(effEnd, c.startTime));
    const end = Math.max(effStart, Math.min(effEnd, c.endTime));
    if (end > start) normalized.push({ start, end });
  }
  normalized.sort((a, b) => a.start - b.start);

  // Merge overlapping or adjacent cut intervals
  const mergedCuts: Array<{ start: number; end: number }> = [];
  for (const c of normalized) {
    const last = mergedCuts[mergedCuts.length - 1];
    if (last && c.start <= last.end) {
      last.end = Math.max(last.end, c.end);
    } else {
      mergedCuts.push({ ...c });
    }
  }

  // Complement of cuts within [effStart, effEnd] gives the kept spans
  const keep: TimeRangeMs[] = [];
  let cursor = effStart;
  for (const c of mergedCuts) {
    if (c.start > cursor) {
      keep.push({ startTime: cursor, endTime: c.start });
    }
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < effEnd) {
    keep.push({ startTime: cursor, endTime: effEnd });
  }

  return keep;
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

/**
 * What the user kept of the recording, as seen by the exports that are not a
 * video (SOP guide, HTML widget). The MP4/GIF exporters cut the picture itself;
 * these two list steps, so a step that was trimmed or cut away must not appear
 * and the steps that remain must be timed against the exported timeline.
 */
export interface ExportTimelineWindow {
  /** Duration of the recording the telemetry belongs to. */
  durationMs: number;
  trimStartMs?: number;
  trimEndMs?: number;
  /** Silence cuts that are switched on. */
  cutRanges?: TimeRangeMs[];
}

export interface ExportTimelineFilter {
  /** False when nothing was trimmed or cut: every event is kept and times are untouched. */
  active: boolean;
  /** True when a telemetry timestamp is inside the exported video. */
  keeps(tMs: number): boolean;
  /** Timestamp on the exported timeline (identical to the input when inactive). */
  toExportTime(tMs: number): number;
  /** Length of the exported timeline, or null when inactive. */
  exportedDurationMs: number | null;
}

export function createExportTimelineFilter(window?: ExportTimelineWindow | null): ExportTimelineFilter {
  const passthrough: ExportTimelineFilter = {
    active: false,
    keeps: () => true,
    toExportTime: (t) => t,
    exportedDurationMs: null
  };
  if (!window) return passthrough;
  const duration = Number.isFinite(window.durationMs) && window.durationMs > 0 ? window.durationMs : 0;
  const trimmed = (Number.isFinite(window.trimStartMs) && (window.trimStartMs as number) > 0) ||
    (Number.isFinite(window.trimEndMs) && duration > 0 && (window.trimEndMs as number) < duration);
  const hasCuts = (window.cutRanges || []).some(
    (c) => Number.isFinite(c?.startTime) && Number.isFinite(c?.endTime) && c.endTime > c.startTime
  );
  if (duration <= 0 || (!trimmed && !hasCuts)) return passthrough;

  const keep = composeTrimAndCuts(window.cutRanges || [], duration, window.trimStartMs ?? 0, window.trimEndMs);
  const total = keep.reduce((sum, span) => sum + (span.endTime - span.startTime), 0);
  const locate = (t: number): { span: TimeRangeMs; before: number } | null => {
    let before = 0;
    for (const span of keep) {
      if (t >= span.startTime && t <= span.endTime) return { span, before };
      before += span.endTime - span.startTime;
    }
    return null;
  };
  return {
    active: true,
    keeps: (t) => Number.isFinite(t) && locate(t) !== null,
    toExportTime: (t) => {
      const hit = locate(t);
      return hit ? Math.round(hit.before + (t - hit.span.startTime)) : 0;
    },
    exportedDurationMs: total
  };
}

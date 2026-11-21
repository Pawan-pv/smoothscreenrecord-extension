/**
 * QA-009: the exported MP4 used the wall-clock / WebM container duration as its
 * timeline. Both carry trailing encoder padding, so the export repeated the
 * last video frame for the padding (~190 ms on the J11 capture: 20.175 s of
 * real frames exported as 20.267 s).
 *
 * Measured on `tests/e2e/out/j11-new-2026-11-20-2.log`:
 *   raw vp8      20.175 s, 696 frames
 *   container    20.266667 s (1216 exported frames at 60 fps)
 *   last frame   20.175 s
 */
import { describe, it, expect } from 'vitest';
import { resolveExportTimelineMs, clampTrimBounds, composeTrimAndCuts } from '../../src/engine/export-timeline';

describe('QA-009 export timeline', () => {
  it('ends on the last real decoded frame, not the padded wall clock (J11 numbers)', () => {
    const ms = resolveExportTimelineMs({
      wallClockDurationMs: 20266.667,
      containerDurationMs: 20266.667,
      audioEndMs: 20175,
      lastVideoPtsMs: 20175
    });
    expect(ms).toBe(20175);
    // The old timeline was 190 ms longer and froze on the last frame.
    expect(ms).toBeLessThan(20266.667);
  });

  it('keeps the longest track when there is no sequential frame source', () => {
    expect(resolveExportTimelineMs({
      wallClockDurationMs: 12000,
      containerDurationMs: 11980,
      audioEndMs: 12100,
      lastVideoPtsMs: 0
    })).toBe(12100);
  });

  it('keeps audio that genuinely outlives the video (QA-002)', () => {
    expect(resolveExportTimelineMs({
      wallClockDurationMs: 5000,
      containerDurationMs: 5000,
      audioEndMs: 5600,
      lastVideoPtsMs: 5000
    })).toBe(5600);
  });

  it('never extends the video past its last decoded frame', () => {
    expect(resolveExportTimelineMs({
      wallClockDurationMs: 10000,
      containerDurationMs: 10000,
      audioEndMs: 9960,
      lastVideoPtsMs: 9975
    })).toBe(9975);
  });

  it('rounds up to a whole millisecond', () => {
    expect(resolveExportTimelineMs({
      wallClockDurationMs: 4000,
      containerDurationMs: 4000,
      audioEndMs: 0,
      lastVideoPtsMs: 3980.4
    })).toBe(3981);
  });

  it('treats missing or invalid durations as zero', () => {
    expect(resolveExportTimelineMs({
      wallClockDurationMs: NaN,
      containerDurationMs: -5,
      audioEndMs: 0,
      lastVideoPtsMs: 0
    })).toBe(0);
  });
});

describe('clampTrimBounds', () => {
  it('returns exact values when within valid range and meeting min duration', () => {
    expect(clampTrimBounds(10000, 2000, 8000)).toEqual({ trimStartMs: 2000, trimEndMs: 8000 });
  });

  it('swaps inverted bounds if start > end', () => {
    expect(clampTrimBounds(10000, 8000, 2000)).toEqual({ trimStartMs: 2000, trimEndMs: 8000 });
  });

  it('enforces minimum clip length guard', () => {
    expect(clampTrimBounds(10000, 2000, 2200, 500)).toEqual({ trimStartMs: 2000, trimEndMs: 2500 });
  });

  it('adjusts start backwards if end is near the clip boundary to satisfy min duration', () => {
    expect(clampTrimBounds(10000, 9800, 10000, 500)).toEqual({ trimStartMs: 9500, trimEndMs: 10000 });
  });

  it('handles recordings shorter than min duration without breaking', () => {
    expect(clampTrimBounds(300, 0, 300, 500)).toEqual({ trimStartMs: 0, trimEndMs: 300 });
  });

  it('clamps out-of-bounds inputs to [0, durationMs]', () => {
    expect(clampTrimBounds(10000, -500, 15000)).toEqual({ trimStartMs: 0, trimEndMs: 10000 });
  });

  it('returns zeros for non-positive duration', () => {
    expect(clampTrimBounds(0, 100, 200)).toEqual({ trimStartMs: 0, trimEndMs: 0 });
    expect(clampTrimBounds(-100, 100, 200)).toEqual({ trimStartMs: 0, trimEndMs: 0 });
  });
});

describe('composeTrimAndCuts', () => {
  it('passes through cuts untouched when trim spans the entire recording (zero trim)', () => {
    const cuts = [{ startTime: 2000, endTime: 4000 }];
    const kept = composeTrimAndCuts(cuts, 10000, 0, 10000);
    expect(kept).toEqual([
      { startTime: 0, endTime: 2000 },
      { startTime: 4000, endTime: 10000 }
    ]);
  });

  it('returns full trimmed window when there are no cuts', () => {
    const kept = composeTrimAndCuts([], 10000, 2000, 8000);
    expect(kept).toEqual([
      { startTime: 2000, endTime: 8000 }
    ]);
  });

  it('excises silence cuts located entirely within the trim window', () => {
    const cuts = [{ startTime: 3000, endTime: 5000 }];
    const kept = composeTrimAndCuts(cuts, 10000, 1000, 8000);
    expect(kept).toEqual([
      { startTime: 1000, endTime: 3000 },
      { startTime: 5000, endTime: 8000 }
    ]);
  });

  it('clips cuts that partially overlap the left trim boundary', () => {
    // Cut from 1000 to 3000, trimStart is 2000 -> excised portion is 2000..3000
    const cuts = [{ startTime: 1000, endTime: 3000 }];
    const kept = composeTrimAndCuts(cuts, 10000, 2000, 8000);
    expect(kept).toEqual([
      { startTime: 3000, endTime: 8000 }
    ]);
  });

  it('clips cuts that partially overlap the right trim boundary', () => {
    // Cut from 7000 to 9000, trimEnd is 8000 -> excised portion is 7000..8000
    const cuts = [{ startTime: 7000, endTime: 9000 }];
    const kept = composeTrimAndCuts(cuts, 10000, 2000, 8000);
    expect(kept).toEqual([
      { startTime: 2000, endTime: 7000 }
    ]);
  });

  it('ignores cuts completely outside the trim window', () => {
    const cuts = [
      { startTime: 500, endTime: 1500 },
      { startTime: 8500, endTime: 9500 }
    ];
    const kept = composeTrimAndCuts(cuts, 10000, 2000, 8000);
    expect(kept).toEqual([
      { startTime: 2000, endTime: 8000 }
    ]);
  });

  it('merges overlapping cuts within the trim window', () => {
    const cuts = [
      { startTime: 3000, endTime: 4500 },
      { startTime: 4000, endTime: 5500 }
    ];
    const kept = composeTrimAndCuts(cuts, 10000, 2000, 8000);
    expect(kept).toEqual([
      { startTime: 2000, endTime: 3000 },
      { startTime: 5500, endTime: 8000 }
    ]);
  });

  it('returns empty array when cuts cover the entire trim window', () => {
    const cuts = [{ startTime: 1000, endTime: 9000 }];
    const kept = composeTrimAndCuts(cuts, 10000, 2000, 8000);
    expect(kept).toEqual([]);
  });
});

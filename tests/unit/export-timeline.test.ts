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
import { resolveExportTimelineMs } from '../../src/engine/export-timeline';

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

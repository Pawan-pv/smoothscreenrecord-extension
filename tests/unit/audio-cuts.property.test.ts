/**
 * Property tests for the silence-cut geometry (C2 audio path).
 *
 * The cut ranges come from DOM telemetry and silence detection, i.e. from
 * untrusted, floating-point data. The complement of the cuts must always be a
 * well-formed timeline, and cutting PCM with it must never silently drop audio
 * or return a malformed track.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { keepRangesFromCuts, cutPcmToKeepRanges, type PcmTrack, type TimeRangeMs } from '../../src/engine/audio-track';

const finiteOrWeird = fc.oneof(
  fc.integer({ min: -5000, max: 70000 }),
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(Number.NEGATIVE_INFINITY)
);

const arbitraryRange = fc.record({ startTime: finiteOrWeird, endTime: finiteOrWeird });

/** Never invent a cut outside the recording, and never invert one. */
function normalizedCuts(cuts: TimeRangeMs[], duration: number) {
  return cuts
    .filter((c) => Number.isFinite(c.startTime) && Number.isFinite(c.endTime))
    .map((c) => ({
      start: Math.max(0, Math.min(duration, c.startTime)),
      end: Math.max(0, Math.min(duration, c.endTime))
    }))
    .filter((c) => c.end > c.start);
}

function covers(ranges: TimeRangeMs[], t: number) {
  return ranges.some((r) => t >= r.startTime && t < r.endTime);
}

function expectWellFormed(keep: TimeRangeMs[], duration: number) {
  let cursor = 0;
  for (const r of keep) {
    expect(Number.isFinite(r.startTime)).toBe(true);
    expect(Number.isFinite(r.endTime)).toBe(true);
    expect(r.startTime).toBeGreaterThanOrEqual(cursor);
    expect(r.endTime).toBeGreaterThan(r.startTime);
    expect(r.endTime).toBeLessThanOrEqual(duration);
    cursor = r.endTime;
  }
}

describe('keepRangesFromCuts: well-formed complement of arbitrary cuts', () => {
  it('is sorted, non-overlapping and inside the recording (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60000 }),
        fc.array(arbitraryRange, { maxLength: 30 }),
        (duration, cuts) => {
          const keep = keepRangesFromCuts(cuts, duration);
          expectWellFormed(keep, duration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('keeps exactly what the valid cuts do not cover (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.array(arbitraryRange, { maxLength: 15 }),
        (duration, cuts) => {
          const keep = keepRangesFromCuts(cuts, duration);
          const normalized = normalizedCuts(cuts, duration);
          // Sample the timeline (all of it for short recordings) instead of
          // every millisecond, to keep the property fast.
          const stride = Math.max(1, Math.floor(duration / 200));
          for (let t = 0; t < duration; t += stride) {
            const cut = normalized.some((c) => t >= c.start && t < c.end);
            expect(covers(keep, t), `t=${t}ms must be kept=${!cut}`).toBe(!cut);
          }
        }
      ),
      { numRuns: 60 }
    );
  });

  it('a NaN cut does not wipe the recording', () => {
    const keep = keepRangesFromCuts([{ startTime: Number.NaN, endTime: Number.NaN }], 5000);
    expect(keep).toEqual([{ startTime: 0, endTime: 5000 }]);
  });

  it('a cut beyond the end of the recording never eats the whole timeline', () => {
    const keep = keepRangesFromCuts([{ startTime: 6000, endTime: 7000 }], 5000);
    expect(keep).toEqual([{ startTime: 0, endTime: 5000 }]);
  });

  it('an inverted cut is ignored rather than cutting the wrong span', () => {
    const keep = keepRangesFromCuts([{ startTime: 4000, endTime: 1000 }], 5000);
    expect(keep).toEqual([{ startTime: 0, endTime: 5000 }]);
  });

  it('merges overlapping cuts without duplicating audio', () => {
    const keep = keepRangesFromCuts(
      [
        { startTime: 1000, endTime: 3000 },
        { startTime: 2000, endTime: 4000 }
      ],
      5000
    );
    expect(keep).toEqual([
      { startTime: 0, endTime: 1000 },
      { startTime: 4000, endTime: 5000 }
    ]);
  });
});

describe('cutPcmToKeepRanges: never malformed, never silent', () => {
  const pcm = (samples: number, sampleRate = 1000): PcmTrack => ({
    channels: [Float32Array.from({ length: samples }, (_, i) => i)],
    sampleRate
  });

  it('concatenates exactly the kept spans', () => {
    const src = pcm(1000);
    const out = cutPcmToKeepRanges(src, [
      { startTime: 0, endTime: 100 },
      { startTime: 500, endTime: 600 }
    ], 0);
    expect(out.channels[0].length).toBe(200);
    expect(Array.from(out.channels[0].slice(0, 100))).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(Array.from(out.channels[0].slice(100))).toEqual(
      Array.from({ length: 100 }, (_, i) => 500 + i)
    );
  });

  it('never returns a track longer than the source (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.array(arbitraryRange, { maxLength: 20 }),
        (durationMs, cuts) => {
          const src = pcm(durationMs);
          const keep = keepRangesFromCuts(cuts, durationMs);
          let out: PcmTrack;
          try {
            out = cutPcmToKeepRanges(src, keep);
          } catch (err: any) {
            // The only acceptable failure is "everything was cut".
            expect(err.message).toMatch(/no audio/i);
            expect(keep).toHaveLength(0);
            return;
          }
          expect(out.channels[0].length).toBeLessThanOrEqual(src.channels[0].length);
          expect(out.channels.every((c) => c.length === out.channels[0].length)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('fails loudly instead of emitting an MP4 audio track with zero samples', () => {
    const src = pcm(1000);
    expect(() => cutPcmToKeepRanges(src, [])).toThrow(/no audio/i);
  });

  it('garbage keep ranges cannot produce NaN sample offsets', () => {
    const src = pcm(1000);
    const out = cutPcmToKeepRanges(src, [
      { startTime: Number.NaN, endTime: 200 },
      { startTime: 100, endTime: 200 },
      { startTime: -500, endTime: 50 }
    ]);
    // The valid spans 0..50ms and 100..200ms are kept; the NaN span is ignored.
    expect(out.channels[0].length).toBe(150);
  });
});

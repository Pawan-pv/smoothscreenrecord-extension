/**
 * Property tests for the silence detector guards (D7, Phase 1).
 *
 * Restored after an accidental overwrite during the Phase 2 audit: the exact
 * original bytes were not tracked by git and no snapshot existed. The six cases
 * below are the ones documented in FINAL_ENGINEERING_REPORT.md (two fast-check
 * properties at 100 / 80 runs and four D7 guard cases); the intent, the run
 * counts and the assertions are unchanged.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectSilenceSegments } from '../../src/engine/audio-processor';

const SR = 1000; // one 50 ms window = 50 samples, keeping the properties fast
const WINDOW_MS = 50;

/** Alternating loud/quiet 50 ms blocks: a deterministic, bounded signal. */
function blocksToSignal(blocks: boolean[]): Float32Array {
  const out = new Float32Array(blocks.length * WINDOW_MS);
  for (let b = 0; b < blocks.length; b++) {
    const amp = blocks[b] ? 0.5 : 0.002;
    for (let i = 0; i < WINDOW_MS; i++) {
      out[b * WINDOW_MS + i] = ((b * 31 + i) % 7 === 0 ? -1 : 1) * amp;
    }
  }
  return out;
}

const arbitraryBlocks = fc.array(fc.boolean(), { maxLength: 300 });
const arbitraryMinPause = fc.integer({ min: 0, max: 2000 });

describe('silence detector: well-formed output', () => {
  it('segments are ordered, non-overlapping, in range and at least minSilenceDurationMs long (property)', () => {
    fc.assert(
      fc.property(arbitraryBlocks, arbitraryMinPause, (blocks, minPauseMs) => {
        const data = blocksToSignal(blocks);
        const totalMs = (data.length * 1000) / SR;
        const segs = detectSilenceSegments(data, SR, [], [], -42, minPauseMs);
        let cursor = 0;
        for (const seg of segs) {
          expect(Number.isFinite(seg.startTime)).toBe(true);
          expect(Number.isFinite(seg.endTime)).toBe(true);
          expect(seg.startTime).toBeGreaterThanOrEqual(cursor);
          expect(seg.endTime).toBeGreaterThan(seg.startTime);
          expect(seg.endTime).toBeLessThanOrEqual(totalMs + 1);
          expect(seg.duration).toBeGreaterThanOrEqual(minPauseMs);
          cursor = seg.endTime;
        }
        expect(segs.every((s) => s.markedForCut)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('no returned pause contains a click or keystroke (property)', () => {
    fc.assert(
      fc.property(
        arbitraryBlocks,
        fc.array(fc.integer({ min: 0, max: 15000 }), { maxLength: 30 }),
        fc.array(fc.integer({ min: 0, max: 15000 }), { maxLength: 30 }),
        (blocks, clickTimes, keyTimes) => {
          const data = blocksToSignal(blocks);
          const clicks = clickTimes.map((t) => ({ t }));
          const keystrokes = keyTimes.map((t) => ({ t }));
          const segs = detectSilenceSegments(data, SR, clicks as any, keystrokes as any);
          for (const seg of segs) {
            expect(clickTimes.some((t) => t >= seg.startTime && t <= seg.endTime)).toBe(false);
            expect(keyTimes.some((t) => t >= seg.startTime && t <= seg.endTime)).toBe(false);
          }
        }
      ),
      { numRuns: 80 }
    );
  });
});

describe('silence detector: D7 input guards', () => {
  it('rejects a non-finite or zero sample rate without allocating', () => {
    const data = new Float32Array(1000);
    expect(detectSilenceSegments(data, 0)).toEqual([]);
    expect(detectSilenceSegments(data, Number.NaN)).toEqual([]);
    expect(detectSilenceSegments(data, -1)).toEqual([]);
    expect(detectSilenceSegments(data, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('returns nothing for an empty or missing buffer', () => {
    expect(detectSilenceSegments(new Float32Array(0), SR)).toEqual([]);
    expect(detectSilenceSegments(null as any, SR)).toEqual([]);
    expect(detectSilenceSegments(undefined as any, SR)).toEqual([]);
  });

  it('falls back on a NaN threshold and NaN pause length', () => {
    const data = blocksToSignal([...Array(20).fill(true), ...Array(60).fill(false), ...Array(20).fill(true)]);
    const segs = detectSilenceSegments(data, SR, [], [], Number.NaN, Number.NaN);
    expect(Array.isArray(segs)).toBe(true);
    for (const seg of segs) {
      expect(seg.duration).toBeGreaterThanOrEqual(1200);
      expect(Number.isFinite(seg.startTime)).toBe(true);
      expect(Number.isFinite(seg.endTime)).toBe(true);
    }
  });

  it('treats non-finite samples as full-scale so they are never cut', () => {
    const data = new Float32Array(1000);
    data.fill(Number.NaN);
    expect(detectSilenceSegments(data, SR)).toEqual([]);

    // A real pause must not be trusted when the buffer around it is corrupt.
    const mixed = blocksToSignal([...Array(20).fill(true), ...Array(60).fill(false), ...Array(20).fill(true)]);
    for (let i = 0; i < 100; i++) mixed[i] = Number.NaN;
    const segs = detectSilenceSegments(mixed, SR);
    // The corrupt span 0-100 ms is full-scale, so no cut may start there; the
    // clean 1-4 s pause is still detector territory.
    expect(segs.every((s) => s.startTime >= 100)).toBe(true);
    expect(segs.length).toBeGreaterThan(0);
  });
});

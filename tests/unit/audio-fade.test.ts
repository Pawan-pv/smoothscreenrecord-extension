import { describe, it, expect } from 'vitest';
import { cutPcmToKeepRanges, type PcmTrack } from '../../src/engine/audio-track';

describe('Silence-Cut Audio Micro-Fade', () => {
  const constantTrack = (length: number, value = 1.0, sampleRate = 1000): PcmTrack => ({
    channels: [new Float32Array(length).fill(value)],
    sampleRate
  });

  const stereoTrack = (length: number, val1 = 1.0, val2 = 0.5, sampleRate = 1000): PcmTrack => ({
    channels: [new Float32Array(length).fill(val1), new Float32Array(length).fill(val2)],
    sampleRate
  });

  it('guarantees zero hard discontinuity at cut seams (15 ms cosine fade)', () => {
    // 1000 Hz sample rate => 15 ms = 15 samples
    // 1000 samples total (1 second)
    // Keep [0..100] ms and [500..1000] ms. Cut is at [100..500] ms.
    // Span 2 goes all the way to 1000 ms (the very end of the recording).
    const src = constantTrack(1000, 1.0, 1000);
    const cut = cutPcmToKeepRanges(src, [
      { startTime: 0, endTime: 100 },
      { startTime: 500, endTime: 1000 }
    ], 15);

    expect(cut.channels[0].length).toBe(600);

    // Span 1 is [0..100]. Very beginning (sample 0) is NOT faded
    expect(cut.channels[0][0]).toBe(1.0);
    // Unfaded middle of span 1
    expect(cut.channels[0][50]).toBe(1.0);

    // Fade-out occupies last 15 samples of span 1 (indices 85..99)
    // Index 99 is right at the seam before the cut: should be 0.0
    expect(cut.channels[0][99]).toBeCloseTo(0.0, 5);
    // Values strictly decrease toward the seam
    for (let i = 85; i < 99; i++) {
      expect(cut.channels[0][i]).toBeGreaterThan(cut.channels[0][i + 1]);
    }

    // Span 2 is [500..1000], placed at offset 100 in output buffer.
    // Index 100 is right after the cut: should start at 0.0
    expect(cut.channels[0][100]).toBeCloseTo(0.0, 5);
    // Fade-in occupies first 15 samples of span 2 (indices 100..114)
    // Values strictly increase away from the seam
    for (let i = 100; i < 114; i++) {
      expect(cut.channels[0][i]).toBeLessThan(cut.channels[0][i + 1]);
    }

    // Sample 115 and onward is unfaded
    expect(cut.channels[0][115]).toBe(1.0);
    // Very end of recording (sample 599) is NOT faded
    expect(cut.channels[0][599]).toBe(1.0);
  });

  it('safely handles short spans (< 30 ms) with proportional fade cap', () => {
    // Span length: 20 ms = 20 samples at 1000 Hz.
    // targetFadeSamples = 15.
    // fadeSamples should be capped at Math.floor(spanLen / 2) = 10 samples.
    const src = constantTrack(1000, 1.0, 1000);
    const cut = cutPcmToKeepRanges(src, [
      { startTime: 100, endTime: 120 } // 20 ms span, trimmed both start & end
    ], 15);

    expect(cut.channels[0].length).toBe(20);

    // Start seam (trimmed start => fade-in)
    expect(cut.channels[0][0]).toBeCloseTo(0.0, 5);
    // End seam (trimmed end => fade-out)
    expect(cut.channels[0][19]).toBeCloseTo(0.0, 5);

    // Midpoint transitions cleanly
    expect(cut.channels[0][9]).toBeGreaterThan(cut.channels[0][0]);
    expect(cut.channels[0][10]).toBeGreaterThan(cut.channels[0][19]);
  });

  it('safely handles ultra-short spans (1 sample) without throwing or NaN', () => {
    const src = constantTrack(1000, 0.75, 1000);
    const cut = cutPcmToKeepRanges(src, [
      { startTime: 100, endTime: 101 } // 1 ms span
    ], 15);

    expect(cut.channels[0].length).toBe(1);
    expect(Number.isFinite(cut.channels[0][0])).toBe(true);
  });

  it('does not fade uncut full recording', () => {
    const src = constantTrack(500, 0.8, 1000);
    const cut = cutPcmToKeepRanges(src, [{ startTime: 0, endTime: 500 }], 15);

    expect(cut.channels[0].length).toBe(500);
    expect(cut.channels[0][0]).toBeCloseTo(0.8, 5);
    expect(cut.channels[0][250]).toBeCloseTo(0.8, 5);
    expect(cut.channels[0][499]).toBeCloseTo(0.8, 5);
  });

  it('applies micro-fade identically across multiple audio channels', () => {
    const src = stereoTrack(1000, 1.0, 0.5, 1000);
    const cut = cutPcmToKeepRanges(src, [
      { startTime: 0, endTime: 100 },
      { startTime: 400, endTime: 500 }
    ], 15);

    expect(cut.channels).toHaveLength(2);
    // Channel 0 seam
    expect(cut.channels[0][99]).toBeCloseTo(0.0, 5);
    expect(cut.channels[0][100]).toBeCloseTo(0.0, 5);

    // Channel 1 seam
    expect(cut.channels[1][99]).toBeCloseTo(0.0, 5);
    expect(cut.channels[1][100]).toBeCloseTo(0.0, 5);

    // Proportional scaling check
    for (let k = 85; k < 100; k++) {
      expect(cut.channels[1][k]).toBeCloseTo(cut.channels[0][k] * 0.5, 5);
    }
  });

  it('supports raw unfaded cut concatenation when fadeMs=0', () => {
    const src = constantTrack(1000, 1.0, 1000);
    const cut = cutPcmToKeepRanges(src, [
      { startTime: 0, endTime: 100 },
      { startTime: 500, endTime: 600 }
    ], 0);

    expect(cut.channels[0].length).toBe(200);
    expect(cut.channels[0][99]).toBe(1.0);
    expect(cut.channels[0][100]).toBe(1.0);
  });
});

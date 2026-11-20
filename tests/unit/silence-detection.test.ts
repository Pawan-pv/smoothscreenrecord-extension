/**
 * QA-021: silence detection on a REAL microphone.
 *
 * Measured on the real-mic C1 recording (2026-11-11, laptop "Microphone Array
 * (Realtek)", WebRTC AGC + noise suppression ON as the product requests):
 * speech ~ -15 dBFS, the two 2 s pauses of the fixture WAV only -33 .. -41 dBFS
 * (room noise lifted by AGC). A fixed -42 dBFS threshold found NONE of them.
 * The signals below reproduce those levels.
 */
import { describe, it, expect } from 'vitest';
import { detectSilenceSegments } from '../../src/engine/audio-processor';

const SR = 48000;

/** Deterministic pseudo-random noise in [-1, 1]. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/** Speech-like signal: noise bursts with short syllable dips, and quiet pauses. */
function buildSignal(opts: {
  seconds: number;
  speechAmp: number;
  pauseAmp: number;
  pauses: [number, number][];
  dipEveryMs?: number;
}): Float32Array {
  const r = rng(7);
  const out = new Float32Array(Math.round(opts.seconds * SR));
  const dipEvery = opts.dipEveryMs ?? 500;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const inPause = opts.pauses.some(([a, b]) => t >= a && t < b);
    // syllable dips: 100 ms of every `dipEvery` ms drop to the pause level
    const inDip = ((t * 1000) % dipEvery) < 100;
    const amp = inPause || inDip ? opts.pauseAmp : opts.speechAmp;
    out[i] = r() * amp * Math.sqrt(3); // uniform noise: RMS = amp
  }
  return out;
}

const dbToAmp = (db: number) => Math.pow(10, db / 20);

describe('QA-021 silence detection with a real microphone', () => {
  it('finds both 2 s pauses when the room noise sits at -38 dBFS under -15 dBFS speech', () => {
    const data = buildSignal({
      seconds: 20, speechAmp: dbToAmp(-15), pauseAmp: dbToAmp(-38), pauses: [[5, 7], [15, 17]]
    });
    const segs = detectSilenceSegments(data, SR, [], []);
    expect(segs.map((s) => [s.startTime, s.endTime])).toHaveLength(2);
    expect(Math.abs(segs[0].startTime - 5000)).toBeLessThan(250);
    expect(Math.abs(segs[0].endTime - 7000)).toBeLessThan(250);
    expect(Math.abs(segs[1].startTime - 15000)).toBeLessThan(250);
    expect(Math.abs(segs[1].endTime - 17000)).toBeLessThan(250);
  });

  it('still finds digital silence (the old behaviour)', () => {
    const data = buildSignal({
      seconds: 20, speechAmp: dbToAmp(-15), pauseAmp: 0, pauses: [[4, 6], [14, 16]]
    });
    const segs = detectSilenceSegments(data, SR, [], []);
    expect(segs).toHaveLength(2);
    expect(Math.abs(segs[0].startTime - 4000)).toBeLessThan(250);
    expect(Math.abs(segs[1].startTime - 14000)).toBeLessThan(250);
  });

  it('does not invent pauses in continuous speech (syllable dips are not pauses)', () => {
    const data = buildSignal({ seconds: 20, speechAmp: dbToAmp(-15), pauseAmp: dbToAmp(-38), pauses: [] });
    expect(detectSilenceSegments(data, SR, [], [])).toHaveLength(0);
  });

  it('does not call a room with nobody speaking "speech": no contrast, no adaptive threshold', () => {
    // only room noise at -38 dBFS: above the -42 dBFS floor, nothing to cut
    const data = buildSignal({ seconds: 10, speechAmp: dbToAmp(-38), pauseAmp: dbToAmp(-38), pauses: [] });
    expect(detectSilenceSegments(data, SR, [], [])).toHaveLength(0);
  });

  it('never marks a pause in which the user clicked or typed', () => {
    const data = buildSignal({
      seconds: 20, speechAmp: dbToAmp(-15), pauseAmp: dbToAmp(-38), pauses: [[5, 7], [15, 17]]
    });
    const clicks = [{ t: 6000, x: 1, y: 1, button: 0, targetTag: 'button' }] as any;
    const segs = detectSilenceSegments(data, SR, clicks, []);
    expect(segs).toHaveLength(1);
    expect(Math.abs(segs[0].startTime - 15000)).toBeLessThan(250);
  });

  it('finds pauses under AGC-lifted room noise at -25 dBFS under -12 dBFS speech (QA-034 range)', () => {
    const data = buildSignal({
      seconds: 20, speechAmp: dbToAmp(-12), pauseAmp: dbToAmp(-25), pauses: [[5, 7], [15, 17]]
    });
    const segs = detectSilenceSegments(data, SR, [], []);
    expect(segs.map((s) => [s.startTime, s.endTime])).toHaveLength(2);
    expect(Math.abs(segs[0].startTime - 5000)).toBeLessThan(250);
    expect(Math.abs(segs[1].startTime - 15000)).toBeLessThan(250);
  });

  it('finds pauses under AGC-lifted room noise at -34 dBFS under -15 dBFS speech (QA-034 range)', () => {
    const data = buildSignal({
      seconds: 20, speechAmp: dbToAmp(-15), pauseAmp: dbToAmp(-34), pauses: [[5, 7], [15, 17]]
    });
    const segs = detectSilenceSegments(data, SR, [], []);
    expect(segs.map((s) => [s.startTime, s.endTime])).toHaveLength(2);
    expect(Math.abs(segs[0].startTime - 5000)).toBeLessThan(250);
    expect(Math.abs(segs[1].startTime - 15000)).toBeLessThan(250);
  });

  it('finds two pauses without blip', () => {
    const out = new Float32Array(20 * SR);
    const speechAmp = dbToAmp(-15);
    const pauseAmp = dbToAmp(-38);
    out.fill(speechAmp);
    for (let i = 5 * SR; i < 7 * SR; i++) out[i] = pauseAmp;
    for (let i = 15 * SR; i < 17 * SR; i++) out[i] = pauseAmp;
    const segs = detectSilenceSegments(out, SR, [], []);
    expect(segs.map((s) => [s.startTime, s.endTime])).toHaveLength(2);
    expect(Math.abs(segs[0].startTime - 5000)).toBeLessThan(500);
    expect(Math.abs(segs[0].endTime - 7000)).toBeLessThan(500);
  });
});

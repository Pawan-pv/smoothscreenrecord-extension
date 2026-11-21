/**
 * QA-021 property tests: the silence detector must generalise across rooms,
 * levels and gains, not just the hand-written fixtures.
 *
 * Every case is seeded, so a failure is reproducible. Ground truth is known
 * because the pauses are synthesized.
 */
import { describe, it, expect } from 'vitest';
import { detectSilenceSegments } from '../../src/engine/audio-processor';
import { SR, mulberry32, makeNoise, addVoice } from './qa021-fixtures';

const EDGE_TOLERANCE_MS = 400;
const MAX_SPEECH_DAMAGE_PER_SEGMENT_MS = 150;

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

interface Pause { start: number; end: number }

function makePauses(seconds: number, count: number, rnd: () => number): Pause[] {
  const pauses: Pause[] = [];
  let cursor = 2500 + Math.floor(rnd() * 1500);
  for (let i = 0; i < count; i++) {
    const length = 1300 + Math.floor(rnd() * 1300);
    if (cursor + length > (seconds - 1.5) * 1000) break;
    pauses.push({ start: cursor, end: cursor + length });
    cursor += length + 1800 + Math.floor(rnd() * 2200);
  }
  return pauses;
}

function complement(seconds: number, pauses: Pause[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const p of [...pauses].sort((a, b) => a.start - b.start)) {
    if (p.start > cursor) spans.push([cursor, p.start]);
    cursor = Math.max(cursor, p.end);
  }
  if (cursor < seconds * 1000) spans.push([cursor, seconds * 1000]);
  return spans;
}

function assertFound(
  name: string,
  seconds: number,
  data: Float32Array,
  pauses: Pause[]
): void {
  const segs = detectSilenceSegments(data, SR, [], []);
  const used = new Set<number>();
  for (const p of pauses) {
    const idx = segs.findIndex(
      (s, i) =>
        !used.has(i) &&
        Math.abs(s.startTime - p.start) <= EDGE_TOLERANCE_MS &&
        Math.abs(s.endTime - p.end) <= EDGE_TOLERANCE_MS
    );
    expect(idx, `${name}: pause ${p.start}-${p.end} not found (got ${JSON.stringify(segs)})`).toBeGreaterThanOrEqual(0);
    used.add(idx);
  }
  expect(segs.length, `${name}: unexpected extra cuts`).toBe(pauses.length);

  const speech = complement(seconds, pauses);
  for (const s of segs) {
    let damage = 0;
    for (const [a, b] of speech) damage += overlapMs(s.startTime, s.endTime, a, b);
    expect(
      damage,
      `${name}: cut ${s.startTime}-${s.endTime} removes ${damage}ms of speech`
    ).toBeLessThanOrEqual(MAX_SPEECH_DAMAGE_PER_SEGMENT_MS);
  }
}

describe('QA-021 silence detection properties', () => {
  it('finds seeded pauses across random room-noise floors', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = mulberry32(seed * 7919);
      const seconds = 18 + Math.floor(rnd() * 7);
      const noiseDb = -46 + rnd() * 18; // -46 .. -28 dBFS room noise
      const speechDb = -16 + rnd() * 4; // -16 .. -12 dBFS speech
      const pauses = makePauses(seconds, 2 + Math.floor(rnd() * 2), rnd);
      const data = makeNoise(seconds, noiseDb, seed * 13);
      addVoice(data, { speechDb, pauses: pauses.map((p) => [p.start, p.end]), seed: seed * 17 });
      assertFound(`seed ${seed} (noise ${noiseDb.toFixed(1)} dBFS)`, seconds, data, pauses);
    }
  }, 15000);

  it('still detects the exact pause levels measured with a real microphone (BUGS.md QA-021)', () => {
    // C1 run 2: speech -14.4..-16.6 dBFS; pause 5-7 s at
    // -34.5/-32.6/-33.8/-28.1 and pause 15-17 s at -41.1/-41.5/-37.6/-37.5.
    // `addVoice`'s harmonic waveform has an RMS well below its scale, so the
    // scale is calibrated against a speech-only probe to get real dBFS speech.
    const targetSpeechDb = -15.5;
    const probe = new Float32Array(SR * 2);
    addVoice(probe, { speechDb: 0, pauses: [], seed: 99 });
    let probeSum = 0;
    for (const v of probe) probeSum += v * v;
    const probeRms = Math.sqrt(probeSum / probe.length);
    const speechDb = 20 * Math.log10(Math.pow(10, targetSpeechDb / 20) / probeRms);

    const seconds = 20;
    const pauses: Pause[] = [{ start: 5000, end: 7000 }, { start: 15000, end: 17000 }];
    const data = makeNoise(seconds, -38, 1234);
    addVoice(data, { speechDb, pauses: pauses.map((p) => [p.start, p.end]), seed: 99 });

    const measured: Array<[number, number, number]> = [
      [5000, 5500, -34.5], [5500, 6000, -32.6], [6000, 6500, -33.8], [6500, 7000, -28.1],
      [15000, 15500, -41.1], [15500, 16000, -41.5], [16000, 16500, -37.6], [16500, 17000, -37.5],
    ];
    for (const [startMs, endMs, db] of measured) {
      const noise = makeNoise((endMs - startMs) / 1000, db, Math.round(startMs));
      data.set(noise, Math.round((startMs / 1000) * SR));
    }

    assertFound('measured C1 rooms', seconds, data, pauses);
  });

  it('is invariant to a uniform gain change (the product enables AGC)', () => {
    const seconds = 18;
    const pauses: Pause[] = [{ start: 4000, end: 6000 }, { start: 12000, end: 14000 }];
    const base = makeNoise(seconds, -30, 55);
    addVoice(base, { speechDb: -15, pauses: pauses.map((p) => [p.start, p.end]), seed: 56 });

    const quiet = new Float32Array(base.length);
    const loud = new Float32Array(base.length);
    for (let i = 0; i < base.length; i++) {
      quiet[i] = base[i] * 0.5; // -6 dB
      loud[i] = base[i] * 2; // +6 dB
    }

    assertFound('unity gain', seconds, base, pauses);
    assertFound('AGC -6 dB', seconds, quiet, pauses);
    assertFound('AGC +6 dB', seconds, loud, pauses);
  });

  it('never cuts a noise-only room, for any seeded floor', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rnd = mulberry32(seed * 104729);
      const seconds = 12 + Math.floor(rnd() * 6);
      const data = makeNoise(seconds, -50 + rnd() * 30, seed * 23);
      const segs = detectSilenceSegments(data, SR, [], []);
      expect(segs, `seed ${seed}: noise-only recording was cut`).toEqual([]);
    }
  });
});

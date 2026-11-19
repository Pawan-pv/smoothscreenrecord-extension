/**
 * QA-021 deterministic fixture matrix.
 *
 * Every fixture is generated from a fixed seed so the metrics are reproducible
 * on any machine. The "speech" is a harmonic voice-like signal with a syllable
 * envelope; the noise is white/pink-ish noise. Ground truth is the list of
 * spans in which no speech is present.
 */
export const SR = 48000;

export interface Fixture {
  name: string;
  description: string;
  data: Float32Array;
  /** Ground-truth pauses (ms). */
  pauses: Array<[number, number]>;
  /** Spans (ms) that contain speech and must never be cut. */
  speech: Array<[number, number]>;
  /** Interaction events that must protect a pause. */
  clicks?: Array<{ t: number }>;
  keystrokes?: Array<{ t: number }>;
  /** Expect no cuts at all (music/noise-only fixtures). */
  expectNoCuts?: boolean;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dbToAmp = (db: number) => Math.pow(10, db / 20);

/** Uniform noise with the requested RMS. */
export function makeNoise(seconds: number, rmsDb: number, seed: number): Float32Array {
  const r = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * SR));
  const amp = dbToAmp(rmsDb) * Math.sqrt(3);
  for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * amp;
  return out;
}

/** One-pole low-passed noise, i.e. a steady fan-like rumble. */
function makeFan(seconds: number, rmsDb: number, seed: number): Float32Array {
  const white = makeNoise(seconds, rmsDb, seed);
  const out = new Float32Array(white.length);
  let state = 0;
  const a = 0.06;
  for (let i = 0; i < white.length; i++) {
    state += a * (white[i] - state);
    out[i] = state;
  }
  // Renormalise to the requested RMS.
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
  const rms = Math.sqrt(sum / out.length) || 1;
  const target = dbToAmp(rmsDb);
  const gain = target / rms;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/**
 * Voice-like harmonic signal with a 4 Hz syllable envelope (250 ms period, a
 * 60 ms dip per syllable) and optional pauses.
 */
export function addVoice(
  out: Float32Array,
  opts: { speechDb: number; pauses: Array<[number, number]>; seed: number; syllablePeriodMs?: number }
): void {
  const r = mulberry32(opts.seed);
  const amp = dbToAmp(opts.speechDb);
  const period = opts.syllablePeriodMs ?? 250;
  // A few harmonics with slow formant drift: much more voice-like than noise.
  const f0 = 140 + r() * 40;
  for (let i = 0; i < out.length; i++) {
    const tMs = (i / SR) * 1000;
    const inPause = opts.pauses.some(([a, b]) => tMs >= a && tMs < b);
    if (inPause) continue;
    const phase = (tMs % period) / period;
    // 60 ms dip at the end of every syllable: articulation, not a pause.
    const dip = phase > 0.76 ? 0.04 : 1;
    // Slow amplitude drift (breathing / emphasis).
    const drift = 0.8 + 0.2 * Math.sin((2 * Math.PI * tMs) / 3700);
    const t = i / SR;
    const v =
      0.55 * Math.sin(2 * Math.PI * f0 * t) +
      0.25 * Math.sin(2 * Math.PI * f0 * 2 * t + 0.4) +
      0.12 * Math.sin(2 * Math.PI * f0 * 3 * t + 1.1);
    out[i] += v * amp * dip * drift;
  }
}

function addMusic(out: Float32Array, opts: { db: number; seconds: number }): void {
  const amp = dbToAmp(opts.db);
  const len = Math.min(out.length, Math.round(opts.seconds * SR));
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const chord =
      Math.sin(2 * Math.PI * 220 * t) +
      0.7 * Math.sin(2 * Math.PI * 277.18 * t) +
      0.5 * Math.sin(2 * Math.PI * 329.63 * t);
    const tremolo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.35 * t);
    out[i] += (chord / 2.2) * amp * tremolo;
  }
}

function addGradualNoise(out: Float32Array, fromDb: number, toDb: number, seed: number): void {
  const r = mulberry32(seed);
  for (let i = 0; i < out.length; i++) {
    const frac = i / out.length;
    const db = fromDb + (toDb - fromDb) * frac;
    out[i] += (r() * 2 - 1) * dbToAmp(db) * Math.sqrt(3);
  }
}

function speechSpans(seconds: number, pauses: Array<[number, number]>): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const [a, b] of [...pauses].sort((x, y) => x[0] - y[0])) {
    if (a > cursor) spans.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < seconds * 1000) spans.push([cursor, seconds * 1000]);
  return spans;
}

export function buildFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];

  // 1. Clean speech, two 2 s pauses.
  {
    const seconds = 16;
    const pauses: Array<[number, number]> = [[4000, 6000], [11000, 13000]];
    const data = new Float32Array(seconds * SR);
    addVoice(data, { speechDb: -15, pauses, seed: 1 });
    fixtures.push({
      name: 'clean-speech', description: 'digital-silence pauses under clean speech',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 2. Speech with room noise (-38 dBFS).
  {
    const seconds = 18;
    const pauses: Array<[number, number]> = [[5000, 7000], [12000, 14000]];
    const data = makeNoise(seconds, -38, 2);
    addVoice(data, { speechDb: -15, pauses, seed: 3 });
    fixtures.push({
      name: 'room-noise', description: 'speech -15 dBFS, room noise -38 dBFS',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 3. Speech with a continuous fan at -30 dBFS.
  {
    const seconds = 18;
    const pauses: Array<[number, number]> = [[4000, 6200], [12000, 14200]];
    const data = makeFan(seconds, -30, 4);
    addVoice(data, { speechDb: -14, pauses, seed: 5 });
    fixtures.push({
      name: 'fan-noise', description: 'speech -14 dBFS, continuous fan -30 dBFS',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 4. Quiet speech at -30 dBFS with -45 dBFS noise.
  {
    const seconds = 16;
    const pauses: Array<[number, number]> = [[4000, 6000], [11000, 13000]];
    const data = makeNoise(seconds, -45, 6);
    addVoice(data, { speechDb: -30, pauses, seed: 7 });
    fixtures.push({
      name: 'quiet-speech', description: 'quiet speech -30 dBFS, very low noise',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 5. Loud speech at -6 dBFS with -30 dBFS noise.
  {
    const seconds = 16;
    const pauses: Array<[number, number]> = [[4000, 6000], [11000, 13000]];
    const data = makeNoise(seconds, -30, 8);
    addVoice(data, { speechDb: -6, pauses, seed: 9 });
    fixtures.push({
      name: 'loud-speech', description: 'loud speech -6 dBFS, room noise -30 dBFS',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 6. Long pauses (2.5 s).
  {
    const seconds = 18;
    const pauses: Array<[number, number]> = [[4000, 6500], [11000, 13500]];
    const data = makeNoise(seconds, -40, 10);
    addVoice(data, { speechDb: -14, pauses, seed: 11 });
    fixtures.push({
      name: 'long-pauses', description: '2.5 s pauses in -40 dBFS room noise',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 7. Short pauses (0.8 s) - below the 1.2 s minimum, must not be cut.
  {
    const seconds = 16;
    const pauses: Array<[number, number]> = [[4000, 4800], [8000, 8800], [12000, 12800]];
    const data = makeNoise(seconds, -40, 12);
    addVoice(data, { speechDb: -14, pauses, seed: 13 });
    fixtures.push({
      name: 'short-pauses', description: '0.8 s pauses must not be cut (1.2 s minimum)',
      data, pauses: [], speech: [[0, seconds * 1000]],
      expectNoCuts: true,
    });
  }

  // 8. Breathing between sentences: 300 ms gaps every 3 s.
  {
    const seconds = 15;
    const breaths: Array<[number, number]> = [[3000, 3300], [6000, 6300], [9000, 9300], [12000, 12300]];
    const data = makeNoise(seconds, -38, 14);
    addVoice(data, { speechDb: -15, pauses: breaths, seed: 15 });
    fixtures.push({
      name: 'breathing', description: '300 ms breath gaps between sentences',
      data, pauses: [], speech: [[0, seconds * 1000]],
      expectNoCuts: true,
    });
  }

  // 9. Background music only, no speech, no gaps.
  {
    const seconds = 16;
    const data = new Float32Array(seconds * SR);
    addMusic(data, { db: -22, seconds });
    fixtures.push({
      name: 'music-only', description: 'continuous background music, no speech',
      data, pauses: [], speech: [[0, seconds * 1000]],
      expectNoCuts: true,
    });
  }

  // 10. Noise only, nobody speaking.
  {
    const seconds = 14;
    const data = makeFan(seconds, -35, 16);
    fixtures.push({
      name: 'noise-only', description: 'room noise without any speech',
      data, pauses: [], speech: [[0, seconds * 1000]],
      expectNoCuts: true,
    });
  }

  // 11. Gradually changing noise floor (-45 -> -25 dBFS) with clean speech.
  {
    const seconds = 22;
    const pauses: Array<[number, number]> = [[4000, 6000], [10000, 12000], [17000, 19000]];
    const data = new Float32Array(seconds * SR);
    addGradualNoise(data, -45, -25, 17);
    addVoice(data, { speechDb: -12, pauses, seed: 19 });
    fixtures.push({
      name: 'gradual-noise', description: 'noise floor rises from -45 to -25 dBFS',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  // 12. Speech with clicks/keystrokes inside the pauses.
  {
    const seconds = 18;
    const pauses: Array<[number, number]> = [[5000, 7000], [12000, 14000]];
    const data = makeNoise(seconds, -38, 20);
    addVoice(data, { speechDb: -15, pauses, seed: 21 });
    fixtures.push({
      name: 'interactions', description: 'pauses containing clicks and keystrokes',
      data,
      pauses: [[12000, 14000]], // only the pause without interaction may be cut
      speech: [[0, 5000], [7000, 12000], [14000, seconds * 1000]],
      clicks: [{ t: 5400 }, { t: 6600 }],
      keystrokes: [{ t: 6000 }],
    });
  }

  // 13. QA-042: AGC-lifted pauses. WebRTC AGC holds the room noise up while the
  // speaker is silent, so the two pauses sit only 13-16 dB under the voice
  // (-25 / -28 dBFS under -12 dBFS speech) instead of falling to the floor.
  // Measured on the real-mic C1/C2 recordings; a fixed drop of more than 16 dB
  // below the speech peak misses them, and the old min(floor, drop) rule was
  // inert because the floor term was always higher.
  {
    const seconds = 18;
    const pauses: Array<[number, number]> = [[4000, 6000], [12000, 14000]];
    const targetSpeechDb = -12;
    // addVoice's harmonic waveform has an RMS well below its scale, so the
    // scale is calibrated against a speech-only probe to get real dBFS speech.
    const probe = new Float32Array(SR * 2);
    addVoice(probe, { speechDb: 0, pauses: [], seed: 23 });
    let probeSum = 0;
    for (const v of probe) probeSum += v * v;
    const probeRms = Math.sqrt(probeSum / probe.length);
    const speechDb = 20 * Math.log10(Math.pow(10, targetSpeechDb / 20) / probeRms);
    const data = makeNoise(seconds, -30, 22);
    addVoice(data, { speechDb, pauses, seed: 23 });
    // The AGC lifts the floor while the speaker is silent.
    const floors: Array<[number, number, number]> = [
      [4000, 6000, -25],
      [12000, 14000, -28],
    ];
    for (const [startMs, endMs, db] of floors) {
      const floor = makeNoise((endMs - startMs) / 1000, db, Math.round(startMs));
      data.set(floor, Math.round((startMs / 1000) * SR));
    }
    fixtures.push({
      name: 'agc-pauses', description: 'AGC-lifted pauses -25/-28 dBFS under -12 dBFS speech',
      data, pauses, speech: speechSpans(seconds, pauses),
    });
  }

  return fixtures;
}

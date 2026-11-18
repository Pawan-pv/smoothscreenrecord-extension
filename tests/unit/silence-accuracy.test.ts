/**
 * QA-021 accuracy matrix: precision / recall / speech-damage.
 *
 * Ground truth is known exactly because every fixture is generated from a fixed
 * seed. A detected segment counts as a true positive when it matches a
 * ground-truth pause within MATCH_TOLERANCE_MS at both ends. Every detected
 * segment that overlaps a speech span is measured: a silence detector that
 * removes speech is worse than one that misses a pause.
 */
import { describe, it, expect } from 'vitest';
import { detectSilenceSegments } from '../../src/engine/audio-processor';
import { buildFixtures, SR } from './qa021-fixtures';

const MATCH_TOLERANCE_MS = 400;
const MAX_SPEECH_DAMAGE_MS = 250;

interface Metrics {
  name: string;
  gt: number;
  detected: number;
  tp: number;
  fp: number;
  fn: number;
  recall: number;
  precision: number;
  speechDamageMs: number;
  worstOffsetMs: number;
}

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function measure(name: string, segs: Array<{ startTime: number; endTime: number }>, fx: ReturnType<typeof buildFixtures>[number]): Metrics {
  const matched = new Set<number>();
  let tp = 0;
  let worstOffset = 0;
  for (const [gs, ge] of fx.pauses) {
    let best = -1;
    let bestScore = Infinity;
    segs.forEach((s, i) => {
      if (matched.has(i)) return;
      const score = Math.max(Math.abs(s.startTime - gs), Math.abs(s.endTime - ge));
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore <= MATCH_TOLERANCE_MS) {
      matched.add(best);
      tp++;
      worstOffset = Math.max(worstOffset, bestScore);
    }
  }
  const fp = segs.length - tp;
  const fn = fx.pauses.length - tp;
  let speechDamage = 0;
  for (const s of segs) {
    for (const [ss, se] of fx.speech) speechDamage += overlapMs(s.startTime, s.endTime, ss, se);
  }
  return {
    name,
    gt: fx.pauses.length,
    detected: segs.length,
    tp,
    fp,
    fn,
    recall: fx.pauses.length ? tp / fx.pauses.length : 1,
    precision: segs.length ? tp / segs.length : 1,
    speechDamageMs: Math.round(speechDamage),
    worstOffsetMs: Math.round(worstOffset),
  };
}

describe('QA-021 silence detection accuracy matrix', () => {
  const fixtures = buildFixtures();

  it('prints the metrics table', () => {
    const rows: Metrics[] = [];
    for (const fx of fixtures) {
      const segs = detectSilenceSegments(
        fx.data,
        SR,
        (fx.clicks ?? []) as any,
        (fx.keystrokes ?? []) as any
      );
      rows.push(measure(fx.name, segs, fx));
      if (fx.expectNoCuts && segs.length > 0) {
        rows[rows.length - 1].fp = segs.length;
        rows[rows.length - 1].precision = 0;
      }
    }
    console.table(rows.map((r) => ({
      fixture: r.name,
      'gt pauses': r.gt,
      detected: r.detected,
      tp: r.tp,
      fp: r.fp,
      fn: r.fn,
      recall: r.recall.toFixed(2),
      precision: r.precision.toFixed(2),
      'speech damaged ms': r.speechDamageMs,
      'worst edge ms': r.worstOffsetMs,
    })));

    // 1. Every real pause must be found.
    const recallFailures = rows.filter((r) => r.gt > 0 && r.recall < 1);
    expect(recallFailures.map((r) => `${r.name}: ${r.tp}/${r.gt}`)).toEqual([]);

    // 2. No fixture may cut speech.
    const damage = rows.filter((r) => r.speechDamageMs > MAX_SPEECH_DAMAGE_MS);
    expect(damage.map((r) => `${r.name}: ${r.speechDamageMs}ms`)).toEqual([]);

    // 3. Fixtures that must never be cut.
    const falseCuts = rows.filter((r) => {
      const fx = fixtures.find((f) => f.name === r.name)!;
      return fx.expectNoCuts && r.detected > 0;
    });
    expect(falseCuts.map((r) => `${r.name}: ${r.detected}`)).toEqual([]);
  });
});

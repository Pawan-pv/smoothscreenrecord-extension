import { describe, it, expect } from 'vitest';
import { readWebmTrackStartTimes, readWebmAudioStartMs } from '../../src/engine/webm-timestamps';

/**
 * Minimal EBML/WebM builder. Produces real element IDs, vint sizes and block
 * payloads; the parser walks the same bytes Chrome writes from MediaRecorder.
 */
function idBytes(id: number): number[] {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
}

function sizeBytes(size: number, forceUnknown = false): number[] {
  if (forceUnknown) return [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  if (size < 0x7f) return [0x80 | size];
  if (size < 0x3fff) return [0x40 | (size >> 8), size & 0xff];
  return [0x10 | ((size >> 24) & 0x0f), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff];
}

function el(id: number, payload: number[], forceUnknown = false): number[] {
  return [...idBytes(id), ...sizeBytes(payload.length, forceUnknown), ...payload];
}

function uintBytes(value: number, length: number): number[] {
  const out = new Array(length).fill(0);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

function block(track: number, relMs: number): number[] {
  const rel = relMs < 0 ? relMs + 0x10000 : relMs;
  return el(0xa3, [0x80 | track, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0xde, 0xad, 0xbe, 0xef]);
}

function buildWebm(opts: {
  audioStartMs: number | null;
  videoStartMs?: number;
  unknownSegment?: boolean;
  unknownCluster?: boolean;
  timecodeScale?: number;
}): Uint8Array {
  const scale = opts.timecodeScale ?? 1_000_000;
  const info = el(0x1549a966, el(0x2ad7b1, uintBytes(scale, 3)));
  const videoEntry = el(0xae, [...el(0xd7, [1]), ...el(0x83, [1])]);
  const audioEntry = el(0xae, [...el(0xd7, [2]), ...el(0x83, [2])]);
  const tracks = el(0x1654ae6b, [...videoEntry, ...(opts.audioStartMs === null ? [] : audioEntry)]);

  const firstClusterChildren: number[] = [...el(0xe7, [0x00, 0x00])];
  if (opts.videoStartMs !== undefined) firstClusterChildren.push(...block(1, opts.videoStartMs));
  if (opts.audioStartMs !== null && opts.audioStartMs < 1000) {
    firstClusterChildren.push(...block(2, opts.audioStartMs));
  }
  const firstCluster = el(0x1f43b675, firstClusterChildren, opts.unknownCluster);

  const parts = [info, tracks, firstCluster];
  // A later cluster carries the audio start when it is more than 1 s in.
  if (opts.audioStartMs !== null && opts.audioStartMs >= 1000) {
    parts.push(el(0x1f43b675, [...el(0xe7, uintBytes(1000, 2)), ...block(2, opts.audioStartMs - 1000)]));
  }

  const segment = el(0x18538067, parts.flat(), opts.unknownSegment);
  const header = el(0x1a45dfa3, [0x42, 0x86, 0x81, 0x01]);
  return Uint8Array.from([...header, ...segment]);
}

describe('WebM track start times (QA-011)', () => {
  it('reads a delayed audio track and the video start', () => {
    const info = readWebmTrackStartTimes(buildWebm({ audioStartMs: 782, videoStartMs: 0 }));
    expect(info.audioTrackNumber).toBe(2);
    expect(info.videoTrackNumber).toBe(1);
    expect(info.videoStartMs).toBe(0);
    expect(info.audioStartMs).toBe(782);
  });

  it('reads an audio start in a later cluster', () => {
    const info = readWebmTrackStartTimes(buildWebm({ audioStartMs: 1822, videoStartMs: 0 }));
    expect(info.audioStartMs).toBe(1822);
  });

  it('handles the unknown-size Segment and Cluster MediaRecorder writes', () => {
    const info = readWebmTrackStartTimes(
      buildWebm({ audioStartMs: 26, videoStartMs: 0, unknownSegment: true, unknownCluster: true })
    );
    expect(info.unknownSegmentSize).toBe(true);
    expect(info.audioStartMs).toBe(26);
    expect(info.videoStartMs).toBe(0);
  });

  it('honours a non-default TimecodeScale', () => {
    // 2 ms per tick: block at tick 391 -> 782 ms.
    const info = readWebmTrackStartTimes(buildWebm({ audioStartMs: 782, videoStartMs: 0, timecodeScale: 2_000_000 }));
    expect(info.audioStartMs).toBe(1564);
  });

  it('reports null when there is no audio track', () => {
    const info = readWebmTrackStartTimes(buildWebm({ audioStartMs: null, videoStartMs: 0 }));
    expect(info.audioStartMs).toBeNull();
    expect(info.audioTrackNumber).toBeNull();
  });

  it('never guesses on garbage input', () => {
    expect(readWebmTrackStartTimes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toMatchObject({
      audioStartMs: null,
      videoStartMs: null,
    });
  });

  it('readWebmAudioStartMs reads a Blob prefix', async () => {
    const blob = new Blob([buildWebm({ audioStartMs: 782, videoStartMs: 0 })], { type: 'video/webm' });
    expect(await readWebmAudioStartMs(blob)).toBe(782);
  });

  it('readWebmAudioStartMs returns 0 for a non-WebM blob', async () => {
    expect(await readWebmAudioStartMs(new Blob(['not a webm file at all']), 0)).toBe(0);
  });
});




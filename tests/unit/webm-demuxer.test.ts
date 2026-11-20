import { describe, it, expect } from 'vitest';
import { demuxWebmVideo, webmVideoDecoderConfig } from '../../src/engine/webm-demuxer';
import { buildWebm, mediaRecorderLike, VP8_TRACK, OPUS_TRACK } from './webm-builder';

function ok(bytes: Uint8Array) {
  const r = demuxWebmVideo(bytes);
  if (!r.ok) throw new Error(`demux failed: ${r.reason}`);
  return r.track;
}

describe('WebM video demuxer (QA-001)', () => {
  it('reads a MediaRecorder-like stream: unknown-size Segment and Clusters, audio interleaved', () => {
    const track = ok(mediaRecorderLike({ frames: 230, frameMs: 40, gop: 100, clusterSize: 37 }));
    expect(track.codecId).toBe('V_VP8');
    expect(track.width).toBe(1920);
    expect(track.height).toBe(1080);
    expect(track.frames).toHaveLength(230);
    expect(track.frames.map((f) => f.timestampUs)).toEqual(Array.from({ length: 230 }, (_, i) => i * 40_000));
    expect(track.frames.filter((f) => f.keyframe).map((f) => f.timestampUs)).toEqual([0, 4_000_000, 8_000_000]);
    expect(track.truncated).toBe(false);
  });

  it('returns the exact payload bytes of every frame', () => {
    const bytes = mediaRecorderLike({ frames: 12, clusterSize: 5 });
    const track = ok(bytes);
    track.frames.forEach((f, i) => {
      expect(Array.from(bytes.subarray(f.offset, f.offset + f.length))).toEqual([0xd0, i & 0xff, (i >> 8) & 0xff]);
    });
  });

  it('applies the TimecodeScale and negative relative block times', () => {
    // 500 µs ticks; the second block sits before its cluster timecode.
    const bytes = buildWebm({
      timecodeScale: 500_000,
      tracks: [VP8_TRACK],
      blocks: [
        { track: 1, time: 100, key: true },
        { track: 1, time: 160 },
      ],
      clusterSize: 1,
    });
    expect(ok(bytes).frames.map((f) => f.timestampUs)).toEqual([50_000, 80_000]);
  });

  it('reads known-size clusters and BlockGroups (keyframe = no ReferenceBlock)', () => {
    const bytes = buildWebm({
      tracks: [VP8_TRACK, OPUS_TRACK],
      blocks: [
        { track: 1, time: 0, key: true, group: true },
        { track: 2, time: 5 },
        { track: 1, time: 33, key: false, group: true },
        { track: 1, time: 66, key: false },
      ],
      clusterSize: 2,
    });
    const frames = ok(bytes).frames;
    expect(frames.map((f) => [f.timestampUs, f.keyframe])).toEqual([[0, true], [33_000, false], [66_000, false]]);
  });

  it('flags invisible frames', () => {
    const bytes = buildWebm({
      tracks: [VP8_TRACK],
      blocks: [
        { track: 1, time: 0, key: true },
        { track: 1, time: 20, invisible: true },
        { track: 1, time: 40 },
      ],
    });
    expect(ok(bytes).frames.map((f) => f.invisible)).toEqual([false, true, false]);
  });

  it('drops a final block cut off by a crash and reports the truncation', () => {
    const full = mediaRecorderLike({ frames: 20, audio: false, clusterSize: 100 });
    const cut = full.subarray(0, full.length - 2);
    const track = ok(cut);
    expect(track.truncated).toBe(true);
    expect(track.frames).toHaveLength(19);
    expect(track.frames[18].timestampUs).toBe(18 * 40_000);
  });

  it('refuses what it cannot describe exactly instead of guessing', () => {
    expect(demuxWebmVideo(new Uint8Array(0))).toEqual({ ok: false, reason: 'the file is empty' });
    expect(demuxWebmVideo(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0, 0, 0, 0]))).toMatchObject({ ok: false, reason: 'no Matroska Segment' });
    expect(demuxWebmVideo(buildWebm({ tracks: [OPUS_TRACK], blocks: [{ track: 2, time: 0 }] }))).toMatchObject({ ok: false, reason: 'no video track' });
    expect(demuxWebmVideo(buildWebm({ tracks: [VP8_TRACK], blocks: [{ track: 1, time: 0, key: true, laced: true }] }))).toMatchObject({ ok: false, reason: 'laced video blocks' });
    expect(demuxWebmVideo(buildWebm({ tracks: [VP8_TRACK], blocks: [{ track: 2, time: 0 }] }))).toMatchObject({ ok: false, reason: 'the video track has no frames' });
  });

  it('maps codecs to WebCodecs decoder configs', () => {
    const base = { trackNumber: 1, codecPrivate: null, width: 1280, height: 720, frames: [], truncated: false };
    expect(webmVideoDecoderConfig({ ...base, codecId: 'V_VP8' })).toEqual({ codec: 'vp8', codedWidth: 1280, codedHeight: 720 });
    expect(webmVideoDecoderConfig({ ...base, codecId: 'V_VP9' })?.codec).toBe('vp09.00.10.08');
    const avcc = Uint8Array.from([1, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0x00]);
    const avc = webmVideoDecoderConfig({ ...base, codecId: 'V_MPEG4/ISO/AVC', codecPrivate: avcc });
    expect(avc?.codec).toBe('avc1.42c01f');
    expect(avc?.description).toBe(avcc);
    expect(webmVideoDecoderConfig({ ...base, codecId: 'V_MPEG4/ISO/AVC' })).toBeNull();
    expect(webmVideoDecoderConfig({ ...base, codecId: 'V_AV1' })).toBeNull();
  });
});

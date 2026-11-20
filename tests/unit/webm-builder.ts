/**
 * Minimal EBML/WebM writer for unit tests: real element IDs, vint sizes,
 * SimpleBlock/BlockGroup layouts and unknown-size Segment/Cluster the way
 * Chrome's MediaRecorder writes them.
 */
export function idBytes(id: number): number[] {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
}

export function sizeBytes(size: number, unknown = false): number[] {
  if (unknown) return [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  if (size < 0x7f) return [0x80 | size];
  if (size < 0x3fff) return [0x40 | (size >> 8), size & 0xff];
  return [0x10 | ((size >> 24) & 0x0f), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff];
}

export function el(id: number, payload: number[], unknown = false): number[] {
  return [...idBytes(id), ...sizeBytes(payload.length, unknown), ...payload];
}

export function uintBytes(value: number, length: number): number[] {
  const out = new Array(length).fill(0);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

const str = (s: string) => [...s].map((c) => c.charCodeAt(0));

export interface TestBlock {
  track: number;
  /** Absolute time in timecode ticks (ms with the default scale). */
  time: number;
  key?: boolean;
  invisible?: boolean;
  /** Payload; defaults to [track, index-ish marker]. */
  data?: number[];
  /** Write as BlockGroup (keyframe = no ReferenceBlock). */
  group?: boolean;
  laced?: boolean;
}

export interface TestTrack {
  number: number;
  type: 1 | 2;
  codecId: string;
  codecPrivate?: number[];
  width?: number;
  height?: number;
}

export interface BuildOptions {
  tracks?: TestTrack[];
  blocks: TestBlock[];
  /** Blocks per cluster (cluster timecode = first block time). */
  clusterSize?: number;
  unknownSegment?: boolean;
  unknownCluster?: boolean;
  timecodeScale?: number;
}

export const VP8_TRACK: TestTrack = { number: 1, type: 1, codecId: 'V_VP8', width: 1920, height: 1080 };
export const OPUS_TRACK: TestTrack = { number: 2, type: 2, codecId: 'A_OPUS' };

function blockBytes(b: TestBlock, clusterTime: number): number[] {
  const rel = b.time - clusterTime;
  const relU = rel < 0 ? rel + 0x10000 : rel;
  const data = b.data ?? [0xd0, b.track, b.time & 0xff, (b.time >> 8) & 0xff];
  if (b.group) {
    const block = el(0xa1, [0x80 | b.track, (relU >> 8) & 0xff, relU & 0xff, 0x00, ...data]);
    const ref = b.key ? [] : el(0xfb, [0xff]);
    return el(0xa0, [...block, ...ref]);
  }
  let flags = 0;
  if (b.key) flags |= 0x80;
  if (b.invisible) flags |= 0x08;
  if (b.laced) flags |= 0x02;
  return el(0xa3, [0x80 | b.track, (relU >> 8) & 0xff, relU & 0xff, flags, ...data]);
}

export function buildWebm(opts: BuildOptions): Uint8Array {
  const scale = opts.timecodeScale ?? 1_000_000;
  const info = el(0x1549a966, el(0x2ad7b1, uintBytes(scale, 3)));
  const tracks = (opts.tracks ?? [VP8_TRACK, OPUS_TRACK]).map((t) => {
    const children = [...el(0xd7, [t.number]), ...el(0x83, [t.type]), ...el(0x86, str(t.codecId))];
    if (t.codecPrivate) children.push(...el(0x63a2, t.codecPrivate));
    if (t.width && t.height) children.push(...el(0xe0, [...el(0xb0, uintBytes(t.width, 2)), ...el(0xba, uintBytes(t.height, 2))]));
    return el(0xae, children);
  });
  const parts: number[][] = [info, el(0x1654ae6b, tracks.flat())];
  const per = opts.clusterSize ?? 1_000_000;
  for (let i = 0; i < opts.blocks.length; i += per) {
    const group = opts.blocks.slice(i, i + per);
    const clusterTime = group[0].time;
    const children = [...el(0xe7, uintBytes(clusterTime, 4)), ...group.flatMap((b) => blockBytes(b, clusterTime))];
    parts.push(el(0x1f43b675, children, opts.unknownCluster));
  }
  const segment = el(0x18538067, parts.flat(), opts.unknownSegment);
  const header = el(0x1a45dfa3, [0x42, 0x86, 0x81, 0x01]);
  return Uint8Array.from([...header, ...segment]);
}

/** A MediaRecorder-like VP8 + Opus stream: video every `frameMs`, keyframe every `gop` frames. */
export function mediaRecorderLike(opts: { frames: number; frameMs?: number; gop?: number; audio?: boolean; clusterSize?: number; startMs?: number }): Uint8Array {
  const frameMs = opts.frameMs ?? 40;
  const gop = opts.gop ?? 100;
  const start = opts.startMs ?? 0;
  const blocks: TestBlock[] = [];
  for (let i = 0; i < opts.frames; i++) {
    blocks.push({ track: 1, time: start + i * frameMs, key: i % gop === 0, data: [0xd0, i & 0xff, (i >> 8) & 0xff] });
    if (opts.audio !== false) blocks.push({ track: 2, time: start + i * frameMs + 7, data: [0xa0] });
  }
  return buildWebm({ blocks, clusterSize: opts.clusterSize ?? 50, unknownSegment: true, unknownCluster: true });
}

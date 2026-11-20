import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SequentialVideoFrameSource,
  LOOKAHEAD_CHUNKS,
  MAX_DECODE_QUEUE,
  type FrameDecoder,
  type FrameSourceDeps,
} from '../../src/engine/sequential-frame-source';
import { buildWebm, mediaRecorderLike, VP8_TRACK, type TestBlock } from './webm-builder';

class FakeFrame {
  closed = 0;
  constructor(readonly timestamp: number, readonly displayWidth = 1920, readonly displayHeight = 1080) {}
  close() { this.closed++; }
}

interface FakeChunk { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }

interface DecoderBehaviour {
  /** ms before a dequeued chunk produces its frame (0 = next macrotask). */
  outputDelayMs?: number;
  /** Timestamps (µs) whose output is silently dropped. */
  drop?: Set<number>;
  /** Timestamp (µs) that makes the decoder report an error. */
  errorAt?: number;
  /** Timestamps (µs) that are invisible (decoded, never output). */
  invisible?: Set<number>;
}

/** Enforces the WebCodecs rules the source relies on. */
class FakeDecoder extends EventTarget implements FrameDecoder {
  state = 'unconfigured';
  queue: FakeChunk[] = [];
  needKey = true;
  decoded: number[] = [];
  maxQueue = 0;
  private inFlight = 0;
  constructor(
    private readonly init: { output: (f: FakeFrame) => void; error: (e: unknown) => void },
    private readonly behaviour: DecoderBehaviour,
    private readonly log: { frames: FakeFrame[]; decoders: FakeDecoder[] }
  ) {
    super();
    log.decoders.push(this);
  }
  get decodeQueueSize() { return this.queue.length; }
  configure() { this.state = 'configured'; this.needKey = true; }
  decode(chunk: unknown) {
    const c = chunk as FakeChunk;
    if (this.state !== 'configured') throw new DOMException('decode() on a ' + this.state + ' decoder', 'InvalidStateError');
    if (this.needKey && c.type !== 'key') throw new DOMException('A key frame is required after configure() or flush().', 'DataError');
    this.needKey = false;
    this.queue.push(c);
    this.maxQueue = Math.max(this.maxQueue, this.queue.length);
    setTimeout(() => this.pump(), 0);
  }
  private pump() {
    if (this.state !== 'configured') return;
    const c = this.queue.shift();
    if (!c) return;
    this.inFlight++;
    this.dispatchEvent(new Event('dequeue'));
    setTimeout(() => {
      this.inFlight--;
      if (this.state !== 'configured') return;
      this.decoded.push(c.timestamp);
      if (c.timestamp === this.behaviour.errorAt) {
        this.state = 'closed';
        this.init.error(new DOMException('Decoding error.', 'EncodingError'));
        return;
      }
      if (this.behaviour.drop?.has(c.timestamp) || this.behaviour.invisible?.has(c.timestamp)) return;
      const f = new FakeFrame(c.timestamp);
      this.log.frames.push(f);
      this.init.output(f);
    }, this.behaviour.outputDelayMs ?? 0);
  }
  async flush() {
    while (this.queue.length > 0 || this.inFlight > 0) {
      if (this.state !== 'configured') throw new DOMException('closed', 'AbortError');
      await new Promise((r) => setTimeout(r, 1));
    }
    this.needKey = true;
  }
  close() { this.state = 'closed'; this.queue = []; }
  listenerCount = 0;
  override addEventListener(type: string, l: EventListenerOrEventListenerObject | null) { this.listenerCount++; super.addEventListener(type, l); }
  override removeEventListener(type: string, l: EventListenerOrEventListenerObject | null) { this.listenerCount--; super.removeEventListener(type, l); }
}

function makeDeps(behaviour: DecoderBehaviour = {}, supported = true) {
  const log = { frames: [] as FakeFrame[], decoders: [] as FakeDecoder[] };
  const deps: FrameSourceDeps<FakeFrame> = {
    createDecoder: (init) => new FakeDecoder(init, behaviour, log),
    createChunk: (init) => ({ ...init }),
    isConfigSupported: async () => ({ supported }),
  };
  return { deps, log };
}

async function open(bytes: Uint8Array, behaviour: DecoderBehaviour = {}) {
  const { deps, log } = makeDeps(behaviour);
  const r = await SequentialVideoFrameSource.fromBytes(bytes, deps);
  if (!r.ok) throw new Error(r.reason);
  return { source: r.source, log };
}

/** Latest frame time (ms) <= t for frames every `frameMs`. */
const expectedMs = (t: number, frameMs: number, frames: number) =>
  Math.min(frames - 1, Math.max(0, Math.floor((t + 1e-6) / frameMs))) * frameMs;

afterEach(() => { vi.useRealTimers(); });

describe('SequentialVideoFrameSource (QA-001)', () => {
  it('sequential 60 fps timeline: every frame is the latest source frame with pts <= t, each chunk decoded once', async () => {
    const frames = 250; // 10 s at 25 fps, keyframe every 100
    const { source, log } = await open(mediaRecorderLike({ frames, frameMs: 40, gop: 100 }));
    let maxHeld = 0;
    for (let f = 0; f <= 600; f++) {
      const t = f * (1000 / 60);
      const frame = await source.frameAt(t);
      expect(frame.timestamp).toBe(expectedMs(t, 40, frames) * 1000);
      maxHeld = Math.max(maxHeld, source.heldFrames);
    }
    expect(source.decodedChunks).toBe(frames);
    expect(source.restarts).toBe(0);
    expect(log.decoders).toHaveLength(1);
    expect(log.decoders[0].maxQueue).toBeLessThanOrEqual(MAX_DECODE_QUEUE);
    expect(maxHeld).toBeLessThanOrEqual(LOOKAHEAD_CHUNKS + 2);
    source.close();
  });

  it('is exact on frame boundaries (the <video> clock showed the previous frame there)', async () => {
    const { source } = await open(mediaRecorderLike({ frames: 300, frameMs: 40 }));
    // 492/60 s = 8.2 s exactly hits source frame 205 (8200 ms).
    expect((await source.frameAt(492 * (1000 / 60))).timestamp).toBe(8_200_000);
    expect((await source.frameAt(8199.999)).timestamp).toBe(8_160_000);
    source.close();
  });

  it('serves rapid consecutive requests in order without awaiting each one', async () => {
    const { source } = await open(mediaRecorderLike({ frames: 100, frameMs: 40 }));
    const times = [0, 16.7, 33.3, 50, 66.7, 83.3, 100, 400, 401, 1999];
    const seen: number[] = [];
    await Promise.all(times.map((t) => source.frameAt(t).then((f) => { seen.push(f.timestamp); })));
    expect(seen).toEqual(times.map((t) => expectedMs(t, 40, 100) * 1000));
    source.close();
  });

  it('returns the same frame for repeated requests of the same time without decoding again', async () => {
    const { source } = await open(mediaRecorderLike({ frames: 50 }));
    const a = await source.frameAt(500);
    const decoded = source.decodedChunks;
    const b = await source.frameAt(500);
    const c = await source.frameAt(519);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a.timestamp).toBe(480_000);
    expect(source.decodedChunks).toBe(decoded);
    source.close();
  });

  it('near the start: t = 0 and t before the first frame give the first frame', async () => {
    const { source } = await open(mediaRecorderLike({ frames: 20, startMs: 30 }));
    expect((await source.frameAt(0)).timestamp).toBe(30_000);
    source.close();
    const again = await open(mediaRecorderLike({ frames: 20, startMs: 30 }));
    expect((await again.source.frameAt(-50)).timestamp).toBe(30_000);
    again.source.close();
  });

  it('near and beyond the end: holds the last frame (QA-002 tail), flushing the decoder once', async () => {
    const { source, log } = await open(mediaRecorderLike({ frames: 30, frameMs: 40 }));
    expect((await source.frameAt(29 * 40 - 1)).timestamp).toBe(28 * 40_000);
    expect((await source.frameAt(29 * 40)).timestamp).toBe(29 * 40_000);
    const last = await source.frameAt(60_000);
    expect(last.timestamp).toBe(29 * 40_000);
    expect(await source.frameAt(1e9)).toBe(last);
    expect(log.decoders).toHaveLength(1);
    source.close();
  });

  it('a request behind the current frame restarts at the keyframe of its GOP', async () => {
    const { source, log } = await open(mediaRecorderLike({ frames: 250, frameMs: 40, gop: 100 }));
    await source.frameAt(6000); // itself jumps from 0 s to the 4 s GOP
    const before = source.restarts;
    const back = await source.frameAt(4100);
    expect(back.timestamp).toBe(4_080_000);
    expect(source.restarts).toBe(before + 1);
    // the restarted decoder was fed the keyframe at 4.0 s first (the fake enforces it)
    expect(log.decoders[log.decoders.length - 1].decoded[0]).toBe(4_000_000);
    source.close();
  });

  it('a silence cut that skips whole GOPs restarts at the target GOP instead of decoding the gap', async () => {
    const frames = 500; // 20 s, keyframe every 4 s
    const { source } = await open(mediaRecorderLike({ frames, frameMs: 40, gop: 100 }));
    await source.frameAt(1000);
    const after = await source.frameAt(13_010);
    expect(after.timestamp).toBe(13_000_000);
    expect(source.restarts).toBe(1);
    // 12..13 s decoded from the 12 s keyframe; 1..12 s never decoded.
    expect(source.decodedChunks).toBeLessThan(80);
    source.close();
  });

  it('decoder error: rejects at once with the decoder message, and keeps failing', async () => {
    const { source } = await open(mediaRecorderLike({ frames: 50 }), { errorAt: 400_000 });
    await expect(source.frameAt(1000)).rejects.toThrow(/video decoder failed: Decoding error/);
    await expect(source.frameAt(1000)).rejects.toThrow(/video decoder failed/);
    source.close();
  });

  it('delayed frame output: waits for the decoder, however long, with no deadline', async () => {
    vi.useFakeTimers();
    const { source } = await open(mediaRecorderLike({ frames: 10 }), { outputDelayMs: 15_000 });
    let resolved: number | null = null;
    source.frameAt(80).then((f) => { resolved = f.timestamp; });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(resolved).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resolved).toBe(80_000);
    source.close();
  });

  it('a frame the decoder silently never returns does not hang: the latest earlier frame is shown', async () => {
    const { source } = await open(mediaRecorderLike({ frames: 30 }), { drop: new Set([200_000, 1_160_000]) });
    expect((await source.frameAt(200)).timestamp).toBe(160_000); // 200 ms was dropped
    expect((await source.frameAt(240)).timestamp).toBe(240_000);
    // the very last frame dropped: flush() delivers everything, the earlier one stays
    expect((await source.frameAt(5000)).timestamp).toBe(1_120_000);
    source.close();
  });

  it('invisible frames are decoded but never selected', async () => {
    const blocks: TestBlock[] = [];
    for (let i = 0; i < 20; i++) {
      blocks.push({ track: 1, time: i * 40, key: i === 0 });
      if (i % 5 === 2) blocks.push({ track: 1, time: i * 40 + 20, invisible: true });
    }
    const bytes = buildWebm({ tracks: [VP8_TRACK], blocks, clusterSize: 7, unknownSegment: true, unknownCluster: true });
    const invisible = new Set(blocks.filter((b) => b.invisible).map((b) => b.time * 1000));
    const { source } = await open(bytes, { invisible });
    for (let t = 0; t < 800; t += 5) {
      const ts = (await source.frameAt(t)).timestamp;
      expect(invisible.has(ts)).toBe(false);
      expect(ts).toBe(Math.floor(t / 40) * 40_000);
    }
    source.close();
  });

  it('cancellation while waiting for the decoder rejects with AbortError and leaves nothing alive after close()', async () => {
    vi.useFakeTimers();
    const { source, log } = await open(mediaRecorderLike({ frames: 40 }), { outputDelayMs: 1000 });
    const ac = new AbortController();
    const pending = source.frameAt(500, ac.signal).then(() => 'resolved', (e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(10);
    ac.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBe('AbortError');
    await expect(source.frameAt(0, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    source.close();
    await vi.advanceTimersByTimeAsync(5000); // late decoder outputs after close
    expect(log.frames.every((f) => f.closed === 1)).toBe(true);
    expect(log.decoders.every((d) => d.state === 'closed' && d.listenerCount === 0)).toBe(true);
    await expect(source.frameAt(0)).rejects.toThrow(/closed/);
  });

  it('close() after a full run releases every decoded frame exactly once', async () => {
    const { source, log } = await open(mediaRecorderLike({ frames: 120, gop: 30 }));
    for (let t = 0; t < 5000; t += 1000 / 60) await source.frameAt(t);
    await source.frameAt(2000); // backwards: restart
    source.close();
    source.close();
    expect(log.frames.length).toBeGreaterThan(0);
    expect(log.frames.every((f) => f.closed === 1)).toBe(true);
    expect(log.decoders.every((d) => d.state === 'closed')).toBe(true);
  });

  it('reports why it cannot be used, so the exporter keeps the <video> path', async () => {
    const unsupported = makeDeps({}, false);
    const r1 = await SequentialVideoFrameSource.fromBytes(mediaRecorderLike({ frames: 5 }), unsupported.deps);
    expect(r1).toEqual({ ok: false, reason: 'the browser cannot decode vp8' });
    const r2 = await SequentialVideoFrameSource.fromBytes(new Uint8Array([1, 2, 3]), makeDeps().deps);
    expect(r2.ok).toBe(false);
    const noKey = buildWebm({ tracks: [VP8_TRACK], blocks: [{ track: 1, time: 0 }, { track: 1, time: 40 }] });
    expect(await SequentialVideoFrameSource.fromBytes(noKey, makeDeps().deps)).toEqual({ ok: false, reason: 'the video track has no keyframe' });
    expect(unsupported.log.decoders).toHaveLength(0);
  });

  it('a recording that does not start on a keyframe starts at its first keyframe', async () => {
    const blocks: TestBlock[] = [{ track: 1, time: 0 }, { track: 1, time: 40 }];
    for (let i = 2; i < 10; i++) blocks.push({ track: 1, time: i * 40, key: i === 2 });
    const { source } = await open(buildWebm({ tracks: [VP8_TRACK], blocks }));
    expect((await source.frameAt(0)).timestamp).toBe(80_000);
    expect((await source.frameAt(200)).timestamp).toBe(200_000);
    source.close();
  });
});

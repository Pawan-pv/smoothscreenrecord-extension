/**
 * Sequential WebCodecs frame source for the MP4 exporter (QA-001).
 *
 * Root cause this replaces: the exporter seeked a <video> element once per
 * output frame. Chrome serves every seek by decoding forward from the previous
 * keyframe, so each seek costs O(distance to that keyframe) — measured
 * `34 ms + 83 ms per second since the keyframe` for 1080p VP8 on Chromium 158 —
 * and a fixed per-seek deadline turned a slow-but-healthy decode into
 * "Seek timeout". The same element clock also truncated exact frame boundaries
 * (63 of 1200 exported frames showed the previous source frame).
 *
 * This source demuxes the recording once and decodes every source frame at most
 * once, in order. `frameAt(t)` returns the frame that is on screen at t: the
 * latest displayable frame whose presentation timestamp is <= t (the first
 * frame before the video starts, the last frame after it ends). Selection uses
 * the container timestamps, so it is exact at frame boundaries.
 *
 * Guarantees:
 *  - no timers and no deadlines: progress is driven by the decoder's own
 *    `output` / `dequeue` events; a decoder error rejects immediately;
 *  - bounded memory: at most `LOOKAHEAD_CHUNKS + 1` decoded frames plus the
 *    decoder's own queue are alive, so a hardware frame pool is never starved;
 *  - cancellation through an AbortSignal; `close()` releases every frame and
 *    the decoder.
 */
import { demuxWebmVideo, webmVideoDecoderConfig, type WebmVideoTrack } from './webm-demuxer';

/** The subset of a decoded VideoFrame this module relies on. */
export interface DecodedFrame {
  readonly timestamp: number;
  close(): void;
}

/** The subset of WebCodecs' VideoDecoder this module relies on. */
export interface FrameDecoder {
  readonly decodeQueueSize: number;
  readonly state: string;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: unknown): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

export interface FrameSourceDeps<F extends DecodedFrame> {
  createDecoder(init: { output: (frame: F) => void; error: (error: unknown) => void }): FrameDecoder;
  createChunk(init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }): unknown;
  isConfigSupported(config: VideoDecoderConfig): Promise<{ supported?: boolean }>;
}

export type FrameSourceOpenResult<F extends DecodedFrame> =
  | { ok: true; source: SequentialVideoFrameSource<F> }
  | { ok: false; reason: string };

/** Chunks fed beyond the frame currently needed. */
export const LOOKAHEAD_CHUNKS = 2;
/** Upper bound on chunks queued inside the decoder. */
export const MAX_DECODE_QUEUE = 4;

function abortError(message = 'The export was cancelled.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function browserDeps(): FrameSourceDeps<VideoFrame> | null {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  return {
    createDecoder: (init) => new VideoDecoder({ output: init.output, error: (e) => init.error(e) }) as unknown as FrameDecoder,
    createChunk: (init) => new EncodedVideoChunk(init),
    isConfigSupported: (config) => VideoDecoder.isConfigSupported(config),
  };
}

interface Chunk {
  type: 'key' | 'delta';
  timestamp: number;
  offset: number;
  length: number;
  visible: boolean;
}

export class SequentialVideoFrameSource<F extends DecodedFrame = VideoFrame> {
  /** Opens a recording. `ok: false` means "use another frame path", with the reason. */
  static async open(blob: Blob): Promise<FrameSourceOpenResult<VideoFrame>> {
    const deps = browserDeps();
    if (!deps) return { ok: false, reason: 'WebCodecs VideoDecoder is not available' };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return SequentialVideoFrameSource.fromBytes(bytes, deps);
  }

  static async fromBytes<G extends DecodedFrame>(bytes: Uint8Array, deps: FrameSourceDeps<G>): Promise<FrameSourceOpenResult<G>> {
    const demuxed = demuxWebmVideo(bytes);
    if (!demuxed.ok) return { ok: false, reason: `WebM demux: ${demuxed.reason}` };
    const config = webmVideoDecoderConfig(demuxed.track);
    if (!config) return { ok: false, reason: `unsupported video codec ${demuxed.track.codecId || '(none)'}` };
    let support: { supported?: boolean };
    try {
      support = await deps.isConfigSupported(config);
    } catch (err) {
      return { ok: false, reason: `decoder config check failed: ${(err as Error)?.message || err}` };
    }
    if (!support?.supported) return { ok: false, reason: `the browser cannot decode ${config.codec}` };
    const firstKey = demuxed.track.frames.findIndex((f) => f.keyframe);
    if (firstKey < 0) return { ok: false, reason: 'the video track has no keyframe' };
    if (!demuxed.track.frames.slice(firstKey).some((f) => !f.invisible)) {
      return { ok: false, reason: 'the video track has no displayable frame' };
    }
    return { ok: true, source: new SequentialVideoFrameSource<G>(bytes, demuxed.track, config, firstKey, deps) };
  }

  readonly codec: string;
  readonly width: number | null;
  readonly height: number | null;
  /** Decodable chunks (from the first keyframe on). */
  readonly frameCount: number;
  /** Presentation timestamps (µs) of the displayable frames, ascending. */
  private readonly sortedPts: number[];
  /** For each decode index, the decode index of the keyframe that starts its GOP. */
  private readonly gopStart: number[];
  /** Decode index of each displayable presentation timestamp. */
  private readonly decodeIndexOfPts = new Map<number, number>();
  private readonly chunks: Chunk[];

  private decoder!: FrameDecoder;
  private generation = 0;
  private feedIndex = 0;
  private flushed = false;
  /** Visible chunks handed to the current decoder vs. frames it has returned. */
  private fedVisible = 0;
  private outputs = 0;
  private pending: F[] = [];
  private current: F | null = null;
  private failure: Error | null = null;
  private closed = false;
  private waiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private readonly onDequeue = () => this.wake();
  /** Chunks handed to a decoder over the source's lifetime (diagnostics/tests). */
  decodedChunks = 0;
  /** Decoder restarts at a keyframe (backwards request or a jump past a GOP). */
  restarts = 0;

  private constructor(
    private readonly bytes: Uint8Array,
    track: WebmVideoTrack,
    private readonly config: VideoDecoderConfig,
    firstKey: number,
    private readonly deps: FrameSourceDeps<F>
  ) {
    this.codec = config.codec;
    this.width = track.width;
    this.height = track.height;
    this.chunks = track.frames.slice(firstKey).map((f) => ({
      type: f.keyframe ? 'key' as const : 'delta' as const,
      timestamp: f.timestampUs,
      offset: f.offset,
      length: f.length,
      visible: !f.invisible,
    }));
    this.frameCount = this.chunks.length;
    this.sortedPts = this.chunks.filter((c) => c.visible).map((c) => c.timestamp).sort((a, b) => a - b);
    let gop = 0;
    this.gopStart = this.chunks.map((c, i) => {
      if (c.type === 'key') gop = i;
      return gop;
    });
    this.chunks.forEach((c, i) => {
      if (c.visible && !this.decodeIndexOfPts.has(c.timestamp)) this.decodeIndexOfPts.set(c.timestamp, i);
    });
    this.startDecoder(0);
  }

  private startDecoder(decodeIndex: number): void {
    const generation = ++this.generation;
    this.decoder = this.deps.createDecoder({
      output: (frame) => {
        if (this.closed || generation !== this.generation) {
          frame.close();
          return;
        }
        this.outputs++;
        this.pending.push(frame);
        this.wake();
      },
      error: (error) => {
        if (generation !== this.generation) return;
        this.fail(new Error(`The video decoder failed: ${(error as Error)?.message || error}`));
      },
    });
    this.decoder.configure(this.config);
    this.decoder.addEventListener('dequeue', this.onDequeue);
    this.feedIndex = decodeIndex;
    this.flushed = false;
    this.fedVisible = 0;
    this.outputs = 0;
  }

  /** Last presentation timestamp (µs) of the video track. */
  get lastTimestampUs(): number {
    return this.sortedPts[this.sortedPts.length - 1];
  }

  /** Decoded frames currently alive (current + look-ahead). */
  get heldFrames(): number {
    return this.pending.length + (this.current ? 1 : 0);
  }

  /**
   * The frame on screen at `timeMs`. The returned frame stays owned by the
   * source and is valid until the next `frameAt()` or `close()` call.
   * Overlapping calls are served one after another, in call order.
   */
  frameAt(timeMs: number, signal?: AbortSignal): Promise<F> {
    const run = this.chain.then(() => this.frameAtSerial(timeMs, signal));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private chain: Promise<void> = Promise.resolve();

  private async frameAtSerial(timeMs: number, signal?: AbortSignal): Promise<F> {
    this.assertUsable(signal);
    if (!Number.isFinite(timeMs)) throw new Error(`Cannot read a frame at a non-finite time (${timeMs}).`);

    const targetPts = this.sortedPts[this.indexAtOrBefore(Math.round(timeMs * 1000))];
    const targetDecodeIndex = this.decodeIndexOfPts.get(targetPts) as number;
    if (this.current && this.current.timestamp === targetPts) return this.current;

    // Going backwards, or jumping past at least one whole GOP (a silence cut):
    // restart at the keyframe of the target's GOP instead of decoding frames
    // nobody will see.
    const gop = this.gopStart[targetDecodeIndex];
    const behind = this.current !== null && this.current.timestamp > targetPts;
    if (behind || gop > this.feedIndex) this.restartAt(gop);

    for (;;) {
      this.assertUsable(signal);

      while (this.pending.length > 0 && this.pending[0].timestamp <= targetPts) {
        this.current?.close();
        this.current = this.pending.shift() as F;
      }
      if (this.current && this.current.timestamp === targetPts) return this.current;
      // The frame after the target is already decoded, so nothing between them
      // will be displayed: the latest earlier frame is the one on screen at t.
      if (this.current && this.pending.length > 0) return this.current;

      const canFeed = this.feedIndex < this.chunks.length;
      const inFlight = this.fedVisible - this.outputs;
      if (
        canFeed &&
        this.decoder.decodeQueueSize < MAX_DECODE_QUEUE &&
        (this.feedIndex <= targetDecodeIndex + LOOKAHEAD_CHUNKS || inFlight === 0)
      ) {
        this.feedNext();
        continue;
      }
      if (!canFeed && !this.flushed) {
        this.flushed = true;
        await this.flushDecoder(signal);
        continue;
      }
      if (!canFeed && this.flushed) {
        // flush() has delivered every output this decoder will ever produce.
        if (this.current) return this.current;
        if (this.pending.length > 0) {
          this.current = this.pending.shift() as F;
          return this.current;
        }
        throw new Error(`The video decoder produced no frame for ${timeMs.toFixed(1)} ms (${this.decodedChunks} chunks decoded).`);
      }
      await this.waitForProgress(signal);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseFrames();
    this.stopDecoder();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(abortError('The frame source was closed.'));
  }

  private assertUsable(signal?: AbortSignal): void {
    if (this.closed) throw new Error('The frame source is closed.');
    if (signal?.aborted) throw abortError();
    if (this.failure) throw this.failure;
  }

  private indexAtOrBefore(tUs: number): number {
    let lo = 0;
    let hi = this.sortedPts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedPts[mid] <= tUs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  private feedNext(): void {
    const c = this.chunks[this.feedIndex++];
    if (c.visible) this.fedVisible++;
    this.decodedChunks++;
    this.decoder.decode(this.deps.createChunk({
      type: c.type,
      timestamp: c.timestamp,
      data: this.bytes.subarray(c.offset, c.offset + c.length),
    }));
  }

  private releaseFrames(): void {
    this.current?.close();
    this.current = null;
    for (const f of this.pending) f.close();
    this.pending = [];
  }

  private stopDecoder(): void {
    this.decoder.removeEventListener('dequeue', this.onDequeue);
    try {
      if (this.decoder.state !== 'closed') this.decoder.close();
    } catch { /* already closed */ }
  }

  private restartAt(decodeIndex: number): void {
    this.restarts++;
    this.releaseFrames();
    this.stopDecoder();
    this.startDecoder(decodeIndex);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.resolve();
  }

  /** Resolves on the decoder's next output or dequeue; rejects on error/abort/close. */
  private waitForProgress(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.waiter = null;
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      };
    });
  }

  private async flushDecoder(signal?: AbortSignal): Promise<void> {
    const decoder = this.decoder;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      decoder.flush().then(
        () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(this.failure ?? new Error(`The video decoder failed while flushing: ${(e as Error)?.message || e}`));
        }
      );
    });
  }
}

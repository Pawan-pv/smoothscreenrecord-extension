import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoFrameSeeker, describeMediaState, type SeekableVideo } from '../../src/engine/video-seeker';

class FakeRange {
  constructor(private readonly _start: number, private readonly _end: number) {}
  get length() { return this._end > this._start ? 1 : 0; }
  start() { return this._start; }
  end() { return this._end; }
}

type Listeners = Map<string, Set<(event?: unknown) => void>>;

class FakeVideo extends EventTarget implements SeekableVideo {
  readyState = 4;
  duration = 10;
  seeking = false;
  error: { code: number; message?: string } | null = null;
  seekable = new FakeRange(0, 10);
  buffered = new FakeRange(0, 10);
  assignments: number[] = [];
  listeners: Listeners = new Map();
  /** How the element responds to a currentTime assignment. */
  mode: 'seeked' | 'silent' | 'never' | 'error' = 'seeked';
  /** readyState after the seek completes. */
  postSeekReadyState = 4;

  private _currentTime = 0;
  get currentTime() { return this._currentTime; }
  set currentTime(value: number) {
    this.assignments.push(value);
    this._currentTime = Math.min(Math.max(value, 0), this.seekable.end());
    if (this.mode === 'never') {
      // Chrome keeps `seeking` true when the decoder never reaches the frame.
      this.seeking = true;
      return;
    }
    this.seeking = true;
    setTimeout(() => {
      if (this.mode === 'error') {
        this.error = { code: 3, message: 'PIPELINE_ERROR_DECODE' };
        this.seeking = false;
        this.dispatchEvent(new Event('error'));
        return;
      }
      this.seeking = false;
      this.readyState = this.postSeekReadyState;
      if (this.mode === 'seeked') this.dispatchEvent(new Event('seeked'));
    }, 0);
  }

  override addEventListener(type: string, listener: (event?: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener);
  }
  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}

describe('VideoFrameSeeker (QA-001)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function run<T>(promise: Promise<T>, ms = 5000): Promise<T> {
    const result = promise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error })
    );
    await vi.advanceTimersByTimeAsync(ms);
    const settled = await result;
    if (!settled.ok) throw settled.error;
    return settled.value;
  }

  async function runReject(promise: Promise<unknown>, ms = 5000): Promise<Error> {
    const result = promise.then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error })
    );
    await vi.advanceTimersByTimeAsync(ms);
    const settled = await result;
    if (settled.ok) throw new Error('Expected the seek to reject, but it resolved.');
    return settled.error as Error;
  }

  it('seeks sequentially and assigns each timestamp exactly once', async () => {
    const video = new FakeVideo();
    const seeker = new VideoFrameSeeker(video);
    await run(seeker.seekTo(1));
    await run(seeker.seekTo(2));
    await run(seeker.seekTo(3));
    expect(video.assignments).toEqual([1, 2, 3]);
    expect(video.listenerCount()).toBe(0);
  });

  it('does not re-seek or wait when the element is already on the frame', async () => {
    const video = new FakeVideo();
    const seeker = new VideoFrameSeeker(video);
    await run(seeker.seekTo(1));
    const second = await run(seeker.seekTo(1.002));
    expect(second.waited).toBe(false);
    expect(video.assignments).toEqual([1]);
  });

  it('seeks close to the start', async () => {
    const video = new FakeVideo();
    const seeker = new VideoFrameSeeker(video);
    // Move away first: a seek to 0 while already at 0 correctly does no work.
    await run(seeker.seekTo(4));
    const outcome = await run(seeker.seekTo(0));
    expect(outcome.targetSec).toBe(0);
    expect(outcome.waited).toBe(true);
    expect(video.assignments).toEqual([4, 0]);
  });

  it('seeks close to the end', async () => {
    const video = new FakeVideo();
    const seeker = new VideoFrameSeeker(video);
    await run(seeker.seekTo(9.99));
    expect(video.assignments).toEqual([9.99]);
  });

  it('clamps a seek beyond the seekable range and reports it', async () => {
    const video = new FakeVideo();
    const seeker = new VideoFrameSeeker(video);
    const outcome = await run(seeker.seekTo(20));
    expect(outcome.clamped).toBe(true);
    expect(outcome.targetSec).toBe(10);
    expect(video.assignments).toEqual([10]);
  });

  it('clamps a negative seek to zero', async () => {
    const video = new FakeVideo();
    const seeker = new VideoFrameSeeker(video);
    const outcome = await run(seeker.seekTo(-3));
    expect(outcome.targetSec).toBe(0);
    expect(outcome.clamped).toBe(true);
  });

  it('resolves when seeked fires but the frame data arrives later', async () => {
    const video = new FakeVideo();
    video.postSeekReadyState = 1;
    const seeker = new VideoFrameSeeker(video);
    const promise = seeker.seekTo(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(video.readyState).toBe(1);
    video.readyState = 2;
    video.dispatchEvent(new Event('loadeddata'));
    const outcome = await run(promise);
    expect(outcome.waited).toBe(true);
  });

  it('resolves when the seeked event is missed but the element reached the target', async () => {
    const video = new FakeVideo();
    video.mode = 'silent'; // position changes, no seeked event
    const seeker = new VideoFrameSeeker(video, { timeoutMs: 500, pollIntervalMs: 25 });
    const outcome = await run(seeker.seekTo(4), 1000);
    expect(outcome.waited).toBe(true);
    expect(video.currentTime).toBe(4);
  });

  it('rejects with diagnostics when the decoder errors during the seek', async () => {
    const video = new FakeVideo();
    video.mode = 'error';
    const seeker = new VideoFrameSeeker(video);
    const err = await runReject(seeker.seekTo(2));
    expect(err.message).toContain('video decoder failed');
    expect(err.message).toContain('PIPELINE_ERROR_DECODE');
  });

  it('rejects instead of hanging when the seek never completes', async () => {
    const video = new FakeVideo();
    video.mode = 'never';
    video.currentTime = 5;
    const seeker = new VideoFrameSeeker(video, { timeoutMs: 200, pollIntervalMs: 20 });
    const promise = seeker.seekTo(2);
    const err = await runReject(promise, 1000);
    expect(err.message).toContain('Seek timeout');
    expect(err.message).toContain('currentTime=');
  });

  it('rejects when the export is cancelled during a seek and removes its listeners', async () => {
    const video = new FakeVideo();
    video.mode = 'never';
    const controller = new AbortController();
    const seeker = new VideoFrameSeeker(video, { timeoutMs: 5000 });
    const promise = seeker.seekTo(3, controller.signal);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const err = await runReject(promise, 100);
    expect(err.name).toBe('AbortError');
    expect(video.listenerCount()).toBe(0);
  });

  it('rejects an already-aborted seek without touching the element', async () => {
    const video = new FakeVideo();
    const controller = new AbortController();
    controller.abort();
    const seeker = new VideoFrameSeeker(video);
    await expect(seeker.seekTo(1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(video.assignments).toEqual([]);
  });

  it('dispose rejects an in-flight seek and cleans up', async () => {
    const video = new FakeVideo();
    video.mode = 'never';
    const seeker = new VideoFrameSeeker(video, { timeoutMs: 5000 });
    const promise = seeker.seekTo(2);
    await vi.advanceTimersByTimeAsync(10);
    seeker.dispose();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(video.listenerCount()).toBe(0);
  });

  it('waits for metadata/first data before the first seek', async () => {
    const video = new FakeVideo();
    video.readyState = 0;
    const seeker = new VideoFrameSeeker(video);
    const promise = seeker.seekTo(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(video.assignments).toEqual([]);
    video.readyState = 2;
    video.dispatchEvent(new Event('loadeddata'));
    await run(promise);
    expect(video.assignments).toEqual([1]);
  });

  it('rejects when the media has no seekable range and no finite duration', async () => {
    const video = new FakeVideo();
    video.seekable = new FakeRange(0, 0);
    video.duration = Infinity;
    const seeker = new VideoFrameSeeker(video);
    await expect(seeker.seekTo(1)).rejects.toThrow('no seekable range');
  });

  it('describes media state for error reports', () => {
    const video = new FakeVideo();
    const text = describeMediaState(video);
    expect(text).toContain('readyState=4');
    expect(text).toContain('seekable=[0.000..10.000]');
    expect(text).toContain('error=none');
  });
});

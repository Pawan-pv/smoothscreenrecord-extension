/**
 * Deterministic frame seeker for the MP4 exporter (QA-001).
 *
 * The previous implementation assigned `video.currentTime` twice, waited only
 * for a `seeked` event, and failed after a fixed 2 s with no diagnostics. When
 * the element was already at the requested position (the tail of a recording
 * whose wall-clock duration is longer than the last decoded frame) Chrome never
 * fired another `seeked`, so a perfectly healthy element looked "stuck".
 *
 * This seeker:
 *  - clamps the target to the real seekable range, so out-of-range seeks are an
 *    explicit, correct operation instead of an accidental no-op;
 *  - assigns `currentTime` exactly once;
 *  - resolves immediately when the element is already on the requested frame;
 *  - listens for `seeked`, `error`, `abort`, `emptied` and also verifies the
 *    element state while it waits, so a missed event cannot hang the export;
 *  - rejects with full media diagnostics when the decoder genuinely stalls;
 *  - honours an AbortSignal (export cancellation) and removes every listener;
 *  - optionally reports the presented frame time through rVFC when the
 *    compositor actually presents frames.
 */

export interface SeekableVideo {
  currentTime: number;
  readyState: number;
  duration: number;
  seeking: boolean;
  error: { code: number; message?: string } | null;
  seekable: { length: number; start(index: number): number; end(index: number): number };
  buffered: { length: number; start(index: number): number; end(index: number): number };
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
  requestVideoFrameCallback?: (cb: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface VideoSeekerOptions {
  /** Bound for a single seek that makes no progress. Not a correctness delay. */
  timeoutMs?: number;
  /** How often the element state is checked while waiting. */
  pollIntervalMs?: number;
  /** Two positions closer than this are the same frame request. */
  epsilonSec?: number;
  /** rVFC presentation grace; 0 disables presentation tracking entirely. */
  frameGraceMs?: number;
}

export interface SeekOutcome {
  /** Position the element was asked to reach (after clamping). */
  targetSec: number;
  /** True when the requested time was outside the seekable range. */
  clamped: boolean;
  /** True when the element had to perform a seek (false = already there). */
  waited: boolean;
  /** Frame presentation time reported by rVFC, when the compositor presented one. */
  presentedMediaTimeSec: number | null;
}

export const DEFAULT_SEEK_TIMEOUT_MS = 2000;
const DEFAULT_READY_TIMEOUT_MS = 10000;
const DEFAULT_POLL_MS = 50;
const DEFAULT_EPSILON_SEC = 0.004;
const DEFAULT_FRAME_GRACE_MS = 0;

export function describeMediaState(video: SeekableVideo): string {
  const range = (r: { length: number; start(i: number): number; end(i: number): number }) => {
    if (!r || r.length === 0) return 'empty';
    return `[${r.start(0).toFixed(3)}..${r.end(r.length - 1).toFixed(3)}]`;
  };
  return [
    `currentTime=${video.currentTime.toFixed(3)}`,
    `duration=${Number.isFinite(video.duration) ? video.duration.toFixed(3) : String(video.duration)}`,
    `readyState=${video.readyState}`,
    `seeking=${video.seeking}`,
    `seekable=${range(video.seekable)}`,
    `buffered=${range(video.buffered)}`,
    `error=${video.error ? `${video.error.code}:${video.error.message ?? ''}` : 'none'}`,
  ].join(', ');
}

export class VideoFrameSeeker {
  private disposed = false;
  private rvfcUsable = true;
  private activeCleanup: (() => void) | null = null;

  constructor(
    private readonly video: SeekableVideo,
    private readonly options: VideoSeekerOptions = {}
  ) {}

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_SEEK_TIMEOUT_MS;
  }
  private get pollMs(): number {
    return this.options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }
  private get epsilon(): number {
    return this.options.epsilonSec ?? DEFAULT_EPSILON_SEC;
  }
  private get frameGraceMs(): number {
    return this.options.frameGraceMs ?? DEFAULT_FRAME_GRACE_MS;
  }

  /** Waits until the element can decode a frame (HAVE_CURRENT_DATA). */
  async waitUntilReady(signal?: AbortSignal, timeoutMs = DEFAULT_READY_TIMEOUT_MS): Promise<void> {
    if (this.disposed) throw new Error('The video seeker has been disposed.');
    if (signal?.aborted) throw abortError();
    if (this.video.error) throw mediaError(this.video, 'while waiting for the video to become ready');
    if (this.video.readyState >= 2) return;

    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      let timer: ReturnType<typeof setInterval> | null = null;
      let settled = false;
      const cleanup = () => {
        if (timer !== null) clearInterval(timer);
        this.video.removeEventListener('loadeddata', onReady);
        this.video.removeEventListener('canplay', onReady);
        this.video.removeEventListener('error', onError);
        this.video.removeEventListener('abort', onAbort);
        signal?.removeEventListener('abort', onAbort);
        this.activeCleanup = null;
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onReady = () => {
        if (this.video.readyState >= 2) finish(resolve);
      };
      const onError = () => finish(() => reject(mediaError(this.video, 'while waiting for the video to become ready')));
      const onAbort = () => finish(() => reject(abortError()));
      this.video.addEventListener('loadeddata', onReady);
      this.video.addEventListener('canplay', onReady);
      this.video.addEventListener('error', onError);
      this.video.addEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort);
      this.activeCleanup = () => finish(() => reject(abortError('The video seeker was disposed.')));
      timer = setInterval(() => {
        if (this.video.error) return onError();
        if (this.video.readyState >= 2) return onReady();
        if (Date.now() - started >= timeoutMs) {
          finish(() => reject(new Error(
            `The video element did not become decodable within ${timeoutMs}ms (${describeMediaState(this.video)}).`
          )));
        }
      }, this.pollMs);
      // The element may have become ready between the check and the listeners.
      onReady();
    });
  }

  /** Seeks and resolves only when the frame at the requested time is available. */
  async seekTo(targetSec: number, signal?: AbortSignal): Promise<SeekOutcome> {
    if (this.disposed) throw new Error('The video seeker has been disposed.');
    if (!Number.isFinite(targetSec)) throw new Error(`Cannot seek to a non-finite time (${targetSec}).`);
    if (signal?.aborted) throw abortError();
    if (this.video.error) throw mediaError(this.video, `before seeking to ${targetSec.toFixed(3)}s`);
    if (this.video.readyState < 1) {
      await this.waitUntilReady(signal);
    }

    const range = this.video.seekable;
    let maxSec: number;
    if (range && range.length > 0) {
      maxSec = range.end(range.length - 1);
    } else if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
      maxSec = this.video.duration;
    } else {
      throw new Error(`Cannot seek to ${targetSec.toFixed(3)}s: the media has no seekable range (${describeMediaState(this.video)}).`);
    }
    const clampedSec = Math.min(Math.max(targetSec, 0), Math.max(0, maxSec));
    const clamped = Math.abs(clampedSec - targetSec) > 1e-6;

    if (
      !this.video.seeking &&
      this.video.readyState >= 2 &&
      Math.abs(this.video.currentTime - clampedSec) <= this.epsilon
    ) {
      return { targetSec: clampedSec, clamped, waited: false, presentedMediaTimeSec: null };
    }

    return await new Promise<SeekOutcome>((resolve, reject) => {
      const started = Date.now();
      let settled = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      let frameHandle: number | null = null;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      let presented: number | null = null;

      const cleanup = () => {
        this.video.removeEventListener('seeked', onSeeked);
        this.video.removeEventListener('loadeddata', onSeeked);
        this.video.removeEventListener('canplay', onSeeked);
        this.video.removeEventListener('error', onError);
        this.video.removeEventListener('abort', onAbort);
        this.video.removeEventListener('emptied', onAbort);
        signal?.removeEventListener('abort', onAbort);
        if (timer !== null) clearInterval(timer);
        if (graceTimer !== null) clearTimeout(graceTimer);
        if (frameHandle !== null && this.video.cancelVideoFrameCallback) {
          try { this.video.cancelVideoFrameCallback(frameHandle); } catch { /* ignore */ }
        }
        this.activeCleanup = null;
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const succeed = () => finish(() => resolve({
        targetSec: clampedSec,
        clamped,
        waited: true,
        presentedMediaTimeSec: presented,
      }));
      // Keeps the error identity: callers (and the export UI) distinguish a
      // user cancellation from a decoder failure by `name === 'AbortError'`.
      const failWith = (error: Error | string) =>
        finish(() => reject(typeof error === 'string' ? new Error(error) : error));

      const onError = () => failWith(mediaError(this.video, `while seeking to ${clampedSec.toFixed(3)}s`));
      const onAbort = () => failWith(abortError());

      const frameIsAvailable = () =>
        !this.video.seeking &&
        this.video.readyState >= 2 &&
        Math.abs(this.video.currentTime - clampedSec) <= this.epsilon;

      const onSeeked = () => {
        if (this.video.error) return onError();
        // Presentation tracking is opportunistic: a hidden export element is
        // never composited, and waiting for presentation is not required to
        // read the correct decoded frame from a canvas.
        if (
          this.rvfcUsable &&
          this.frameGraceMs > 0 &&
          typeof this.video.requestVideoFrameCallback === 'function'
        ) {
          let handled = false;
          frameHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
            presented = metadata.mediaTime;
            if (!handled && frameIsAvailable()) {
              handled = true;
              succeed();
            }
          });
          graceTimer = setTimeout(() => {
            if (handled) return;
            if (presented === null) this.rvfcUsable = false;
            if (frameIsAvailable()) {
              handled = true;
              succeed();
            }
          }, this.frameGraceMs);
          return;
        }
        // `seeked` can precede the decoded frame on a slow decoder; the
        // watchdog below resolves when the frame becomes decodable.
        if (frameIsAvailable()) succeed();
      };

      this.video.addEventListener('seeked', onSeeked);
      this.video.addEventListener('loadeddata', onSeeked);
      this.video.addEventListener('canplay', onSeeked);
      this.video.addEventListener('error', onError);
      this.video.addEventListener('abort', onAbort);
      this.video.addEventListener('emptied', onAbort);
      signal?.addEventListener('abort', onAbort);
      this.activeCleanup = () => finish(() => reject(abortError('The video seeker was disposed.')));

      // Watchdog: a missed `seeked` event must not hang the export. If the
      // element is demonstrably at the target with a decodable frame, accept it.
      timer = setInterval(() => {
        if (this.video.error) return onError();
        if (frameIsAvailable()) return succeed();
        if (Date.now() - started >= this.timeoutMs) {
          failWith(
            `Seek timeout: the video frame at ${clampedSec.toFixed(3)}s was not presented within ${this.timeoutMs}ms ` +
            `(${describeMediaState(this.video)}).`
          );
        }
      }, this.pollMs);

      try {
        // The one and only assignment for this seek.
        this.video.currentTime = clampedSec;
      } catch (err) {
        failWith(`Seek failed at ${clampedSec.toFixed(3)}s: ${(err as Error)?.message || err}`);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.activeCleanup?.();
    this.activeCleanup = null;
  }
}

function abortError(message = 'The export was cancelled while seeking.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function mediaError(video: SeekableVideo, context: string): Error {
  const detail = video.error ? `code ${video.error.code}${video.error.message ? ` (${video.error.message})` : ''}` : 'unknown';
  return new Error(`The video decoder failed ${context}: ${detail} (${describeMediaState(video)}).`);
}

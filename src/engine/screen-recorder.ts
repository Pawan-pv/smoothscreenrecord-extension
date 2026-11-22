import {
  initStorage, appendVideoChunk, finalizeVideo, getRecordingBlob, commitRecording,
  newSessionId, setSessionOrigin, holdSessionLock
} from './opfs-storage';
import { patchWebmBlobDuration } from './webm-fixer';
import { diagnosticChannel } from './diagnostic-channel';
import {
  computeSnapshotSize,
  shouldCaptureSnapshot
} from './snapshot-policy';
import { CapturedNativeCursor } from '../types/telemetry';

export function shouldEnableCustomCursor(
  capturedNativeCursor: CapturedNativeCursor,
  displaySurface: string | undefined,
  hasDomCursorTelemetry: boolean
): boolean {
  if (capturedNativeCursor === 'always' || capturedNativeCursor === 'motion') return false;
  if (capturedNativeCursor === 'never') return true;
  if ((displaySurface === 'window' || displaySurface === 'monitor') && !hasDomCursorTelemetry) return false;
  return true;
}

/**
 * Recording failure reasons surfaced to the user.
 * The recorder NEVER fabricates a video: if the encoder produced no chunks we
 * fail loudly instead of synthesising a picture-only "recording".
 */
export const RECORDING_FAILURE_NO_VIDEO = 'RECORDING_FAILED_NO_VIDEO';

export interface RecorderOptions {
  includeMic: boolean;
  /** Recording session id (M1-08). Generated when omitted. */
  sessionId?: string;
  frameRate?: number;
  onChunkSaved?: (chunkIndex: number) => void;
  onStop?: (blob: Blob | null) => void;
  onMicWarning?: (message: string) => void;
  /**
   * Wall-clock (Date.now) timestamp of the very first captured video frame.
   * Every downstream timeline (clicks, keystrokes, zoom pills, badges) uses
   * this single origin so video time and telemetry time are directly comparable.
   */
  onTimelineOrigin?: (originEpochMs: number) => void;
}

const PUMP_MIN_INTERVAL_MS = 8;       // never forward more than ~120 fps
const PUMP_SAFETY_INTERVAL_MS = 500;  // re-push the last frame if the source stalls
const FIRST_FRAME_TIMEOUT_MS = 3000;  // never block the start on the first frame
const RECORDER_TIMESLICE_MS = 250;    // flush encoded data to storage 4x/second
const MAX_SNAPSHOTS = 160;
// QA-030: snapshots are documentation images. A 1024 px JPEG encoded with
// async toBlob costs a fraction of the 1280 px synchronous toDataURL, and one
// reusable canvas removes the per-snapshot allocation from the capture path.
// The cadence and the size rules live in snapshot-policy.ts so they are unit
// tested; the JPEG quality and the encode watchdog stay here.
const SNAPSHOT_JPEG_QUALITY = 0.72;
const SNAPSHOT_ENCODE_TIMEOUT_MS = 5000;
// QA-037: the live gate watches the CAPTURED picture to find the real instant
// the screen shows the recorded surface. Measured on a real run: two frames of
// the editor change 0.8 % of a 64x36 thumbnail, the editor->recorded-page switch
// changes 17.5 %, so the threshold has a wide margin on both sides.
const LIVE_GATE_W = 64;
const LIVE_GATE_H = 36;
const LIVE_GATE_PIXEL_DELTA = 24;
const LIVE_GATE_CHANGED_FRACTION = 0.08;
// A picture queued during the tab-switch stall is delivered ~1 s late: its
// arrival lag exceeds the steady lag by the stall duration. It must never
// become timeline zero (it would put a 1 s jump cut at the start of the video).
const LIVE_GATE_STALE_LAG_MS = 300;
// Frames used to learn the steady capture lag before freshness is enforced.
const LIVE_GATE_LAG_SAMPLES = 5;
// The switch + Chromium's post-switch capture stall measured ~1.0 s; past this
// the recording must never keep waiting (a watchdog, not the normal path).
const LIVE_GATE_TIMEOUT_MS = 2500;

/**
 * How a captured picture relates to the live gate:
 *  - fresh:  a new picture delivered at the pipeline's steady lag;
 *  - stale:  a new picture that waited in the capture queue (switch stall);
 *  - ignore: not evidence of anything (bootstrap sample or a repeated frame).
 */
type FrameFreshness = 'fresh' | 'stale' | 'ignore';

export class ScreenCaptureEngine {
  private mediaStream: MediaStream | null = null;          // raw display-capture stream
  private recorderStream: MediaStream | null = null;       // pumped canvas stream (+audio)
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private chunkCount = 0;
  private isRecording = false;
  private frameDiffCanvas: HTMLCanvasElement | null = null;
  private frameDiffCtx: CanvasRenderingContext2D | null = null;
  private lastFrameData: Uint8ClampedArray | null = null;
  private frameDiffInterval: number | null = null;
  private detectorBusyMs = 0;
  private snapshotCount = 0;
  private snapshots: { timestamp: number; dataUrl: string }[] = [];
  /** QA-030: one reusable downscaled canvas for every documentation snapshot. */
  private snapshotCanvas: HTMLCanvasElement | null = null;
  private snapshotCtx: CanvasRenderingContext2D | null = null;
  /** Only one JPEG encode may run at a time: the canvas is shared. */
  private snapshotInFlight = false;
  private snapshotPending: Promise<void> | null = null;
  /** Wall-clock time of the last snapshot START (the encode is async). */
  private lastSnapshotAt = 0;
  private snapshotErrorReported = false;
  private recordingStartTime = 0;
  private recordingDurationMs = 0;
  private onStopHandler: ((blob: Blob | null) => void) | null = null;
  private lastBlob: Blob | null = null;
  private stopPromise: Promise<Blob | null> | null = null;
  private pendingWrites: Promise<void>[] = [];
  private lastTrackSettings: MediaTrackSettings | null = null;
  private capturedNativeCursor: CapturedNativeCursor = 'unknown';

  // --- Frame pump state -----------------------------------------------------
  private pumpCanvas: HTMLCanvasElement | null = null;
  private pumpCtx: CanvasRenderingContext2D | null = null;
  private pumpVideo: HTMLVideoElement | null = null;
  private pumpTrack: MediaStreamTrack | null = null;
  private pumpTimer: number | null = null;
  private pumpRaf: number | null = null;
  private pumpFrameCount = 0;
  private timelineOriginEpoch = 0;
  private firstFrameResolve: (() => void) | null = null;
  private firstFramePromise: Promise<void> | null = null;
  private pumpReader: ReadableStreamDefaultReader<any> | null = null;
  private pumpDriver: 'generator' | 'processor' | 'video-frame-callback' = 'video-frame-callback';
  private pumpLastFrame: (() => any) | null = null;
  private pumpReleaseLast: (() => void) | null = null;
  private pumpRepeatFrame: (() => void) | null = null;
  /** QA-040: emit the last REAL captured picture even if it predates live. */
  private pumpEmitCurrent: (() => boolean) | null = null;
  private pumpSourceFrames = 0;
  /** QA-041: frames already read when the recording timeline started. */
  private pumpLiveSourceFrames = 0;
  private sessionId = '';
  private releaseSessionLock: (() => void) | null = null;
  // QA-029: the recorder is armed but PAUSED until the recorded tab's HUD is
  // actually on screen. Nothing is sent to the encoder before that instant, so
  // the video starts with the first frame the user can see.
  private captureLive = false;
  /** performance.now() of the instant the recorder went live (QA-029/QA-036). */
  private captureLiveSince = 0;
  // QA-037: "the HUD is visible" is not "the recorded surface is on screen":
  // Chromium swaps the tab ~0.5 s later and then stalls the screen capture while
  // the capturing tab is backgrounded. The paused recorder therefore starts on
  // the first captured picture that differs from the pre-switch picture.
  private liveGateArmed = false;
  private liveGateRefThumb: Uint8ClampedArray | null = null;
  private liveGateCanvas: HTMLCanvasElement | null = null;
  private liveGateTimer: number | null = null;
  private liveGateOnLive: ((originEpochMs: number) => void) | null = null;
  /** Steady-state (arrival - frame timestamp) of the capture pipeline, in ms. */
  private captureLagBaseline: number | null = null;
  /** Bootstrap samples for the steady lag (see noteFrameLag). */
  private frameLagSamples: number[] = [];
  private liveGateStaleLogged = false;
  /** Excess of the last frame's arrival lag over the steady lag (ms). */
  private lastLagExcessMs = 0;
  private onTimelineOriginHandler: ((originEpochMs: number) => void) | null = null;

  constructor() {
    this.frameDiffCanvas = document.createElement('canvas');
    this.frameDiffCanvas.width = 160;
    this.frameDiffCanvas.height = 90;
    this.frameDiffCtx = this.frameDiffCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async start(options: RecorderOptions): Promise<MediaStream> {
    this.sessionId = options.sessionId || newSessionId();
    await initStorage(this.sessionId);
    // The lock tells a later editor that this session is alive; the browser
    // releases it if this page crashes, which makes the session recoverable.
    this.releaseSessionLock?.();
    this.releaseSessionLock = holdSessionLock(this.sessionId);
    this.chunkCount = 0;
    this.snapshots = [];
    this.snapshotInFlight = false;
    this.snapshotPending = null;
    this.lastSnapshotAt = 0;
    this.snapshotErrorReported = false;
    this.lastBlob = null;
    this.stopPromise = null;
    this.recordingDurationMs = 0;
    this.pumpFrameCount = 0;
    this.timelineOriginEpoch = 0;
    this.recordingStartTime = performance.now();
    this.onStopHandler = options.onStop || null;
    this.captureLive = false;
    this.captureLiveSince = 0;
    this.onTimelineOriginHandler = options.onTimelineOrigin || null;

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const screenW = (typeof window !== 'undefined' && window.screen && window.screen.width) ? window.screen.width : 1920;
    const screenH = (typeof window !== 'undefined' && window.screen && window.screen.height) ? window.screen.height : 1080;
    const idealW = Math.round(screenW * dpr);
    const idealH = Math.round(screenH * dpr);

    // Prompt user for display capture requesting highest capture resolution allowed.
    // Suppress the OS cursor with cursor: "never" so only our smooth vector cursor is rendered.
    const displayMediaOptions: DisplayMediaStreamOptions = {
      video: {
        frameRate: options.frameRate || 60,
        width: { ideal: idealW },
        height: { ideal: idealH },
        cursor: 'never' as any
      } as any,
      audio: false
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    } catch (err: any) {
      // Preserve cursor:"never" for the first retry. Only drop it as a last resort
      // when Chromium rejects the cursor constraint itself.
      if (err && (err.name === 'OverconstrainedError' || err.name === 'TypeError')) {
        try {
          this.mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        } catch (retryErr: any) {
          if (retryErr?.name !== 'OverconstrainedError' && retryErr?.name !== 'TypeError') {
            await finalizeVideo().catch(() => undefined);
            this.releaseSessionLock?.();
            this.releaseSessionLock = null;
            throw retryErr;
          }
          try {
            const fallbackOptions: DisplayMediaStreamOptions = {
              video: {
                frameRate: options.frameRate || 60,
                width: { ideal: idealW },
                height: { ideal: idealH }
              },
              audio: false
            };
            this.mediaStream = await navigator.mediaDevices.getDisplayMedia(fallbackOptions);
          } catch (fallbackErr) {
            await finalizeVideo().catch(() => undefined);
            this.releaseSessionLock?.();
            this.releaseSessionLock = null;
            throw fallbackErr;
          }
        }
      } else {
        // Nothing was recorded: the session is over before it started.
        await finalizeVideo().catch(() => undefined);
        this.releaseSessionLock?.();
        this.releaseSessionLock = null;
        throw err;
      }
    }
    const vTrack = this.mediaStream.getVideoTracks()[0];
    if (vTrack) {
      this.lastTrackSettings = vTrack.getSettings ? vTrack.getSettings() : null;
      const nativeCursor = (this.lastTrackSettings as any)?.cursor;
      this.capturedNativeCursor = nativeCursor === 'never' || nativeCursor === 'motion' || nativeCursor === 'always'
        ? nativeCursor
        : 'unknown';
      console.log('[SmoothStudio CaptureEngine] Capture track settings:', JSON.stringify(this.lastTrackSettings));
    }

    // Optional microphone capture (with timeout guard to prevent capture stall)
    if (options.includeMic) {
      try {
        let permState: PermissionState | 'unknown' = 'unknown';
        try {
          if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
            const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            permState = p.state;
          }
        } catch {
          // Permissions API query for microphone might throw in unsupported environments
          permState = 'unknown';
        }

        const micPromise = navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        if (permState === 'granted') {
          // Hardware hang timeout (4000ms) ONLY when permission is already granted
          const hangTimeoutPromise = new Promise<MediaStream>((_, reject) => {
            setTimeout(() => reject(new Error('Microphone hardware hang timeout (4000ms)')), 4000);
          });
          this.audioStream = await Promise.race([micPromise, hangTimeoutPromise]);
        } else {
          // Permission is 'prompt' or 'unknown': wait for user/system to resolve without short rejection
          this.audioStream = await micPromise;
        }
      } catch (err: any) {
        console.warn('[SmoothStudio] Microphone capture failed or denied:', err);
        this.audioStream = null;
        const msg = err?.name === 'NotAllowedError'
          ? 'Microphone permission denied by user. Video will be recorded without audio.'
          : (err?.message || 'Microphone not recorded');
        options.onMicWarning?.(msg);
      }
    }

    // Determine optimal supported WebM mime type based on actual presence of audio tracks
    // Display capture is requested with audio:false, so the only audio that can
    // be recorded is the microphone track. Decide the MIME type from it.
    const micTracks = this.audioStream ? this.audioStream.getAudioTracks() : [];
    const hasAudio = micTracks.length > 0;
    // VP8 first: Chromium's VP9 MediaRecorder encoder needs ~4.5 s before it
    // emits its first chunk on a low-spec machine (measured, M1-B01), so any
    // recording shorter than that contained no video at all. VP8 starts in
    // ~0.3 s and plays everywhere the editor and the exporters decode WebM.
    let mimeType = hasAudio ? 'video/webm; codecs=vp8,opus' : 'video/webm; codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = hasAudio ? 'video/webm; codecs=vp9,opus' : 'video/webm; codecs=vp9';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    // ---------------------------------------------------------------------
    // FRAME PUMP
    // Chromium only emits capture frames while the captured surface is
    // actually being composited. A static page (or a background window)
    // therefore starves MediaRecorder, which produced multi-second holes in
    // the recorded timeline and made the video timeline drift away from the
    // wall clock. We pump the capture into a canvas at a fixed rate and feed
    // MediaRecorder from the canvas so the encoder always receives frames
    // and the recorded timeline stays locked to wall-clock time.
    // ---------------------------------------------------------------------
    this.recorderStream = await this.startFramePump(this.mediaStream);

    // C1: the microphone track must be part of the stream MediaRecorder records.
    // Previously the mic was acquired but never attached, so no audio was recorded.
    for (const track of micTracks) {
      this.recorderStream.addTrack(track);
    }

    this.mediaRecorder = new MediaRecorder(this.recorderStream, {
      mimeType,
      // An explicit bitrate keeps Chromium's rate control stable. Leaving it
      // unset makes the encoder ramp up very slowly, which delays the first
      // keyframe by several seconds and loses the beginning of the recording.
      videoBitsPerSecond: this.computeCaptureBitrate()
    });

    this.pendingWrites = [];
    this.mediaRecorder.onstart = () => {
      console.log('[SmoothStudio CaptureEngine] MediaRecorder onstart fired, state:', this.mediaRecorder?.state);
    };
    this.mediaRecorder.onerror = (e) => {
      console.error('[SmoothStudio CaptureEngine] MediaRecorder error:', e);
    };
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunkCount++;
        const p = appendVideoChunk(e.data).then(() => {
          options.onChunkSaved?.(this.chunkCount);
        });
        this.pendingWrites.push(p);
      }
    };

    // If user stops sharing via browser chrome native bar
    const videoTrack = this.mediaStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onmute = () => console.log('[SmoothStudio CaptureEngine] videoTrack muted');
      videoTrack.onunmute = () => console.log('[SmoothStudio CaptureEngine] videoTrack unmuted');
      videoTrack.onended = () => {
        if (this.isRecording) {
          console.log('[SmoothStudio CaptureEngine] VideoTrack ended by user. Finalizing stop...');
          this.stop().catch((e) => console.error('[SmoothStudio] stop failed on videoTrack ended:', e));
        }
      };
    }

    // Start streaming chunks to disk every RECORDER_TIMESLICE_MS so a crash
    // never loses more than a quarter second of encoded video.
    this.mediaRecorder.start(RECORDER_TIMESLICE_MS);
    // QA-029: stay paused until the recorded tab's HUD is on screen. Chromium
    // excludes the paused span from the WebM timeline (measured with
    // tests/e2e/helpers/probe-pause.mjs: 1.5 s paused, 1.1 s of frames ->
    // last pts 1.103 s), so the recording begins at that visible frame instead
    // of ~0.5 s of editor screen before it.
    try {
      this.mediaRecorder.pause();
    } catch (err) {
      console.warn('[SmoothStudio CaptureEngine] Could not arm the recorder paused:', err);
    }
    this.isRecording = true;

    // Wait for the capture to deliver a real frame BEFORE reporting the session
    // as started. The frame is kept (not encoded) until resumeCapture().
    await this.waitForFirstFrame();
    console.log('[SmoothStudio CaptureEngine] Capture armed: waiting for the recorded tab HUD before the first encoded frame');

    return this.mediaStream;
  }

  private computeCaptureBitrate(): number {
    const w = this.lastTrackSettings?.width || 1920;
    const h = this.lastTrackSettings?.height || 1080;
    const pixels = w * h;
    if (pixels >= 3840 * 2160) return 24_000_000;
    if (pixels >= 2560 * 1440) return 16_000_000;
    if (pixels >= 1920 * 1080) return 10_000_000;
    if (pixels >= 1280 * 720) return 6_000_000;
    return 3_000_000;
  }

  // -----------------------------------------------------------------------
  // Frame pump: capture -> <video> -> <canvas> -> captureStream(0) -> recorder
  // -----------------------------------------------------------------------
  private async startFramePump(source: MediaStream): Promise<MediaStream> {
    // Freshness is learned per recording: the lag of the capture pipeline is
    // a property of this machine/run, not of the previous session.
    this.captureLagBaseline = null;
    this.frameLagSamples = [];
    // ZERO-COPY path first: hand the captured frames themselves to the
    // encoder. The canvas copy below costs a 1080p draw + readback per frame,
    // which on a low-spec machine slowed the CAPTURE itself to about half the
    // rate a plain recorder gets (M1-03: 15.9 vs 29.0 fps). Odd capture sizes
    // go through the canvas, which makes them even.
    {
      const t = source.getVideoTracks()[0];
      const st = (t && t.getSettings) ? t.getSettings() : ({} as MediaTrackSettings);
      if ((st.width || 0) > 0 && (st.height || 0) > 0 && st.width! % 2 === 0 && st.height! % 2 === 0) {
        const generated = this.startGeneratorPump(source, t);
        if (generated) return generated;
      }
    }

    const video = document.createElement('video');
    video.srcObject = source;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('data-smoothstudio-pump', 'true');
    video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    this.pumpVideo = video;

    // Never block on play(): some capture surfaces never resolve the promise.
    await Promise.race([
      video.play().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ]);
    if (video.readyState < 1) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('error', done, { once: true });
        setTimeout(done, 1500);
      });
    }

    const track = source.getVideoTracks()[0];
    const settings = (track && track.getSettings) ? track.getSettings() : ({} as MediaTrackSettings);
    // Even dimensions: H.264 (MP4 export) and most encoders require them.
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
    const width = even(video.videoWidth || settings.width || 1920);
    const height = even(video.videoHeight || settings.height || 1080);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      // No 2D context: fall back to the raw stream (no pump available).
      return source;
    }
    this.pumpCanvas = canvas;
    this.pumpCtx = ctx;

    const pumped = canvas.captureStream(0);
    const pumpTrack = pumped.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void });
    this.pumpTrack = pumpTrack;

    // Carry the microphone tracks into the pumped stream.
    source.getAudioTracks().forEach((t) => {
      try { pumped.addTrack(t); } catch {}
    });

    this.firstFramePromise = new Promise<void>((resolve) => {
      this.firstFrameResolve = resolve;
    });

    let lastPumpAt = 0;
    let lastSourceFrameAt = 0;
    let hasPicture = false;
    let lastDrawAt = 0;
    const emit = () => {
      // QA-029: no encoded frame before the HUD is on screen.
      if (!this.captureLive) return;
      pumpTrack.requestFrame?.();
      this.pumpFrameCount++;
    };
    // Re-sends the last REAL captured picture (static surface / final frame).
    // Nothing is ever sent before the first real captured frame: no invented
    // (black) picture. QA-036: a picture captured BEFORE the recorder went live
    // (the editor, or the page before its HUD was painted) is never repeated:
    // the recording must start with what is on screen at the live instant.
    this.pumpRepeatFrame = () => {
      if (!hasPicture || lastDrawAt < this.captureLiveSince - 16) return;
      try { emit(); } catch (err) { console.warn('[SmoothStudio CaptureEngine] Frame pump repeat failed:', err); }
    };
    // QA-040: the stop path can run before the live gate accepted a picture
    // (the captured surface never changed). The canvas still holds the last
    // REAL captured frame, which is what the screen showed; it is the honest
    // first picture of that recording.
    this.pumpEmitCurrent = () => {
      if (!hasPicture) return false;
      try { emit(); return true; } catch { return false; }
    };
    this.pumpSourceFrames = 0;
    this.pumpLiveSourceFrames = 0;
    const drawSource = (image: CanvasImageSource) => {
      this.pumpSourceFrames++;
      const now = performance.now();
      lastSourceFrameAt = now;
      if (now - lastPumpAt < PUMP_MIN_INTERVAL_MS - 2) return;
      lastPumpAt = now;
      try {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        hasPicture = true;
        lastDrawAt = now;
        this.firstFrameResolve?.();
        this.firstFrameResolve = null;
        // QA-037: the live gate looks at the picture itself (the canvas holds
        // the newest captured frame).
        if (!this.captureLive) this.liveGateAccepts(canvas);
        emit();
      } catch (err) {
        console.warn('[SmoothStudio CaptureEngine] Frame pump tick failed:', err);
      }
    };

    const Processor = (typeof window !== 'undefined') ? (window as any).MediaStreamTrackProcessor : undefined;
    if (Processor && track) {
      // PRIMARY DRIVER: read every captured frame straight from the track.
      // requestVideoFrameCallback on a <video> only fires while the editor tab
      // is RENDERED, so a background editor recorded at 2-7 fps (QA-008).
      // Reading the track does not depend on rendering.
      this.pumpDriver = 'processor';
      const processor = new Processor({ track });
      const reader = processor.readable.getReader();
      this.pumpReader = reader;
      (async () => {
        for (;;) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          try {
            if (this.pumpTrack) drawSource(frame);
          } finally {
            try { frame.close(); } catch {}
          }
        }
      })().catch((err) => console.warn('[SmoothStudio CaptureEngine] Frame reader ended:', err));
    } else {
      // FALLBACK DRIVER: one output frame per new frame of the <video>.
      this.pumpDriver = 'video-frame-callback';
      const onSourceFrame = () => {
        if (video.readyState >= 2 && video.videoWidth > 0) drawSource(video);
        scheduleSourceFrameCallback();
      };
      const scheduleSourceFrameCallback = () => {
        if (typeof (video as any).requestVideoFrameCallback === 'function') {
          (video as any).requestVideoFrameCallback(onSourceFrame);
        }
      };
      scheduleSourceFrameCallback();
    }
    console.log(`[SmoothStudio CaptureEngine] Frame pump driver: ${this.pumpDriver}, ${width}x${height}`);

    // SAFETY NET: if the captured surface stops delivering frames, re-send the
    // last real picture so the encoder timeline keeps moving.
    this.pumpTimer = window.setInterval(() => {
      if (!this.isRecording) return;
      if (performance.now() - lastSourceFrameAt > PUMP_SAFETY_INTERVAL_MS) {
        this.pumpRepeatFrame?.();
      }
    }, PUMP_SAFETY_INTERVAL_MS);

    return pumped;
  }

  /**
   * MediaStreamTrackProcessor -> MediaStreamTrackGenerator: every captured
   * VideoFrame goes to the encoder as is (no copy). One clone of the last real
   * frame is kept to hold a static picture and to end the video at the stop
   * instant. Returns null when the browser lacks either API.
   */
  private startGeneratorPump(source: MediaStream, track: MediaStreamTrack | undefined): MediaStream | null {
    const Processor = (typeof window !== 'undefined') ? (window as any).MediaStreamTrackProcessor : undefined;
    const Generator = (typeof window !== 'undefined') ? (window as any).MediaStreamTrackGenerator : undefined;
    const VF = (typeof window !== 'undefined') ? (window as any).VideoFrame : undefined;
    if (!Processor || !Generator || !VF || !track) return null;
    let generator: any;
    let writer: WritableStreamDefaultWriter<any>;
    let reader: ReadableStreamDefaultReader<any>;
    try {
      generator = new Generator({ kind: 'video' });
      writer = generator.writable.getWriter();
      reader = new Processor({ track }).readable.getReader();
    } catch (err) {
      console.warn('[SmoothStudio CaptureEngine] Zero-copy pump unavailable, using the canvas pump:', err);
      return null;
    }
    this.pumpDriver = 'generator';
    this.pumpReader = reader;
    this.pumpTrack = generator as MediaStreamTrack;
    const pumped = new MediaStream([generator]);
    source.getAudioTracks().forEach((t) => {
      try { pumped.addTrack(t); } catch {}
    });

    this.firstFramePromise = new Promise<void>((resolve) => { this.firstFrameResolve = resolve; });
    this.pumpSourceFrames = 0;
    this.pumpLiveSourceFrames = 0;
    let last: any = null;        // clone of the last REAL captured frame
    let lastAt = 0;              // performance.now() when it arrived
    let lastSourceFrameAt = 0;
    let writing: Promise<void> = Promise.resolve();
    const send = (frame: any, freshness: FrameFreshness, lagMs: number) => {
      // QA-029/QA-037: frames captured before the recorded surface is on
      // screen are read and kept as the "last picture" but never handed to the
      // encoder. The live gate starts the timeline on the first picture that
      // actually shows the switch and encodes that picture as frame one.
      if (!this.captureLive && !this.liveGateAccepts(frame, freshness)) {
        try { frame.close(); } catch {}
        return;
      }
      writing = writing.then(() => writer.write(frame)).catch(() => {
        try { frame.close(); } catch {}
      });
      this.pumpFrameCount++;
    };
    this.pumpLastFrame = () => last;
    // Re-sends the last real picture with a timestamp advanced by the real
    // elapsed time (the capture clock keeps running). Never invents a picture,
    // and (QA-036) never repeats a picture captured before the live instant.
    this.pumpRepeatFrame = () => {
      if (!last || lastAt < this.captureLiveSince - 16) return;
      try {
        const ts = last.timestamp + Math.round((performance.now() - lastAt) * 1000);
        // A repeat is not a new picture: it may never be the gate's reference
        // or its "live" frame.
        send(new VF(last, { timestamp: ts }), 'ignore', NaN);
      } catch (err) {
        console.warn('[SmoothStudio CaptureEngine] Frame pump repeat failed:', err);
      }
    };
    // QA-040: stop before the live gate accepted a picture. `last` is the last
    // REAL frame read from the capture track (never an invented one); emitting
    // it starts the timeline with what the screen actually showed.
    this.pumpEmitCurrent = () => {
      if (!last) return false;
      try {
        const ts = Number(last.timestamp) + Math.round((performance.now() - lastAt) * 1000);
        send(new VF(last, { timestamp: ts }), 'ignore', NaN);
        return true;
      } catch {
        return false;
      }
    };

    (async () => {
      for (;;) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        const arrival = performance.now();
        this.pumpSourceFrames++;
        lastSourceFrameAt = arrival;
        // QA-037: a picture that waited in the capture queue during the tab
        // switch arrives long after the instant it was captured. It must never
        // start the timeline (its content is older than video t=0 would claim).
        const lagMs = arrival - Number(frame.timestamp) / 1000;
        const freshness = this.noteFrameLag(lagMs);
        // A real captured frame arrived: the capture is alive. It is NOT
        // encoded until the live gate accepts it.
        this.firstFrameResolve?.();
        this.firstFrameResolve = null;
        if (!this.pumpTrack) { try { frame.close(); } catch {} continue; }
        try {
          const keep = frame.clone();
          if (last) { try { last.close(); } catch {} }
          last = keep;
          lastAt = arrival;
        } catch { /* keep the previous clone */ }
        send(frame, freshness, lagMs); // the generator takes ownership of the frame
      }
    })().catch((err) => console.warn('[SmoothStudio CaptureEngine] Frame reader ended:', err));
    this.pumpReleaseLast = () => {
      if (last) { try { last.close(); } catch {} }
      last = null;
    };
    console.log(`[SmoothStudio CaptureEngine] Frame pump driver: generator (zero-copy), ${track.getSettings?.().width}x${track.getSettings?.().height}`);

    this.pumpTimer = window.setInterval(() => {
      if (!this.isRecording) return;
      if (performance.now() - lastSourceFrameAt > PUMP_SAFETY_INTERVAL_MS) this.pumpRepeatFrame?.();
    }, PUMP_SAFETY_INTERVAL_MS);
    return pumped;
  }

  /** The most recent captured picture (for snapshots / frame-diff), or null. */
  private latestPicture(): { src: CanvasImageSource; w: number; h: number } | null {
    const f = this.pumpLastFrame?.();
    if (f) return { src: f, w: f.displayWidth || f.codedWidth, h: f.displayHeight || f.codedHeight };
    if (this.pumpCanvas) return { src: this.pumpCanvas, w: this.pumpCanvas.width, h: this.pumpCanvas.height };
    return null;
  }

  private waitForFirstFrame(): Promise<void> {
    if (!this.firstFramePromise) return Promise.resolve();
    // Never block the UI on the first frame: if the captured surface does not
    // render at all we still start the recording (the frame pump safety net
    // will deliver frames as soon as anything is available).
    return Promise.race([
      this.firstFramePromise,
      new Promise<void>((resolve) => setTimeout(resolve, FIRST_FRAME_TIMEOUT_MS))
    ]);
  }

  /**
   * QA-029: the recorder is armed PAUSED. QA-037: the HUD being "visible" is
   * not the instant the recorded surface is on screen, so this gate looks at
   * the captured picture itself: the paused recorder starts on the first frame
   * that differs from the picture taken just before the switch, and that frame
   * is encoded as the first picture of the video. Returns false when the
   * recorder is not armed.
   */
  public armLiveGate(onLive?: (originEpochMs: number) => void): boolean {
    if (!this.isRecording || !this.mediaRecorder || this.captureLive) return false;
    if (this.liveGateArmed) return true;
    this.liveGateArmed = true;
    this.liveGateOnLive = onLive || null;
    this.liveGateStaleLogged = false;
    // Reference: the last picture captured before the switch (the editor).
    const pic = this.latestPicture();
    this.liveGateRefThumb = pic ? this.thumbnail(pic.src) : null;
    this.liveGateTimer = window.setTimeout(() => {
      this.liveGateTimer = null;
      if (!this.isRecording || this.captureLive) return;
      // The screen never changed (or the capture never delivered it). Never
      // leave the user without a recording: start with the current picture.
      console.warn('[SmoothStudio CaptureEngine] Live gate timed out: the captured picture never changed.');
      this.resumeCapture(undefined, 'live gate timeout');
    }, LIVE_GATE_TIMEOUT_MS);
    console.log('[SmoothStudio CaptureEngine] Live gate armed: waiting for the captured picture to show the recorded surface');
    return true;
  }

  /** 64x36 thumbnail of a captured picture, used only to spot the screen switch. */
  private thumbnail(source: CanvasImageSource): Uint8ClampedArray | null {
    try {
      if (!this.liveGateCanvas) {
        const c = document.createElement('canvas');
        c.width = LIVE_GATE_W;
        c.height = LIVE_GATE_H;
        this.liveGateCanvas = c;
      }
      const ctx = this.liveGateCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0, LIVE_GATE_W, LIVE_GATE_H);
      return ctx.getImageData(0, 0, LIVE_GATE_W, LIVE_GATE_H).data;
    } catch {
      return null;
    }
  }

  /**
   * QA-037: true when the picture arrived as soon as this pipeline normally
   * delivers it. The steady lag is bootstrapped from the first few frames
   * (median, so one stale frame cannot poison it) and then follows fresh
   * measurements only. A frame that arrives more than
   * LIVE_GATE_STALE_LAG_MS after the steady lag waited in the capture queue
   * during the tab-switch stall and must not become the reference or live
   * frame. Frames without a usable timestamp keep the previous behaviour.
   */
  private noteFrameLag(lagMs: number): FrameFreshness {
    // The frame timestamp and performance.now() can use different epochs
    // (measured: -8.8e6 ms), so only the CHANGE relative to the baseline is
    // meaningful. A non-finite lag carries no information.
    if (!Number.isFinite(lagMs)) return 'fresh';
    if (this.captureLagBaseline === null) {
      this.lastLagExcessMs = 0;
      this.frameLagSamples.push(lagMs);
      if (this.frameLagSamples.length < LIVE_GATE_LAG_SAMPLES) return 'ignore';
      const sorted = [...this.frameLagSamples].sort((a, b) => a - b);
      this.captureLagBaseline = sorted[Math.floor(sorted.length / 2)];
      this.frameLagSamples = [];
      return 'fresh';
    }
    const excess = lagMs - this.captureLagBaseline;
    this.lastLagExcessMs = excess;
    if (excess > LIVE_GATE_STALE_LAG_MS) return 'stale';
    // Slow EMA: follows real drift, ignores the stall.
    this.captureLagBaseline += excess * 0.02;
    return 'fresh';
  }

  /** True when this picture proves the screen switched to the recorded surface. */
  private liveGateAccepts(picture: CanvasImageSource, freshness: FrameFreshness = 'fresh'): boolean {
    if (!this.liveGateArmed || this.captureLive) return false;
    // A stale picture is not evidence of the switch: it can show the recorded
    // page 1 s before it is actually on screen (measured, QA-037). Never let
    // it touch the reference, the origin or the encoder.
    if (freshness !== 'fresh') {
      if (freshness === 'stale' && !this.liveGateStaleLogged) {
        this.liveGateStaleLogged = true;
        console.warn(`[SmoothStudio CaptureEngine] Live gate ignored a stale captured frame: it arrived ${Math.round(this.lastLagExcessMs)}ms later than the steady capture lag.`);
      }
      return false;
    }
    const thumb = this.thumbnail(picture);
    if (!thumb) return false;
    if (!this.liveGateRefThumb) {
      this.liveGateRefThumb = thumb;
      return false;
    }
    const ref = this.liveGateRefThumb;
    let changed = 0;
    for (let i = 0; i < thumb.length; i += 4) {
      if (Math.abs(thumb[i] - ref[i]) > LIVE_GATE_PIXEL_DELTA ||
          Math.abs(thumb[i + 1] - ref[i + 1]) > LIVE_GATE_PIXEL_DELTA ||
          Math.abs(thumb[i + 2] - ref[i + 2]) > LIVE_GATE_PIXEL_DELTA) changed++;
    }
    const fraction = changed / (LIVE_GATE_W * LIVE_GATE_H);
    if (fraction < LIVE_GATE_CHANGED_FRACTION) return false;
    console.log(`[SmoothStudio CaptureEngine] Live gate: captured picture changed ${(fraction * 100).toFixed(1)}% (${Math.round(this.lastLagExcessMs)}ms over the steady capture lag)`);
    return this.resumeCapture(undefined, 'recorded surface on screen') !== null;
  }

  private clearLiveGate(): void {
    this.liveGateArmed = false;
    this.liveGateRefThumb = null;
    this.liveGateStaleLogged = false;
    if (this.liveGateTimer !== null) {
      clearTimeout(this.liveGateTimer);
      this.liveGateTimer = null;
    }
  }

  public resumeCapture(originEpochMs?: number, why?: string): number | null {
    if (!this.isRecording || !this.mediaRecorder || this.captureLive) return null;
    const origin = (typeof originEpochMs === 'number' && Number.isFinite(originEpochMs) && originEpochMs > 0)
      ? Math.round(originEpochMs)
      : Date.now();
    const onLive = this.liveGateOnLive;
    this.liveGateOnLive = null;
    this.clearLiveGate();
    this.captureLive = true;
    this.captureLiveSince = performance.now();
    // QA-041: "captured frames read" must describe the recording. Frames read
    // while the recorder was paused (the editor, the pre-switch picture) are
    // not part of it; the frame that triggered live is (-1).
    this.pumpLiveSourceFrames = Math.max(0, this.pumpSourceFrames - 1);
    this.timelineOriginEpoch = origin;
    try {
      if (this.mediaRecorder.state === 'paused') this.mediaRecorder.resume();
    } catch (err) {
      console.warn('[SmoothStudio CaptureEngine] Could not resume the recorder:', err);
    }
    // QA-036: do NOT re-send the last picture here. At this instant it can still
    // be the editor (the capture pipeline has not delivered the recorded tab's
    // first frame yet), which would put the wrong screen at video t=0 and make
    // the file longer than the wall clock. The next REAL frame after this point
    // is the first encoded picture.
    setSessionOrigin(origin);
    this.startFrameDiffDetector();
    console.log(`[SmoothStudio CaptureEngine] Recording live (${why || 'HUD on screen'}) at epoch ${origin} (${this.pumpFrameCount} encoded frames so far)`);
    this.onTimelineOriginHandler?.(origin);
    onLive?.(origin);
    return origin;
  }

  private stopFramePump() {
    this.clearLiveGate();
    this.captureLive = false;
    this.captureLiveSince = 0;
    if (this.pumpTimer !== null) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    if (this.pumpRaf !== null) {
      cancelAnimationFrame(this.pumpRaf);
      this.pumpRaf = null;
    }
    try {
      this.pumpReader?.cancel().catch(() => undefined);
    } catch {}
    this.pumpReader = null;
    this.pumpRepeatFrame = null;
    this.pumpEmitCurrent = null;
    this.pumpLastFrame = null;
    this.pumpReleaseLast?.();
    this.pumpReleaseLast = null;
    try {
      this.pumpTrack?.stop();
    } catch {}
    try {
      this.pumpVideo?.remove();
    } catch {}
    this.pumpTrack = null;
    this.pumpVideo = null;
  }

  // Frame-Diff Canvas Detector: compares 160x90 downscaled frames every 150ms
  // to detect visual transitions (modals opening, menus expanding) outside tab mode
  private startFrameDiffDetector() {
    if (!this.frameDiffCtx || !this.mediaStream) return;

    this.detectorBusyMs = 0;
    this.snapshotCount = 0;
    this.frameDiffInterval = window.setInterval(() => {
      if (!this.isRecording || !this.frameDiffCtx) return;
      const tickStart = performance.now();

      try {
        // The most recent REAL captured picture (no extra <video> decoder).
        const pic = this.latestPicture();
        if (!pic) return;
        this.frameDiffCtx.drawImage(pic.src, 0, 0, 160, 90);
        const currentData = this.frameDiffCtx.getImageData(0, 0, 160, 90).data;

        // QA-030: the last snapshot's capture time is tracked separately; the
        // data URL only appears after the async JPEG encode completes.
        const timeSinceLastSnap = this.lastSnapshotAt > 0
          ? Date.now() - this.lastSnapshotAt
          : Infinity;

        let transition = true;
        if (this.lastFrameData) {
          let diffSum = 0;
          let changedPixels = 0;
          for (let i = 0; i < currentData.length; i += 16) {
            const diff = Math.abs(currentData[i] - this.lastFrameData[i]);
            diffSum += diff;
            if (diff > 15) changedPixels++;
          }

          const avgDiff = diffSum / (currentData.length / 16);
          // A visible transition (>4 avg or >20 changed sampled pixels).
          transition = avgDiff > 4 || changedPixels > 20;
        }

        // QA-030: one snapshot at a time, and the transition/idle cadence is
        // decided by the policy module instead of an inline timer.
        if (shouldCaptureSnapshot({
          recording: this.isRecording,
          inFlight: this.snapshotInFlight,
          transition,
          sinceLastMs: timeSinceLastSnap
        })) {
          this.captureSnapshot();
        }

        this.lastFrameData = new Uint8ClampedArray(currentData);
      } catch (err) {
        // Video frame might be temporarily unavailable. QA-030: never swallow
        // the failure silently - surface it once per recording.
        this.reportSnapshotError(err);
      }
      this.detectorBusyMs += performance.now() - tickStart;
    }, 150);
  }

  private captureSnapshot() {
    if (!this.isRecording || this.snapshotInFlight) return;
    try {
      const pic = this.latestPicture();
      if (!pic || !pic.w || !pic.h) return;
      // QA-030: reuse ONE downscaled canvas and encode asynchronously. The old
      // path allocated a 1280 px canvas and ran a synchronous toDataURL JPEG on
      // the capture thread for every transition.
      const { width, height } = computeSnapshotSize(pic.w, pic.h);
      if (!this.snapshotCanvas) {
        this.snapshotCanvas = document.createElement('canvas');
        this.snapshotCtx = this.snapshotCanvas.getContext('2d');
      }
      if (!this.snapshotCanvas || !this.snapshotCtx) return;
      if (this.snapshotCanvas.width !== width || this.snapshotCanvas.height !== height) {
        this.snapshotCanvas.width = width;
        this.snapshotCanvas.height = height;
      }
      this.snapshotCtx.drawImage(pic.src, 0, 0, width, height);
      // Snapshot timestamps use the SAME origin as the telemetry timeline.
      const timestamp = this.timelineOriginEpoch > 0
        ? Math.round(Date.now() - this.timelineOriginEpoch)
        : Math.round(performance.now() - this.recordingStartTime);
      this.lastSnapshotAt = Date.now();
      this.snapshotInFlight = true;
      this.snapshotPending = this.encodeSnapshot(timestamp).finally(() => {
        this.snapshotInFlight = false;
        this.snapshotPending = null;
      });
    } catch (err) {
      this.reportSnapshotError(err);
    }
  }

  /** Async JPEG encode + data-URL read; never blocks the capture pump. */
  private encodeSnapshot(timestamp: number): Promise<void> {
    const canvas = this.snapshotCanvas;
    if (!canvas) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: any = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
      // A toBlob callback that never fires must not disable snapshots forever.
      timer = setTimeout(() => {
        this.reportSnapshotError(new Error('JPEG snapshot encoding timed out'));
        finish();
      }, SNAPSHOT_ENCODE_TIMEOUT_MS);
      try {
        canvas.toBlob((blob) => {
          if (settled) return;
          if (!blob) {
            this.reportSnapshotError(new Error('toBlob returned no JPEG data'));
            finish();
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            if (settled) return;
            try {
              const dataUrl = typeof reader.result === 'string' ? reader.result : '';
              if (!dataUrl) {
                this.reportSnapshotError(new Error('FileReader returned no data URL'));
              } else {
                this.snapshotCount++;
                this.snapshots.push({ timestamp, dataUrl });
                if (this.snapshots.length > MAX_SNAPSHOTS) {
                  this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
                }
              }
            } catch (err) {
              this.reportSnapshotError(err);
            }
            finish();
          };
          reader.onerror = () => {
            if (settled) return;
            this.reportSnapshotError(reader.error || new Error('FileReader failed'));
            finish();
          };
          reader.readAsDataURL(blob);
        }, 'image/jpeg', SNAPSHOT_JPEG_QUALITY);
      } catch (err) {
        this.reportSnapshotError(err);
        finish();
      }
    });
  }

  private reportSnapshotError(err: unknown) {
    if (this.snapshotErrorReported) return;
    this.snapshotErrorReported = true;
    const message = (err as Error)?.message || String(err);
    console.warn('[SmoothStudio CaptureEngine] Snapshot capture failed:', message);
    diagnosticChannel.reportDegradation({
      source: 'canvas',
      severity: 'warning',
      title: 'Snapshot capture degraded',
      message: 'Documentation screenshots could not be captured for this recording; the video itself is unaffected.',
      details: message
    });
  }

  public getSnapshots() {
    return this.snapshots;
  }

  public async stop(): Promise<Blob | null> {
    // If a stop operation is already in-flight, return the same promise
    if (this.stopPromise) {
      return this.stopPromise;
    }
    // If already stopped, return the cached finalized blob
    if (!this.isRecording) {
      return this.lastBlob;
    }

    this.stopPromise = (async () => {
      // QA-030: the last snapshot is encoded asynchronously; let it land before
      // the caller reads getSnapshots(), so the final state is never missing.
      try {
        await this.snapshotPending;
      } catch { /* the encode reports its own failure */ }
      return this._executeStop();
    })();
    return this.stopPromise;
  }

  private async _executeStop(): Promise<Blob | null> {
    // QA-040: a stop can arrive before the live gate accepted a picture (the
    // captured surface never changed, or the user stopped within the gate's
    // wait). The screen still shows a real picture: start the timeline on it
    // and give the encoder a moment to produce its first chunk instead of
    // failing the whole recording with "no video was captured".
    if (this.isRecording && !this.captureLive) {
      this.resumeCapture(Date.now(), 'stop before the live gate');
      if (this.pumpEmitCurrent?.()) {
        const deadline = performance.now() + 400;
        while (this.chunkCount === 0 && performance.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      console.log(`[SmoothStudio CaptureEngine] Stop before live: emitted the current real picture, ${this.chunkCount} chunk(s) so far`);
    }
    this.isRecording = false;
    console.log('[SmoothStudio CaptureEngine] Recorder stop begins at epoch', Date.now());
    this.recordingDurationMs = this.timelineOriginEpoch > 0
      ? Math.max(500, Math.round(Date.now() - this.timelineOriginEpoch))
      : Math.max(500, Math.round(performance.now() - this.recordingStartTime));

    if (this.frameDiffInterval) {
      clearInterval(this.frameDiffInterval);
      this.frameDiffInterval = null;
    }

    // Stop the recorder. NOTE: MediaRecorder.requestData() is deliberately NOT
    // used. Calling requestData() before the encoder has emitted its first
    // output makes Chromium dispatch *empty* dataavailable events and discard
    // the already-encoded video, which resulted in "0 chunks recorded".
    // The recording ends NOW: hand the encoder the current picture once more so
    // the video track lasts until the stop instant (and ends with the audio).
    this.pumpRepeatFrame?.();
    await new Promise((r) => setTimeout(r, 40));

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const recorder = this.mediaRecorder;
        if (!recorder) {
          done();
          return;
        }
        recorder.onstop = done;
        recorder.onerror = done;
        try {
          recorder.stop();
        } catch {
          done();
        }
        // Safety net: never hang the UI if Chromium never fires 'stop'.
        setTimeout(done, 5000);
      });
    }

    // QA-029: bring the editor forward only AFTER the encoder has stopped. The
    // service worker used to activate this tab the moment the stop was
    // requested; Chromium then composited the tab switch into the recording
    // (one neutral-grey frame, measured uniform rgb 56,57,57, plus post-stop
    // editor frames). The encoder is closed now, so the switch cannot reach the
    // video. The screen recording of every stop path ends at the stop instant.
    if (typeof chrome !== 'undefined' && chrome.tabs?.getCurrent && chrome.tabs?.update) {
      try {
        chrome.tabs.getCurrent((tab) => {
          if (tab?.id !== undefined) chrome.tabs.update(tab.id!, { active: true });
        });
      } catch { /* the editor is already in front or the tab is gone */ }
    }

    console.log(`[SmoothStudio CaptureEngine] Frame pump (${this.pumpDriver}): ${Math.max(0, this.pumpSourceFrames - this.pumpLiveSourceFrames)} captured frames read, ${this.pumpFrameCount} frames sent to the encoder in ${this.recordingDurationMs}ms; snapshots ${this.snapshotCount}, detector busy ${Math.round(this.detectorBusyMs)}ms`);
    this.stopFramePump();

    if (this.pendingWrites.length > 0) {
      await Promise.allSettled(this.pendingWrites);
      this.pendingWrites = [];
    }

    // Stop all media tracks safely
    this.mediaStream?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
    this.audioStream?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });

    await finalizeVideo();
    console.log(`[SmoothStudio CaptureEngine] Recording finished in ${this.recordingDurationMs}ms and saved. Total chunks: ${this.chunkCount}`);

    const rawBlob = await getRecordingBlob();
    console.log(`[SmoothStudio CaptureEngine] getRecordingBlob returned:`, rawBlob ? `size=${rawBlob.size}` : 'null');

    if (!rawBlob || rawBlob.size === 0) {
      const reason = `Recording failed: no video was captured. The display capture stream produced 0 encoded frames in ${this.recordingDurationMs}ms.`;
      console.error('[SmoothStudio CaptureEngine] ' + reason);
      this.lastBlob = null;
      this.releaseSessionLock?.();
      this.releaseSessionLock = null;
      if (this.onStopHandler) {
        try {
          this.onStopHandler(null);
        } catch (err) {
          console.error('[SmoothStudio] onStopHandler error:', err);
        }
      }
      this.stopPromise = null;
      throw new Error(reason);
    }

    let blob: Blob = rawBlob;
    if (this.recordingDurationMs > 0) {
      try {
        const patched = await patchWebmBlobDuration(rawBlob, this.recordingDurationMs);
        if (patched && patched.size > 0) blob = patched;
      } catch (err) {
        console.warn('[SmoothStudio CaptureEngine] Failed to patch WebM duration:', err);
      }
    }
    // Always commit: the file becomes THE recording of this session, even when
    // the duration patch failed.
    try {
      await commitRecording(blob, this.sessionId);
    } catch (err) {
      console.error('[SmoothStudio CaptureEngine] Could not commit the recording:', err);
    }
    this.releaseSessionLock?.();
    this.releaseSessionLock = null;
    this.lastBlob = blob;

    if (this.onStopHandler) {
      try {
        this.onStopHandler(blob);
      } catch (err) {
        console.error('[SmoothStudio] onStopHandler error:', err);
      }
    }

    this.stopPromise = null;
    return blob;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getLastBlob(): Blob | null {
    return this.lastBlob;
  }

  public getTrackSettings(): MediaTrackSettings | null {
    return this.lastTrackSettings;
  }

  public getCapturedNativeCursor(): CapturedNativeCursor {
    return this.capturedNativeCursor;
  }

  public getDurationMs(): number {
    return this.recordingDurationMs;
  }

  /** Wall-clock epoch (Date.now) of the first captured video frame. */
  public getTimelineOriginEpoch(): number {
    return this.timelineOriginEpoch;
  }

  /** Number of frames handed to the encoder by the frame pump. */
  public getPumpFrameCount(): number {
    return this.pumpFrameCount;
  }

  public getActiveStream(): MediaStream | null {
    return this.mediaStream;
  }

  public getStatus(): boolean {
    return this.isRecording;
  }
}

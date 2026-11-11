import { initStorage, appendVideoChunk, finalizeVideo, getRecordingBlob, overwriteRecordingBlob } from './opfs-storage';
import { patchWebmBlobDuration } from './webm-fixer';

/**
 * Recording failure reasons surfaced to the user.
 * The recorder NEVER fabricates a video: if the encoder produced no chunks we
 * fail loudly instead of synthesising a picture-only "recording".
 */
export const RECORDING_FAILURE_NO_VIDEO = 'RECORDING_FAILED_NO_VIDEO';

export interface RecorderOptions {
  includeMic: boolean;
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

const PUMP_INTERVAL_MS = 16;          // ~60 fps frame pump
const RECORDER_TIMESLICE_MS = 250;    // flush encoded data to storage 4x/second
const MAX_SNAPSHOTS = 160;

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
  private snapshots: { timestamp: number; dataUrl: string }[] = [];
  private recordingStartTime = 0;
  private recordingDurationMs = 0;
  private onStopHandler: ((blob: Blob | null) => void) | null = null;
  private lastBlob: Blob | null = null;
  private stopPromise: Promise<Blob | null> | null = null;
  private pendingWrites: Promise<void>[] = [];
  private lastTrackSettings: MediaTrackSettings | null = null;

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

  constructor() {
    this.frameDiffCanvas = document.createElement('canvas');
    this.frameDiffCanvas.width = 160;
    this.frameDiffCanvas.height = 90;
    this.frameDiffCtx = this.frameDiffCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async start(options: RecorderOptions): Promise<MediaStream> {
    await initStorage();
    this.chunkCount = 0;
    this.snapshots = [];
    this.lastBlob = null;
    this.stopPromise = null;
    this.recordingDurationMs = 0;
    this.pumpFrameCount = 0;
    this.timelineOriginEpoch = 0;
    this.recordingStartTime = performance.now();
    this.onStopHandler = options.onStop || null;

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const screenW = (typeof window !== 'undefined' && window.screen && window.screen.width) ? window.screen.width : 1920;
    const screenH = (typeof window !== 'undefined' && window.screen && window.screen.height) ? window.screen.height : 1080;
    const idealW = Math.round(screenW * dpr);
    const idealH = Math.round(screenH * dpr);

    // Prompt user for display capture requesting highest capture resolution allowed
    const displayMediaOptions: DisplayMediaStreamOptions = {
      video: {
        frameRate: options.frameRate || 60,
        width: { ideal: idealW },
        height: { ideal: idealH }
      },
      audio: false
    };

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    const vTrack = this.mediaStream.getVideoTracks()[0];
    if (vTrack) {
      this.lastTrackSettings = vTrack.getSettings ? vTrack.getSettings() : null;
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
    const hasAudio = this.mediaStream.getAudioTracks().length > 0;
    let mimeType = hasAudio ? 'video/webm; codecs=vp9,opus' : 'video/webm; codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = hasAudio ? 'video/webm; codecs=vp8,opus' : 'video/webm; codecs=vp8';
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

    this.mediaRecorder = new MediaRecorder(this.recorderStream, {
      mimeType
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
    this.isRecording = true;

    // Wait for the very first pumped frame: that frame defines timeline zero.
    await this.waitForFirstFrame();
    console.log(`[SmoothStudio CaptureEngine] Timeline origin established at epoch ${this.timelineOriginEpoch} (pump frames: ${this.pumpFrameCount})`);
    options.onTimelineOrigin?.(this.timelineOriginEpoch);

    // Start fallback frame-diff detector for Window / Fullscreen mode
    this.startFrameDiffDetector();

    return this.mediaStream;
  }

  // -----------------------------------------------------------------------
  // Frame pump: capture -> <video> -> <canvas> -> captureStream(0) -> recorder
  // -----------------------------------------------------------------------
  private async startFramePump(source: MediaStream): Promise<MediaStream> {
    const video = document.createElement('video');
    video.srcObject = source;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('data-smoothstudio-pump', 'true');
    video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    this.pumpVideo = video;

    await video.play().catch(() => {});
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
    const width = video.videoWidth || settings.width || 1920;
    const height = video.videoHeight || settings.height || 1080;

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
    const tick = () => {
      if (!this.isRecording && this.pumpFrameCount > 0) return;
      const now = performance.now();
      // Both the interval driver and the rAF driver call tick(); cap the
      // combined rate so the encoder never sees more than ~60 fps.
      if (now - lastPumpAt < PUMP_INTERVAL_MS - 2) return;
      lastPumpAt = now;
      try {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } else if (this.pumpFrameCount === 0) {
          // Nothing decoded yet: paint a neutral frame so the encoder still
          // receives a valid image rather than an empty canvas.
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        pumpTrack.requestFrame?.();
        this.pumpFrameCount++;
        if (this.pumpFrameCount === 1) {
          this.timelineOriginEpoch = Date.now();
          this.firstFrameResolve?.();
          this.firstFrameResolve = null;
        }
      } catch (err) {
        console.warn('[SmoothStudio CaptureEngine] Frame pump tick failed:', err);
      }
    };

    // A fixed-interval timer keeps the pump alive even when the page is not
    // rendering (background tab / unfocused window), which is exactly when
    // Chromium stops delivering capture frames.
    this.pumpTimer = window.setInterval(tick, PUMP_INTERVAL_MS);
    // requestAnimationFrame as a secondary driver (runs while the page renders).
    const rafTick = () => {
      if (!this.isRecording) return;
      tick();
      this.pumpRaf = requestAnimationFrame(rafTick);
    };
    this.pumpRaf = requestAnimationFrame(rafTick);

    return pumped;
  }

  private waitForFirstFrame(): Promise<void> {
    if (this.firstFramePromise) return this.firstFramePromise;
    return Promise.resolve();
  }

  private stopFramePump() {
    if (this.pumpTimer !== null) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    if (this.pumpRaf !== null) {
      cancelAnimationFrame(this.pumpRaf);
      this.pumpRaf = null;
    }
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

    const video = this.pumpVideo || document.createElement('video');
    if (!this.pumpVideo) {
      video.srcObject = this.mediaStream;
      video.muted = true;
      video.play().catch(() => {});
    }

    this.frameDiffInterval = window.setInterval(() => {
      if (!this.isRecording || !this.frameDiffCtx) return;

      try {
        if (this.pumpCanvas && this.pumpCtx) {
          // Use the already-pumped frame: it is guaranteed to hold the most
          // recent capture even when the source stopped producing frames.
          this.frameDiffCtx.drawImage(this.pumpCanvas, 0, 0, 160, 90);
        } else {
          if (video.videoWidth === 0 || video.readyState < 2) return;
          this.frameDiffCtx.drawImage(video, 0, 0, 160, 90);
        }
        const currentData = this.frameDiffCtx.getImageData(0, 0, 160, 90).data;

        const now = performance.now();
        const timeSinceLastSnap = this.snapshots.length > 0
          ? (Date.now() - this.timelineOriginEpoch - this.snapshots[this.snapshots.length - 1].timestamp)
          : Infinity;

        if (this.lastFrameData) {
          let diffSum = 0;
          let changedPixels = 0;
          for (let i = 0; i < currentData.length; i += 16) {
            const diff = Math.abs(currentData[i] - this.lastFrameData[i]);
            diffSum += diff;
            if (diff > 15) changedPixels++;
          }

          const avgDiff = diffSum / (currentData.length / 16);
          // If a visual transition occurred (>4 avg or >20 changed sampled pixels) or periodic cadence reached
          if (avgDiff > 4 || changedPixels > 20 || timeSinceLastSnap >= 1800) {
            this.captureSnapshot();
          }
        } else {
          // Capture initial reference frame
          this.captureSnapshot();
        }

        this.lastFrameData = new Uint8ClampedArray(currentData);
      } catch {
        // Video frame might be temporarily unavailable
      }
    }, 150);
  }

  private captureSnapshot() {
    try {
      if (!this.pumpCanvas) return;
      // Keep the documentation screenshot reasonably small: 1280px wide JPEG.
      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / this.pumpCanvas.width);
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = Math.max(1, Math.round(this.pumpCanvas.width * scale));
      snapCanvas.height = Math.max(1, Math.round(this.pumpCanvas.height * scale));
      const ctx = snapCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(this.pumpCanvas, 0, 0, snapCanvas.width, snapCanvas.height);
      const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.62);
      this.snapshots.push({
        // Snapshot timestamps use the SAME origin as the telemetry timeline.
        timestamp: this.timelineOriginEpoch > 0
          ? Math.round(Date.now() - this.timelineOriginEpoch)
          : Math.round(performance.now() - this.recordingStartTime),
        dataUrl
      });
      if (this.snapshots.length > MAX_SNAPSHOTS) {
        this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
      }
    } catch {
      // Ignore snapshot error
    }
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

    this.stopPromise = this._executeStop();
    return this.stopPromise;
  }

  private async _executeStop(): Promise<Blob | null> {
    this.isRecording = false;
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

    // Keep pumping for a moment so the encoder receives the final frames,
    // then tear the pump down.
    await new Promise((r) => setTimeout(r, 60));
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

    let blob = rawBlob;
    if (this.recordingDurationMs > 0) {
      try {
        blob = await patchWebmBlobDuration(rawBlob, this.recordingDurationMs);
        if (blob && blob.size > 0) {
          await overwriteRecordingBlob(blob);
        }
      } catch (err) {
        console.warn('[SmoothStudio CaptureEngine] Failed to patch WebM duration:', err);
      }
    }
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

  public getLastBlob(): Blob | null {
    return this.lastBlob;
  }

  public getTrackSettings(): MediaTrackSettings | null {
    return this.lastTrackSettings;
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

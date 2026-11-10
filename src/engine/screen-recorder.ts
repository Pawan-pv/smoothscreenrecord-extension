import { initStorage, appendVideoChunk, finalizeVideo, getRecordingBlob } from './opfs-storage';

export interface RecorderOptions {
  includeMic: boolean;
  frameRate?: number;
  onChunkSaved?: (chunkIndex: number) => void;
  onStop?: (blob: Blob | null) => void;
}

export class ScreenCaptureEngine {
  private mediaStream: MediaStream | null = null;
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
    this.recordingStartTime = performance.now();
    this.onStopHandler = options.onStop || null;

    // Prompt user for display capture with native cursor removed
    const displayMediaOptions: DisplayMediaStreamOptions = {
      video: {
        frameRate: options.frameRate || 60,
        // Remove OS cursor so we can render our smooth vector cursor with motion blur
        // @ts-expect-error cursor option is supported in modern Chromium
        cursor: 'never'
      },
      audio: true
    };

    this.mediaStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

    // Optional microphone capture
    if (options.includeMic) {
      try {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        // Mix mic audio track into the mediaStream
        this.audioStream.getAudioTracks().forEach((track) => {
          this.mediaStream?.addTrack(track);
        });
      } catch (err) {
        console.warn('[SmoothStudio] Microphone permission denied or unavailable:', err);
      }
    }

    // Determine optimal supported WebM mime type
    let mimeType = 'video/webm; codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm; codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }

    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType,
      videoBitsPerSecond: 16_000_000 // 16 Mbps for high fidelity 1080p/4K
    });

    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        this.chunkCount++;
        await appendVideoChunk(e.data);
        options.onChunkSaved?.(this.chunkCount);
      }
    };

    // If user stops sharing via browser chrome native bar
    const videoTrack = this.mediaStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        if (this.isRecording) {
          console.log('[SmoothStudio CaptureEngine] VideoTrack ended by user. Finalizing stop...');
          this.stop().catch((e) => console.error('[SmoothStudio] stop failed on videoTrack ended:', e));
        }
      };
    }

    // Start streaming chunks to disk every 1000ms
    this.mediaRecorder.start(1000);
    this.isRecording = true;

    // Start fallback frame-diff detector for Window / Fullscreen mode
    this.startFrameDiffDetector();

    return this.mediaStream;
  }

  // Frame-Diff Canvas Detector: compares 160x90 downscaled frames every 150ms
  // to detect visual transitions (modals opening, menus expanding) outside tab mode
  private startFrameDiffDetector() {
    if (!this.frameDiffCtx || !this.mediaStream) return;

    const video = document.createElement('video');
    video.srcObject = this.mediaStream;
    video.muted = true;
    video.play().catch(() => {});

    this.frameDiffInterval = window.setInterval(() => {
      if (!this.isRecording || !this.frameDiffCtx) return;

      try {
        this.frameDiffCtx.drawImage(video, 0, 0, 160, 90);
        const currentData = this.frameDiffCtx.getImageData(0, 0, 160, 90).data;

        if (this.lastFrameData) {
          let diffSum = 0;
          for (let i = 0; i < currentData.length; i += 16) {
            diffSum += Math.abs(currentData[i] - this.lastFrameData[i]);
          }

          const avgDiff = diffSum / (currentData.length / 16);
          // If a major visual change occurred (> 25 average channel shift)
          if (avgDiff > 25) {
            this.captureSnapshot(video);
          }
        }

        this.lastFrameData = new Uint8ClampedArray(currentData);
      } catch {
        // Video frame might be temporarily unavailable
      }
    }, 150);
  }

  private captureSnapshot(videoEl: HTMLVideoElement) {
    try {
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = videoEl.videoWidth || 1920;
      snapCanvas.height = videoEl.videoHeight || 1080;
      const ctx = snapCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0);
        const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.85);
        this.snapshots.push({
          timestamp: Math.round(performance.now() - this.recordingStartTime),
          dataUrl
        });
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
    this.recordingDurationMs = Math.max(500, Math.round(performance.now() - this.recordingStartTime));

    if (this.frameDiffInterval) {
      clearInterval(this.frameDiffInterval);
      this.frameDiffInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        if (!this.mediaRecorder) return resolve();
        this.mediaRecorder.onstop = () => resolve();
        try {
          this.mediaRecorder.stop();
        } catch {
          resolve();
        }
      });
    }

    // Stop all media tracks safely
    this.mediaStream?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
    this.audioStream?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });

    await finalizeVideo();
    console.log(`[SmoothStudio CaptureEngine] Recording finished in ${this.recordingDurationMs}ms and saved.`);

    const blob = await getRecordingBlob();
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

  public getDurationMs(): number {
    return this.recordingDurationMs;
  }

  public getActiveStream(): MediaStream | null {
    return this.mediaStream;
  }

  public getStatus(): boolean {
    return this.isRecording;
  }
}

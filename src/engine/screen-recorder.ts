import { initStorage, appendVideoChunk, finalizeVideo, saveTelemetry } from './opfs-storage';
import { TelemetryData, ClickEvent } from '../types/telemetry';

export interface RecorderOptions {
  includeMic: boolean;
  frameRate?: number;
  onChunkSaved?: (chunkIndex: number) => void;
  onStop?: () => void;
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
  private onStopHandler: (() => void) | null = null;

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
    this.onStopHandler = options.onStop || null;

    // Prompt user for display capture with native cursor removed
    const displayMediaOptions: DisplayMediaStreamOptions = {
      video: {
        displaySurface: 'browser',
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

    // If user stops sharing via browser chrome bar
    const videoTrack = this.mediaStream.getVideoTracks()[0];
    videoTrack.onended = () => {
      if (this.isRecording) {
        this.stop();
      }
    };

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
    video.play();

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
          timestamp: performance.now(),
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

  public async stop(): Promise<void> {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.frameDiffInterval) {
      clearInterval(this.frameDiffInterval);
      this.frameDiffInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        if (!this.mediaRecorder) return resolve();
        this.mediaRecorder.onstop = () => resolve();
        this.mediaRecorder.stop();
      });
    }

    // Stop all media tracks
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.audioStream?.getTracks().forEach((track) => track.stop());

    await finalizeVideo();
    console.log('[SmoothStudio CaptureEngine] Recording finished and saved.');

    if (this.onStopHandler) {
      try {
        this.onStopHandler();
      } catch (err) {
        console.error('[SmoothStudio] onStopHandler error:', err);
      }
    }
  }

  public getActiveStream(): MediaStream | null {
    return this.mediaStream;
  }

  public getStatus(): boolean {
    return this.isRecording;
  }
}

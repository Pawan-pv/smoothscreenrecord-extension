import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  AspectRatioType,
  VibePreset,
  ZoomPill,
  KeystrokeEvent,
  SilenceSegment,
  CaptionBlock,
  CaptionStyle,
  CursorTheme
} from '../types/telemetry';
import { StudioRenderer, getAspectDimensions } from './renderer';
import { computeCinematicCameraState, SpringCameraSolver } from './spring-physics';
import { CursorSplineEngine } from './cursor-spline';

export interface ExportOptions {
  videoSource: HTMLVideoElement | HTMLCanvasElement;
  videoBlob?: Blob | null;
  onRenderCanvasFrame?: (timeMs: number) => void;
  durationMs: number;
  aspectRatio: AspectRatioType;
  preset: VibePreset;
  pills: ZoomPill[];
  silences: SilenceSegment[];
  cursorEngine: CursorSplineEngine;
  keystrokes: KeystrokeEvent[];
  cutSilences: boolean;
  showSpotlight: boolean;
  showCursor: boolean;
  showHud: boolean;
  metadata?: { width: number; height: number };
  cursorTheme?: CursorTheme;
  cursorScale?: number;
  captions?: CaptionBlock[];
  captionStyle?: CaptionStyle;
  showCaptions?: boolean;
  showIntroCard?: boolean;
  introHeadline?: string;
  introSubheadline?: string;
  onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
}

export class HardwareMp4Exporter {
  private renderer: StudioRenderer;

  constructor() {
    this.renderer = new StudioRenderer();
  }

  public async exportMp4(options: ExportOptions): Promise<Blob> {
    const {
      videoSource,
      videoBlob,
      onRenderCanvasFrame,
      durationMs,
      aspectRatio,
      preset,
      pills,
      silences,
      cursorEngine,
      keystrokes,
      cutSilences,
      showSpotlight,
      showCursor,
      showHud,
      onProgress
    } = options;

    const { width: outW, height: outH } = getAspectDimensions(aspectRatio, 1920);

    // Create offscreen export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = outW;
    exportCanvas.height = outH;

    const video = videoSource;

    const fps = 60;
    const frameIntervalMs = 1000 / fps;

    // Filter cut silences if requested
    const activeCutSilences = cutSilences ? silences.filter((s) => s.markedForCut) : [];

    // Build timeline frames to render (skipping cut silences)
    const timelineTimestamps: number[] = [];
    for (let t = 0; t <= durationMs; t += frameIntervalMs) {
      const isCut = activeCutSilences.some((s) => t >= s.startTime && t <= s.endTime);
      if (!isCut) {
        timelineTimestamps.push(t);
      }
    }

    const totalFrames = timelineTimestamps.length;
    console.log(`[SmoothStudio MP4 Exporter] Starting hardware export: ${totalFrames} frames at 60fps (${outW}x${outH})`);

    // Check if WebCodecs VideoEncoder is available
    const hasWebCodecs = typeof VideoEncoder !== 'undefined';

    if (hasWebCodecs) {
      try {
        return await this.exportWithWebCodecs({
          video,
          onRenderCanvasFrame,
          exportCanvas,
          outW,
          outH,
          fps,
          totalFrames,
          timelineTimestamps,
          pills,
          preset,
          aspectRatio,
          cursorEngine,
          keystrokes,
          showSpotlight,
          showCursor,
          showHud,
          metadata: options.metadata,
          cursorTheme: options.cursorTheme,
          cursorScale: options.cursorScale,
          captions: options.captions,
          captionStyle: options.captionStyle,
          showCaptions: options.showCaptions,
           showIntroCard: options.showIntroCard,
           introHeadline: options.introHeadline,
           introSubheadline: options.introSubheadline,
          onProgress
        });
      } catch (err) {
        console.warn('[SmoothStudio MP4 Exporter] WebCodecs hardware export failed, using media recorder fallback:', err);
      }
    }

    // Fallback exporter
    return await this.exportWithCanvasStream({
      video,
      onRenderCanvasFrame,
      exportCanvas,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata: options.metadata,
      cursorTheme: options.cursorTheme,
      cursorScale: options.cursorScale,
      captions: options.captions,
      captionStyle: options.captionStyle,
      showCaptions: options.showCaptions,
      showIntroCard: options.showIntroCard,
      introHeadline: options.introHeadline,
      introSubheadline: options.introSubheadline,
      onProgress
    });
  }

  private async exportWithWebCodecs(params: {
    video: HTMLVideoElement | HTMLCanvasElement;
    onRenderCanvasFrame?: (timeMs: number) => void;
    exportCanvas: HTMLCanvasElement;
    outW: number;
    outH: number;
    fps: number;
    totalFrames: number;
    timelineTimestamps: number[];
    pills: ZoomPill[];
    preset: VibePreset;
    aspectRatio: AspectRatioType;
    cursorEngine: CursorSplineEngine;
    keystrokes: KeystrokeEvent[];
    showSpotlight: boolean;
    showCursor: boolean;
    showHud: boolean;
    metadata?: { width: number; height: number };
    cursorTheme?: CursorTheme;
    cursorScale?: number;
    captions?: CaptionBlock[];
    captionStyle?: CaptionStyle;
    showCaptions?: boolean;
    showIntroCard?: boolean;
    introHeadline?: string;
    introSubheadline?: string;
    onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
  }): Promise<Blob> {
    const {
      video,
      onRenderCanvasFrame,
      exportCanvas,
      outW,
      outH,
      fps,
      totalFrames,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      onProgress
    } = params;

    let isFinalized = false;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: outW,
        height: outH
      },
      fastStart: 'in-memory'
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (!isFinalized) {
          try {
            muxer.addVideoChunk(chunk, meta);
          } catch {
            // Closed or finalized
          }
        }
      },
      error: (e) => console.error('[SmoothStudio VideoEncoder Error]', e)
    });

    // Configure H.264 hardware profile with low-latency direct GPU encoding
    videoEncoder.configure({
      codec: 'avc1.640028',
      width: outW,
      height: outH,
      bitrate: 14_000_000,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime'
    });

    const springCamera = new SpringCameraSolver();
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(
        timelineTimestamps[0],
        pills,
        cursorEngine.getCursorAt(timelineTimestamps[0]),
        metadata?.width || outW,
        metadata?.height || outH,
        true
      );
      springCamera.snapTo(firstTarget);
    }

    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      const cursor = cursorEngine.getCursorAt(currentMs);
      const targetCamera = computeCinematicCameraState(
        currentMs,
        pills,
        cursor,
        metadata?.width || outW,
        metadata?.height || outH,
        true
      );
      springCamera.setTarget(targetCamera);
      const camera = f === 0 ? targetCamera : springCamera.update(1 / fps);
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);

      // Seek video to frame timestamp or render canvas frame
      if (video instanceof HTMLVideoElement) {
        video.currentTime = currentMs / 1000;
        await new Promise<void>((r) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            r();
          };
          video.addEventListener('seeked', onSeeked, { once: true });
          if (Math.abs(video.currentTime - currentMs / 1000) < 0.01) {
            r();
          }
        });
      } else if (onRenderCanvasFrame) {
        onRenderCanvasFrame(currentMs);
      }

      // Render composite frame
      this.renderer.renderFrame({
        canvas: exportCanvas,
        video,
        currentTimeMs: currentMs,
        camera,
        activePill,
        cursorEngine,
        keystrokes,
        preset,
        aspectRatio,
        showSpotlight,
        showCursor,
        showHud,
        metadata,
        cursorTheme,
        cursorScale,
        captions,
        captionStyle,
        showCaptions,
        showIntroCard,
        introHeadline,
        introSubheadline
      });

      // Encode frame
      const frameTimestampMicroseconds = Math.round((f / fps) * 1_000_000);
      const videoFrame = new VideoFrame(exportCanvas, {
        timestamp: frameTimestampMicroseconds
      });

      const isKeyFrame = f % 120 === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Yield to the event loop and apply backpressure if encoder queue is filling
      if (videoEncoder.encodeQueueSize > 5) {
        while (videoEncoder.encodeQueueSize > 2) {
          await new Promise((r) => setTimeout(r, 4));
        }
      } else if (f % 10 === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }

      if (f % 15 === 0 && onProgress) {
        const percent = Math.round(((f + 1) / totalFrames) * 100);
        onProgress(percent, f + 1, totalFrames);
      }
    }

    if (onProgress) {
      onProgress(100, totalFrames, totalFrames);
    }

    // Drain remaining encoder queue before flushing
    let drainWait = 0;
    while (videoEncoder.encodeQueueSize > 0 && drainWait < 200) {
      await new Promise((r) => setTimeout(r, 10));
      drainWait++;
    }

    try {
      await Promise.race([
        videoEncoder.flush(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Flush timeout')), 5000))
      ]);
    } catch (flushErr) {
      console.warn('[SmoothStudio MP4 Exporter] Flush completed or notice:', flushErr);
    }

    isFinalized = true;
    muxer.finalize();
    try {
      videoEncoder.close();
    } catch {
      // Ignored if already closed
    }

    const buffer = muxer.target.buffer;
    const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
    console.log('[SmoothStudio MP4 Exporter] Hardware MP4 export completed! Size:', (mp4Blob.size / 1024 / 1024).toFixed(2), 'MB');
    return mp4Blob;
  }

  // Fallback using HTML5 Canvas captureStream + MediaRecorder
  private async exportWithCanvasStream(params: {
    video: HTMLVideoElement | HTMLCanvasElement;
    onRenderCanvasFrame?: (timeMs: number) => void;
    exportCanvas: HTMLCanvasElement;
    timelineTimestamps: number[];
    pills: ZoomPill[];
    preset: VibePreset;
    aspectRatio: AspectRatioType;
    cursorEngine: CursorSplineEngine;
    keystrokes: KeystrokeEvent[];
    showSpotlight: boolean;
    showCursor: boolean;
    showHud: boolean;
    metadata?: { width: number; height: number };
    cursorTheme?: CursorTheme;
    cursorScale?: number;
    captions?: CaptionBlock[];
    captionStyle?: CaptionStyle;
    showCaptions?: boolean;
    showIntroCard?: boolean;
    introHeadline?: string;
    introSubheadline?: string;
    onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
  }): Promise<Blob> {
    const {
      video,
      onRenderCanvasFrame,
      exportCanvas,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      onProgress
    } = params;

    const stream = exportCanvas.captureStream(60);
    const chunks: Blob[] = [];
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm; codecs=vp9') ? 'video/webm; codecs=vp9' : 'video/webm',
      videoBitsPerSecond: 12_000_000
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();

    const totalFrames = timelineTimestamps.length;
    const springCameraFallback = new SpringCameraSolver();
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(
        timelineTimestamps[0],
        pills,
        cursorEngine.getCursorAt(timelineTimestamps[0]),
        metadata?.width || exportCanvas.width,
        metadata?.height || exportCanvas.height,
        true
      );
      springCameraFallback.snapTo(firstTarget);
    }

    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      const cursor = cursorEngine.getCursorAt(currentMs);
      const targetCamera = computeCinematicCameraState(
        currentMs,
        pills,
        cursor,
        metadata?.width || exportCanvas.width,
        metadata?.height || exportCanvas.height,
        true
      );
      springCameraFallback.setTarget(targetCamera);
      const camera = f === 0 ? targetCamera : springCameraFallback.update(1 / 60);
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
      if (video instanceof HTMLVideoElement) {
        video.currentTime = currentMs / 1000;
      } else if (onRenderCanvasFrame) {
        onRenderCanvasFrame(currentMs);
      }

      this.renderer.renderFrame({
        canvas: exportCanvas,
        video,
        currentTimeMs: currentMs,
        camera,
        activePill,
        cursorEngine,
        keystrokes,
        preset,
        aspectRatio,
        showSpotlight,
        showCursor,
        showHud,
        metadata,
        cursorTheme,
        cursorScale,
        captions,
        captionStyle,
        showCaptions,
        showIntroCard,
        introHeadline,
        introSubheadline
      });

      if (f % 10 === 0) {
        await new Promise((r) => setTimeout(r, 2));
      }

      if (f % 15 === 0 && onProgress) {
        onProgress(Math.round(((f + 1) / totalFrames) * 100), f + 1, totalFrames);
      }
    }

    if (onProgress) {
      onProgress(100, totalFrames, totalFrames);
    }

    return new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        resolve(new Blob(chunks, { type: 'video/webm' }));
      };
      mediaRecorder.stop();
    });
  }

  // Trigger browser file download
  public static downloadBlob(blob: Blob, filename = 'SmoothStudio_Export.mp4') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }
}

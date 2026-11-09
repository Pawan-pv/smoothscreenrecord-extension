import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  AspectRatioType,
  VibePreset,
  ZoomPill,
  KeystrokeEvent,
  SilenceSegment
} from '../types/telemetry';
import { StudioRenderer, getAspectDimensions } from './renderer';
import { SpringCameraSolver, calculateIsometricTilt } from './spring-physics';
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
      onProgress
    } = params;

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
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('[SmoothStudio VideoEncoder Error]', e)
    });

    // Configure H.264 hardware profile
    videoEncoder.configure({
      codec: 'avc1.640028',
      width: outW,
      height: outH,
      bitrate: 14_000_000,
      framerate: fps
    });

    const cameraSolver = new SpringCameraSolver();

    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      // Update camera target based on zoom pills
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
      if (activePill) {
        cameraSolver.setTarget({
          x: activePill.targetX,
          y: activePill.targetY,
          scale: activePill.targetScale,
          tiltX: activePill.tiltX,
          tiltY: activePill.tiltY
        });
      } else {
        cameraSolver.setTarget({
          x: 0.5,
          y: 0.5,
          scale: 1.0,
          tiltX: 0,
          tiltY: 0
        });
      }

      const camera = cameraSolver.update(1 / fps);

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
        showHud
      });

      // Encode frame
      const frameTimestampMicroseconds = Math.round((f / fps) * 1_000_000);
      const videoFrame = new VideoFrame(exportCanvas, {
        timestamp: frameTimestampMicroseconds
      });

      const isKeyFrame = f % 120 === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Yield to the event loop so the hardware GPU encoder processes the queue
      if (videoEncoder.encodeQueueSize > 6 || f % 10 === 0) {
        await new Promise((r) => setTimeout(r, 2));
      }

      if (f % 15 === 0 && onProgress) {
        const percent = Math.round(((f + 1) / totalFrames) * 100);
        onProgress(percent, f + 1, totalFrames);
      }
    }

    if (onProgress) {
      onProgress(100, totalFrames, totalFrames);
    }

    await videoEncoder.flush();
    muxer.finalize();

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

    const cameraSolver = new SpringCameraSolver();
    const totalFrames = timelineTimestamps.length;

    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);

      if (activePill) {
        cameraSolver.setTarget({
          x: activePill.targetX,
          y: activePill.targetY,
          scale: activePill.targetScale,
          tiltX: activePill.tiltX,
          tiltY: activePill.tiltY
        });
      } else {
        cameraSolver.setTarget({ x: 0.5, y: 0.5, scale: 1.0, tiltX: 0, tiltY: 0 });
      }

      const camera = cameraSolver.update(1 / 60);
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
        showHud
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

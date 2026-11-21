import { GifWriter } from 'omggif';
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
import { SequentialVideoFrameSource } from './sequential-frame-source';
import {
  assertGifBufferHasRoom,
  gifFrameHeadroomBytes,
  planGifBufferBytes,
  resolveGifMaxDimension
} from './gif-budget';
import { clampTrimBounds } from './export-timeline';

export interface GifExportOptions {
  videoSource?: HTMLVideoElement | HTMLCanvasElement;
  /**
   * The recording itself. When present, frames are decoded sequentially with
   * WebCodecs instead of seeking the <video> element once per output frame
   * (QA-028: seeking re-decodes a whole GOP per frame and made long exports
   * quadratic). The <video> path stays as the fallback.
   */
  videoBlob?: Blob;
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
  captionBackdrop?: number;
  showCaptions?: boolean;
  showIntroCard?: boolean;
  introHeadline?: string;
  introSubheadline?: string;
  showOutroCard?: boolean;
  outroHeadline?: string;
  outroCtaText?: string;
  trimStartMs?: number;
  trimEndMs?: number;
  framePadding?: number;
  backgroundColor?: string | null;
  backgroundImage?: CanvasImageSource | null;
  qualityPreset?: GifQualityPreset;
  fps?: number; // defaults to 12fps (Compact preset) for optimal GIF size (<5MB)
  maxDimension?: number; // defaults to 640px (Compact preset)
  maxColors?: number; // defaults to 128 colors (Compact preset)
  enableDeduplication?: boolean; // defaults to true
  onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
}

export type GifQualityPreset = 'compact' | 'web' | 'high';

export interface GifPresetConfig {
  fps: number;
  maxDimension: number;
  maxColors: number;
  description: string;
}

export const GIF_QUALITY_PRESETS: Record<GifQualityPreset, GifPresetConfig> = {
  compact: {
    fps: 12,
    maxDimension: 640,
    maxColors: 128,
    description: 'Compact (<5 MB, 12fps, 640px)'
  },
  web: {
    fps: 15,
    maxDimension: 720,
    maxColors: 192,
    description: 'Web (15fps, 720px)'
  },
  high: {
    fps: 20,
    maxDimension: 840,
    maxColors: 256,
    description: 'High Quality (20fps, 840px)'
  }
};

// Fast adaptive RGB quantizer with palette extraction and variable color depth (e.g. 128 or 256 colors)
function quantizeFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors = 128
): { indexed: Uint8Array; palette: number[] } {
  const numPixels = width * height;
  const indexed = new Uint8Array(numPixels);

  // Build a frequency map of 15-bit quantized colors (5-5-5 RGB)
  const colorCounts = new Map<number, number>();
  const step = Math.max(1, Math.floor(numPixels / 8000));

  for (let i = 0; i < rgba.length; i += 4 * step) {
    const r = rgba[i] >> 3;
    const g = rgba[i + 1] >> 3;
    const b = rgba[i + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }

  // Sort by popularity and select top maxColors (clamped 2..256)
  const effectiveMaxColors = Math.min(256, Math.max(2, maxColors));
  const sorted = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, effectiveMaxColors);

  // Fallback if image has fewer colors
  const palette: number[] = [];
  const paletteMap = new Map<number, number>();

  sorted.forEach(([key], index) => {
    const r5 = (key >> 10) & 0x1f;
    const g5 = (key >> 5) & 0x1f;
    const b5 = key & 0x1f;
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);
    const hex = (r << 16) | (g << 8) | b;
    palette.push(hex);
    paletteMap.set(key, index);
  });

  // GIF color palette length must strictly be a power of 2 between 2 and 256 (2, 4, 8, 16, 32, 64, 128, 256)
  let targetPaletteLen = 2;
  while (targetPaletteLen < palette.length && targetPaletteLen < 256) {
    targetPaletteLen <<= 1;
  }
  while (palette.length < targetPaletteLen) {
    palette.push(0);
  }

  // Map each pixel to closest palette index
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const r5 = rgba[i] >> 3;
    const g5 = rgba[i + 1] >> 3;
    const b5 = rgba[i + 2] >> 3;
    const key = (r5 << 10) | (g5 << 5) | b5;

    let match = paletteMap.get(key);
    if (match === undefined) {
      // Find nearest euclidean color
      const pr = rgba[i];
      const pg = rgba[i + 1];
      const pb = rgba[i + 2];
      let minDist = Infinity;
      let bestIdx = 0;

      for (let c = 0; c < palette.length; c++) {
        const hex = palette[c];
        const cr = (hex >> 16) & 0xff;
        const cg = (hex >> 8) & 0xff;
        const cb = hex & 0xff;
        const dist = (pr - cr) * (pr - cr) + (pg - cg) * (pg - cg) + (pb - cb) * (pb - cb);
        if (dist < minDist) {
          minDist = dist;
          bestIdx = c;
          if (dist === 0) break;
        }
      }
      match = bestIdx;
      paletteMap.set(key, match);
    }

    indexed[p] = match;
  }

  return { indexed, palette };
}

// Frame similarity check for GIF frame deduplication.
// Compares RGB channels of adjacent frames; returns true if pixel differences are below threshold.
function areFramesSimilar(prev: Uint8ClampedArray, curr: Uint8ClampedArray, threshold = 0.002): boolean {
  if (prev.length !== curr.length) return false;
  let diffCount = 0;
  const maxDiff = Math.floor((prev.length / 4) * threshold);

  for (let i = 0; i < prev.length; i += 4) {
    const dr = Math.abs(prev[i] - curr[i]);
    const dg = Math.abs(prev[i + 1] - curr[i + 1]);
    const db = Math.abs(prev[i + 2] - curr[i + 2]);
    if (dr > 4 || dg > 4 || db > 4) {
      diffCount++;
      if (diffCount > maxDiff) return false;
    }
  }
  return true;
}

export class HardwareGifExporter {
  private renderer: StudioRenderer;

  constructor() {
    this.renderer = new StudioRenderer();
  }

  public async exportGif(options: GifExportOptions): Promise<Blob> {
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
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      captionBackdrop,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      showOutroCard,
      outroHeadline,
      outroCtaText,
      qualityPreset = 'compact',
      fps: explicitFps,
      maxDimension: explicitMaxDimension,
      maxColors: explicitMaxColors,
      enableDeduplication = true,
      onProgress
    } = options;

    const presetConfig = GIF_QUALITY_PRESETS[qualityPreset] || GIF_QUALITY_PRESETS.compact;
    const fps = explicitFps ?? presetConfig.fps;
    // QA-028: a caller must not be able to ask for a 4K GIF and OOM the tab.
    const maxDimension = resolveGifMaxDimension(explicitMaxDimension ?? presetConfig.maxDimension);
    const maxColors = explicitMaxColors ?? presetConfig.maxColors;

    const { width: fullW, height: fullH } = getAspectDimensions(aspectRatio, 1920);
    const scale = maxDimension / Math.max(fullW, fullH);
    const outW = Math.round(fullW * scale);
    const outH = Math.round(fullH * scale);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = fullW;
    exportCanvas.height = fullH;

    const downscaleCanvas = document.createElement('canvas');
    downscaleCanvas.width = outW;
    downscaleCanvas.height = outH;
    const downscaleCtx = downscaleCanvas.getContext('2d', { willReadFrequently: true })!;

    // Build timeline timestamps with trim bounds
    const { trimStartMs: effTrimStart, trimEndMs: effTrimEnd } = clampTrimBounds(
      durationMs,
      options.trimStartMs,
      options.trimEndMs
    );

    const frameIntervalMs = 1000 / fps;
    const timestamps: number[] = [];
    // When the Outro CTA card is enabled, clamp cut windows so the final 1.5s
    // (the outro animation) is never skipped in the exported GIF.
    const cutIntervals = cutSilences
      ? silences
          .filter((s) => s.markedForCut)
          .map((s) =>
            showOutroCard
              ? { ...s, endTime: Math.min(s.endTime, Math.max(s.startTime, effTrimEnd - 1500)) }
              : s
          )
          .filter((s) => s.endTime > s.startTime)
      : [];

    for (let t = effTrimStart; t <= effTrimEnd; t += frameIntervalMs) {
      const inCut = cutIntervals.some((c) => t >= c.startTime && t <= c.endTime);
      if (!inCut) {
        timestamps.push(t);
      }
    }

    const totalFrames = timestamps.length;
    // QA-028: bounded allocation. The estimate can be gigabytes for a long
    // 1080p clip; the buffer is capped and every frame checks for room before
    // it is written, so the export fails with a clear message instead of OOM.
    const buffer = new Uint8Array(planGifBufferBytes(outW, outH, totalFrames));
    const frameHeadroom = gifFrameHeadroomBytes(outW, outH);
    const gifWriter = new GifWriter(buffer, outW, outH, { loop: 0 });

    const delayHundredths = Math.max(2, Math.round(100 / fps));
    const springCamera = new SpringCameraSolver();
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(
        timestamps[0],
        pills,
        cursorEngine.getCursorAt(timestamps[0]),
        metadata?.width || fullW,
        metadata?.height || fullH,
        true
      );
      springCamera.snapTo(firstTarget);
    }

    // Frame deduplication state machine:
    // When adjacent frames are visual duplicates, accumulate their delay instead of encoding redundant frames.
    let pendingFrameData: Uint8ClampedArray | null = null;
    let pendingDelayHundredths = 0;
    let writtenFrames = 0;

    const flushPendingFrame = () => {
      if (!pendingFrameData) return;
      const { indexed, palette } = quantizeFrame(pendingFrameData, outW, outH, maxColors);
      assertGifBufferHasRoom(gifWriter.end(), buffer.length, frameHeadroom, writtenFrames);
      try {
        gifWriter.addFrame(0, 0, outW, outH, indexed as unknown as number[], {
          palette,
          delay: Math.min(65535, pendingDelayHundredths)
        });
      } catch (err) {
        throw new Error(
          `GIF export could not write frame ${writtenFrames}: ${(err as Error)?.message || err}`
        );
      }
      writtenFrames++;
      pendingFrameData = null;
      pendingDelayHundredths = 0;
    };

    // QA-028: decode the recording sequentially (the same path as the MP4
    // exporter) instead of seeking the <video> element per output frame. The
    // seek path stays as the fallback when WebCodecs or the codec is missing.
    let frameSource: SequentialVideoFrameSource | null = null;
    let stagingCanvas: HTMLCanvasElement | null = null;
    let stagingCtx: CanvasRenderingContext2D | null = null;
    let renderVideo: HTMLVideoElement | HTMLCanvasElement = videoSource || document.createElement('canvas');
    if (videoBlob && typeof VideoDecoder !== 'undefined') {
      const opened = await SequentialVideoFrameSource.open(videoBlob);
      if (opened.ok) {
        frameSource = opened.source;
        stagingCanvas = document.createElement('canvas');
        stagingCanvas.width = frameSource.width || outW;
        stagingCanvas.height = frameSource.height || outH;
        stagingCtx = stagingCanvas.getContext('2d');
        if (!stagingCtx) {
          frameSource.close();
          frameSource = null;
          stagingCanvas = null;
        } else {
          renderVideo = stagingCanvas;
          console.log(`[SmoothStudio GIF Exporter] Frame source: sequential ${frameSource.codec} decode (${frameSource.frameCount} frames).`);
        }
      } else {
        console.warn(`[SmoothStudio GIF Exporter] Frame source: <video> seeks (${opened.reason}).`);
      }
    }

    // The frame source owns its VideoFrames; close() releases the current and
    // queued frames plus the decoder on both the success and the error path.
    try {
      for (let f = 0; f < totalFrames; f++) {
        const currentMs = timestamps[f];

        const cursor = cursorEngine.getCursorAt(currentMs);
        const targetCamera = computeCinematicCameraState(
          currentMs,
          pills,
          cursor,
          metadata?.width || fullW,
          metadata?.height || fullH,
          true
        );
        springCamera.setTarget(targetCamera);
        const camera = f === 0 ? targetCamera : springCamera.update(1 / fps);
        const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);

        if (frameSource && stagingCanvas && stagingCtx) {
          const frame = await frameSource.frameAt(currentMs);
          if (stagingCanvas.width !== frame.displayWidth || stagingCanvas.height !== frame.displayHeight) {
            stagingCanvas.width = frame.displayWidth;
            stagingCanvas.height = frame.displayHeight;
          }
          stagingCtx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
        } else if (videoSource instanceof HTMLVideoElement) {
          // Wait for the frame to actually be presented.
          //
          // The listener has to be attached BEFORE currentTime is assigned, and
          // the "already there" case has to be checked BEFORE the assignment:
          // reading video.currentTime right after assigning it returns the NEW
          // target, so the old check always passed and the wait resolved before
          // the decoder had produced a frame. Every exported frame was then the
          // same picture and the deduplication collapsed the whole GIF into a
          // single frame.
          const targetSec = currentMs / 1000;
          await new Promise<void>((resolve) => {
            let settled = false;
            let timer: any = null;
            const done = () => {
              if (settled) return;
              settled = true;
              videoSource.removeEventListener('seeked', onSeeked);
              if (timer !== null) clearTimeout(timer);
              resolve();
            };
            const onSeeked = () => done();
            if (Math.abs(videoSource.currentTime - targetSec) < 0.005) {
              // The element already holds this frame: nothing to wait for.
              done();
              return;
            }
            videoSource.addEventListener('seeked', onSeeked);
            // A seek that never completes must not hang the whole export.
            timer = setTimeout(done, 2000);
            try {
              videoSource.currentTime = targetSec;
            } catch {
              done();
            }
          });
        } else if (onRenderCanvasFrame) {
          onRenderCanvasFrame(currentMs);
        }

        this.renderer.renderFrame({
          canvas: exportCanvas,
          video: renderVideo,
          currentTimeMs: currentMs,
          durationMs: effTrimEnd,
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
          captionBackdrop,
          showCaptions,
          showIntroCard,
          introHeadline,
          introSubheadline,
          showOutroCard,
          outroHeadline,
          outroCtaText,
          framePadding: options.framePadding,
          backgroundColor: options.backgroundColor,
          backgroundImage: options.backgroundImage
        });

        // Downscale to target GIF resolution
        downscaleCtx.clearRect(0, 0, outW, outH);
        downscaleCtx.drawImage(exportCanvas, 0, 0, outW, outH);
        const imgData = downscaleCtx.getImageData(0, 0, outW, outH).data;

        if (enableDeduplication && pendingFrameData && areFramesSimilar(pendingFrameData, imgData)) {
          // Increment delay of pending frame rather than writing a duplicate frame
          pendingDelayHundredths += delayHundredths;
        } else {
          flushPendingFrame();
          pendingFrameData = new Uint8ClampedArray(imgData);
          pendingDelayHundredths = delayHundredths;
        }

        if (f % 5 === 0) {
          await new Promise((r) => setTimeout(r, 1));
        }

        if (f % 6 === 0 && onProgress) {
          const percent = Math.round(((f + 1) / totalFrames) * 100);
          onProgress(percent, f + 1, totalFrames);
        }
      }

      // Flush any pending trailing frame
      flushPendingFrame();

      if (onProgress) {
        onProgress(100, totalFrames, totalFrames);
      }

      const gifBytes = buffer.subarray(0, gifWriter.end());
      const gifBlob = new Blob([gifBytes], { type: 'image/gif' });
      console.log('[SmoothStudio GIF Exporter] GIF export complete! Size:', (gifBlob.size / 1024 / 1024).toFixed(2), 'MB');
      return gifBlob;
    } finally {
      frameSource?.close();
    }
  }

  public static downloadBlob(blob: Blob, filename = 'SmoothStudio_Capture.gif') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }
}

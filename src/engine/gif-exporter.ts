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

export interface GifExportOptions {
  videoSource: HTMLVideoElement | HTMLCanvasElement;
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
  fps?: number; // defaults to 20fps for optimal GIF size/smoothness
  maxDimension?: number; // defaults to 800px width
  onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
}

// Fast 256-color RGB quantizer with palette extraction
function quantizeFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
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

  // Sort by popularity and select top 256 colors
  const sorted = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256);

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

export class HardwareGifExporter {
  private renderer: StudioRenderer;

  constructor() {
    this.renderer = new StudioRenderer();
  }

  public async exportGif(options: GifExportOptions): Promise<Blob> {
    const {
      videoSource,
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
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      fps = 20,
      maxDimension = 840,
      onProgress
    } = options;

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

    // Build timeline timestamps
    const frameIntervalMs = 1000 / fps;
    const timestamps: number[] = [];
    const cutIntervals = cutSilences ? silences.filter((s) => s.markedForCut) : [];

    for (let t = 0; t < durationMs; t += frameIntervalMs) {
      const inCut = cutIntervals.some((c) => t >= c.startTime && t <= c.endTime);
      if (!inCut) {
        timestamps.push(t);
      }
    }

    const totalFrames = timestamps.length;
    const estimatedSize = outW * outH * totalFrames * 0.4 + 1024 * 1024;
    const buffer = new Uint8Array(Math.max(4 * 1024 * 1024, estimatedSize));
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

      if (videoSource instanceof HTMLVideoElement) {
        videoSource.currentTime = currentMs / 1000;
        await new Promise<void>((r) => {
          const onSeeked = () => {
            videoSource.removeEventListener('seeked', onSeeked);
            r();
          };
          videoSource.addEventListener('seeked', onSeeked, { once: true });
          if (Math.abs(videoSource.currentTime - currentMs / 1000) < 0.01) {
            r();
          }
        });
      } else if (onRenderCanvasFrame) {
        onRenderCanvasFrame(currentMs);
      }

      this.renderer.renderFrame({
        canvas: exportCanvas,
        video: videoSource,
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

      // Downscale to target GIF resolution
      downscaleCtx.clearRect(0, 0, outW, outH);
      downscaleCtx.drawImage(exportCanvas, 0, 0, outW, outH);
      const imgData = downscaleCtx.getImageData(0, 0, outW, outH).data;

      // Quantize & add frame to GIF
      const { indexed, palette } = quantizeFrame(imgData, outW, outH);
      gifWriter.addFrame(0, 0, outW, outH, indexed as unknown as number[], {
        palette,
        delay: delayHundredths
      });

      if (f % 5 === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }

      if (f % 6 === 0 && onProgress) {
        const percent = Math.round(((f + 1) / totalFrames) * 100);
        onProgress(percent, f + 1, totalFrames);
      }
    }

    if (onProgress) {
      onProgress(100, totalFrames, totalFrames);
    }

    const gifBytes = buffer.subarray(0, gifWriter.end());
    const gifBlob = new Blob([gifBytes], { type: 'image/gif' });
    console.log('[SmoothStudio GIF Exporter] GIF export complete! Size:', (gifBlob.size / 1024 / 1024).toFixed(2), 'MB');
    return gifBlob;
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

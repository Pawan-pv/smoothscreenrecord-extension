import {
  AspectRatioType,
  VibePreset,
  VibePresetId,
  ZoomPill,
  KeystrokeEvent,
  CaptionBlock,
  CaptionStyle,
  CursorTheme
} from '../types/telemetry';
import { CameraState } from './spring-physics';
import { CursorSplineEngine, InterpolatedCursor } from './cursor-spline';

// Ken Perlin's quintic smootherstep: zero 1st & 2nd derivatives at both ends
function smootherstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

// Reused scratch canvas for the caption frosted-glass backdrop.
// Lazily created and only resized when the pill grows, so 60fps playback and
// export never allocate a new canvas (or trigger DOM/GC churn) per frame.
let captionBlurCanvas: HTMLCanvasElement | null = null;
let captionBlurCtx: CanvasRenderingContext2D | null = null;

function getCaptionBlurContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!captionBlurCanvas) {
    captionBlurCanvas = document.createElement('canvas');
  }
  if (captionBlurCanvas.width < width || captionBlurCanvas.height < height) {
    captionBlurCanvas.width = Math.ceil(width);
    captionBlurCanvas.height = Math.ceil(height);
  }
  if (!captionBlurCtx) {
    captionBlurCtx = captionBlurCanvas.getContext('2d');
  }
  return captionBlurCtx;
}

export const VIBE_PRESETS: Record<VibePresetId, VibePreset> = {
  'linear-dark': {
    id: 'linear-dark',
    name: 'Linear Dark',
    gradientColors: ['#0B0C10', '#181A24', '#0F172A'],
    borderRadius: 16,
    shadowBlur: 45,
    shadowColor: 'rgba(0, 0, 0, 0.75)',
    cursorRingColor: '#8B5CF6',
    keycapTheme: 'dark'
  },
  'apple-keynote': {
    id: 'apple-keynote',
    name: 'Apple Keynote',
    gradientColors: ['#1E2028', '#2D313E', '#161820'],
    borderRadius: 20,
    shadowBlur: 55,
    shadowColor: 'rgba(0, 0, 0, 0.85)',
    cursorRingColor: '#3B82F6',
    keycapTheme: 'glass'
  },
  'stripe-mesh': {
    id: 'stripe-mesh',
    name: 'Stripe Mesh',
    gradientColors: ['#2E1065', '#1E1B4B', '#4C1D95'],
    borderRadius: 16,
    shadowBlur: 50,
    shadowColor: 'rgba(76, 29, 149, 0.35)',
    cursorRingColor: '#A855F7',
    keycapTheme: 'glass'
  },
  'indie-pop': {
    id: 'indie-pop',
    name: 'Indie Pop',
    gradientColors: ['#3B0764', '#831843', '#1E1B4B'],
    borderRadius: 18,
    shadowBlur: 50,
    shadowColor: 'rgba(131, 24, 67, 0.35)',
    cursorRingColor: '#F43F5E',
    keycapTheme: 'light'
  },
  'minimal-clean': {
    id: 'minimal-clean',
    name: 'Minimal Clean',
    gradientColors: ['#09090B', '#121215', '#09090B'],
    borderRadius: 14,
    shadowBlur: 40,
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    cursorRingColor: '#E4E4E7',
    keycapTheme: 'dark'
  },
  'custom': {
    id: 'custom',
    name: 'Brand Palette',
    gradientColors: ['#0F172A', '#1E1B4B', '#020617'],
    borderRadius: 16,
    shadowBlur: 45,
    shadowColor: 'rgba(0, 0, 0, 0.8)',
    cursorRingColor: '#8B5CF6',
    keycapTheme: 'glass'
  }
};

export interface RenderFrameOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement | HTMLCanvasElement;
  currentTimeMs: number;
  camera: CameraState;
  activePill?: ZoomPill;
  cursorEngine: CursorSplineEngine;
  keystrokes: KeystrokeEvent[];
  preset: VibePreset;
  aspectRatio: AspectRatioType;
  showSpotlight: boolean;
  showCursor: boolean;
  showHud: boolean;
  metadata?: { width: number; height: number };
  cursorTheme?: CursorTheme;
  cursorScale?: number;
  captions?: CaptionBlock[];
  captionStyle?: CaptionStyle;
  captionBackdrop?: number; // 0..100 backdrop blur / opacity for the caption pill
  showCaptions?: boolean;
  showIntroCard?: boolean;
  introHeadline?: string;
  introSubheadline?: string;
  durationMs?: number;
  showOutroCard?: boolean;
  outroHeadline?: string;
  outroCtaText?: string;
}

export function getAspectDimensions(aspect: AspectRatioType, targetWidth = 1920): { width: number; height: number } {
  switch (aspect) {
    case '16:9':
      return { width: targetWidth, height: Math.round((targetWidth * 9) / 16) };
    case '9:16':
      return { width: Math.round((targetWidth * 9) / 16), height: targetWidth };
    case '1:1':
      return { width: targetWidth, height: targetWidth };
    case '4:3':
      return { width: targetWidth, height: Math.round((targetWidth * 3) / 4) };
    default:
      return { width: 1920, height: 1080 };
  }
}

export class StudioRenderer {
  private offscreenVideoCanvas: HTMLCanvasElement;
  private offscreenVideoCtx: CanvasRenderingContext2D;

  constructor() {
    this.offscreenVideoCanvas = document.createElement('canvas');
    this.offscreenVideoCanvas.width = 1920;
    this.offscreenVideoCanvas.height = 1080;
    this.offscreenVideoCtx = this.offscreenVideoCanvas.getContext('2d', { willReadFrequently: false })!;
  }

  public renderFrame(options: RenderFrameOptions): void {
    const {
      canvas,
      video,
      currentTimeMs,
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
      captionBackdrop = 70,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      durationMs = 0,
      showOutroCard,
      outroHeadline,
      outroCtaText
    } = options;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;

    // 1. Draw Animated Procedural Mesh Gradient Background
    this.drawMeshGradientBackground(ctx, canvasW, canvasH, preset, currentTimeMs);

    // Calculate Intro / Outro Transition Factors & 3D Spring Zoom
    let introCardAlpha = 0;
    let introCardScale = 1.0;
    let windowIntroAlpha = 1.0;
    let windowIntroScale = 1.0;
    let windowIntroTiltX = 0;
    let windowIntroTiltY = 0;

    if (showIntroCard && currentTimeMs < 1500) {
      if (currentTimeMs < 1000) {
        // First 1000ms: Title hook card is fully visible with entrance spring pop
        const enterEase = smootherstep(currentTimeMs / 320);
        introCardAlpha = enterEase;
        introCardScale = 0.88 + 0.12 * enterEase;
        windowIntroAlpha = 0;
        windowIntroScale = 0.72;
      } else {
        // 1000ms to 1500ms: Smooth 3D spring zoom transition from title card into screen recording!
        const ease = smootherstep((currentTimeMs - 1000) / 500);
        introCardAlpha = Math.max(0, 1 - ease);
        introCardScale = 1.0 + 0.12 * ease; // Card blooms gently outward as it dissolves

        windowIntroAlpha = ease;
        windowIntroScale = 0.72 + 0.28 * ease; // 3D spring zoom from 72% up to 100% full frame
        windowIntroTiltX = (1 - ease) * 8; // Dynamic isometric entry flair
        windowIntroTiltY = (1 - ease) * -12;
      }
    }

    // Outro CTA: during the final 1.5s the recording zooms out in 3D while the CTA card animates in
    let outroCardAlpha = 0;
    let outroCardScale = 1.0;
    let windowOutroAlpha = 1.0;
    let windowOutroScale = 1.0;
    let windowOutroTiltX = 0;
    let windowOutroTiltY = 0;

    if (showOutroCard && durationMs > 0 && currentTimeMs >= durationMs - 1500) {
      const elapsed = currentTimeMs - (durationMs - 1500);
      if (elapsed < 1000) {
        // First 1000ms: CTA card springs in while the recording gently zooms out
        const ease = smootherstep(elapsed / 320);
        outroCardAlpha = ease;
        outroCardScale = 0.88 + 0.12 * ease;
        windowOutroScale = 1 - 0.28 * ease;
        windowOutroTiltX = -6 * ease;
        windowOutroTiltY = 9 * ease;
      } else {
        // Final 500ms: hold the CTA card while the recording recedes and fades away
        const ease = smootherstep((elapsed - 1000) / 500);
        outroCardAlpha = 1;
        outroCardScale = 1.0 + 0.06 * ease;
        windowOutroAlpha = 1 - ease;
        windowOutroScale = 0.72 - 0.08 * ease;
        windowOutroTiltX = -6 + 6 * ease;
        windowOutroTiltY = 9 - 9 * ease;
      }
    }

    const windowAlpha = windowIntroAlpha * windowOutroAlpha;
    const windowScale = windowIntroScale * windowOutroScale;
    const windowTiltX = windowIntroTiltX + windowOutroTiltX;
    const windowTiltY = windowIntroTiltY + windowOutroTiltY;

    // 2. Calculate Window Dimensions with Studio Padding
    const paddingX = canvasW * 0.08;
    const paddingY = canvasH * 0.08;
    const availW = canvasW - paddingX * 2;
    const availH = canvasH - paddingY * 2;

    const sourceW = (video as HTMLVideoElement).videoWidth || (video as HTMLCanvasElement).width || 1920;
    const sourceH = (video as HTMLVideoElement).videoHeight || (video as HTMLCanvasElement).height || 1080;
    const videoAspect = sourceW / sourceH;

    let windowW = availW;
    let windowH = availW / videoAspect;
    if (windowH > availH) {
      windowH = availH;
      windowW = availH * videoAspect;
    }

    const windowX = (canvasW - windowW) / 2;
    const windowY = (canvasH - windowH) / 2;

    // Ensure offscreen video canvas matches source video resolution
    if (this.offscreenVideoCanvas.width !== sourceW || this.offscreenVideoCanvas.height !== sourceH) {
      this.offscreenVideoCanvas.width = sourceW;
      this.offscreenVideoCanvas.height = sourceH;
    }

    // 3. Render Source Video onto Offscreen Canvas
    this.offscreenVideoCtx.clearRect(0, 0, sourceW, sourceH);
    try {
      this.offscreenVideoCtx.drawImage(video, 0, 0, sourceW, sourceH);
    } catch {
      // Source might not be ready yet
    }

    // 4. Render Window Framing with 3D Isometric Transform and Diffused Shadow (if visible)
    if (windowAlpha > 0.001) {
      ctx.save();
      ctx.globalAlpha = windowAlpha;

      // Pivot center of the window
      const centerX = windowX + windowW / 2;
      const centerY = windowY + windowH / 2;
      ctx.translate(centerX, centerY);

      // Apply Intro / Outro 3D Spring Zoom scale
      if (windowScale < 0.999) {
        ctx.scale(windowScale, windowScale);
      }

      // Apply 3D isometric perspective tilt via shear & scale matrix
      const effectiveTiltX = camera.tiltX + windowTiltX;
      const effectiveTiltY = camera.tiltY + windowTiltY;
      if (Math.abs(effectiveTiltX) > 0.1 || Math.abs(effectiveTiltY) > 0.1) {
        const radY = (effectiveTiltY * Math.PI) / 180;
        const radX = (effectiveTiltX * Math.PI) / 180;
        // 2.5D isometric projection approximation on 2D context
        ctx.transform(
          Math.cos(radY),
          Math.sin(radX) * 0.35,
          Math.sin(radY) * 0.35,
          Math.cos(radX),
          0,
          0
        );
      }

      // Move back from pivot
      ctx.translate(-windowW / 2, -windowH / 2);

      // Draw Diffused Drop Shadow
      ctx.save();
      ctx.shadowColor = preset.shadowColor;
      ctx.shadowBlur = preset.shadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 24;
      ctx.fillStyle = '#0F1117';
      this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
      ctx.fill();
      ctx.restore();

      // Clip to rounded window corners
      ctx.save();
      this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
      ctx.clip();

      // 5. Apply Camera Zoom & Pan Transformations
      // Clamped focal point ensures video fills window with zero blank margins
      const S = Math.max(1.0, camera.scale);
      const halfViewX = 0.5 / S;
      const halfViewY = 0.5 / S;
      const clampedCamX = Math.max(halfViewX, Math.min(1 - halfViewX, camera.x));
      const clampedCamY = Math.max(halfViewY, Math.min(1 - halfViewY, camera.y));

      ctx.save();
      // Center camera onto target focal point
      ctx.translate(windowW * 0.5, windowH * 0.5);
      ctx.scale(S, S);
      ctx.translate(-clampedCamX * windowW, -clampedCamY * windowH);

      // Draw the source video content inside the window
      ctx.drawImage(this.offscreenVideoCanvas, 0, 0, windowW, windowH);
      ctx.restore();

      // 6. Render Dynamic Spotlight Mask if enabled (soft radial darkening around focal point)
      const isSpotlightActive = showSpotlight && (activePill ? activePill.spotlight : false);
      if (isSpotlightActive) {
        this.applySpotlightMask(
          ctx,
          windowW,
          windowH,
          windowW * 0.5,
          windowH * 0.5
        );
      }

      // 7. Render High-Resolution Vector Cursor and Click Ripples
      if (showCursor) {
        const cursor = cursorEngine.getCursorAt(currentTimeMs);
        const metaW = metadata?.width || sourceW;
        const metaH = metadata?.height || sourceH;

        const normCursorX = Math.max(0.01, Math.min(0.99, cursor.x / metaW));
        const normCursorY = Math.max(0.01, Math.min(0.99, cursor.y / metaH));

        // Calculate cursor screen position mapped into window frame
        const cursorScreenX = (windowW * 0.5) + (normCursorX - clampedCamX) * windowW * S;
        const cursorScreenY = (windowH * 0.5) + (normCursorY - clampedCamY) * windowH * S;

        // Compute active click ripple positions in window screen coordinates
        const activeRipples: { x: number; y: number; progress: number }[] = [];
        for (const click of cursorEngine.getClicks()) {
          const elapsed = currentTimeMs - click.t;
          if (elapsed >= 0 && elapsed <= 500) {
            const clickNormX = click.x / metaW;
            const clickNormY = click.y / metaH;
            const rx = (windowW * 0.5) + (clickNormX - clampedCamX) * windowW * S;
            const ry = (windowH * 0.5) + (clickNormY - clampedCamY) * windowH * S;
            activeRipples.push({ x: rx, y: ry, progress: elapsed / 500 });
          }
        }

        cursorEngine.drawCursorAt(
          ctx,
          cursor,
          cursorScreenX,
          cursorScreenY,
          currentTimeMs,
          preset.cursorRingColor,
          activeRipples,
          cursorTheme || 'mac-obsidian',
          cursorScale || 1.0
        );
      }

      // 8. Render Animated Word-by-Word Captions
      if (showCaptions && captions && captions.length > 0) {
        this.drawAnimatedCaptions(ctx, windowW, windowH, captions, currentTimeMs, captionStyle || 'tiktok-bold', captionBackdrop);
      }

      // Subtle window inner border for crisp Apple-like finish
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
      ctx.stroke();

      ctx.restore(); // end clip
      ctx.restore(); // end 3D transform & intro alpha
    }

    // 9. Render Floating Intro Title Card over brand mesh gradient during first 1.5s
    if (showIntroCard && introCardAlpha > 0.001) {
      this.drawIntroTitleCard(
        ctx,
        canvasW,
        canvasH,
        introHeadline || 'Introducing SmoothStudio 2.0',
        introSubheadline || 'Cinematic screen demos in seconds',
        introCardAlpha,
        introCardScale,
        preset
      );
    }

    // 10. Render Outro CTA Title Card over the brand mesh gradient during the final 1.5s
    if (showOutroCard && outroCardAlpha > 0.001) {
      this.drawOutroCtaCard(
        ctx,
        canvasW,
        canvasH,
        outroHeadline || 'Ready to ship better demos?',
        outroCtaText || 'Try SmoothStudio Free',
        outroCardAlpha,
        outroCardScale,
        preset
      );
    }

    // 11. Render 3D Glassmorphic Keystroke HUD at bottom
    if (showHud) {
      this.drawKeystrokeHud(ctx, canvasW, canvasH, keystrokes, currentTimeMs, preset);
    }
  }

  // Animated Multi-Stop Radial Mesh Gradient
  private drawMeshGradientBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    preset: VibePreset,
    timeMs: number
  ) {
    const t = timeMs * 0.0004;
    const colors = preset.gradientColors;

    // Base dark background
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);

    // Dynamic mesh blob 1
    const x1 = w * 0.3 + Math.sin(t) * (w * 0.15);
    const y1 = h * 0.4 + Math.cos(t * 1.2) * (h * 0.15);
    const grad1 = ctx.createRadialGradient(x1, y1, 10, x1, y1, w * 0.65);
    grad1.addColorStop(0, colors[1]);
    grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, w, h);

    // Dynamic mesh blob 2
    const x2 = w * 0.7 + Math.cos(t * 0.8) * (w * 0.18);
    const y2 = h * 0.6 + Math.sin(t * 1.1) * (h * 0.18);
    const grad2 = ctx.createRadialGradient(x2, y2, 20, x2, y2, w * 0.7);
    grad2.addColorStop(0, colors[2]);
    grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, w, h);
  }

  // Dynamic Spotlight Dimming mask around active element / cursor
  // Feathered radial gradient leaves center crystal-clear while dimming perimeter by up to 55%
  private applySpotlightMask(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    focalX: number,
    focalY: number
  ) {
    ctx.save();
    const radius = Math.min(w, h) * 0.48;
    const innerRadius = Math.min(w, h) * 0.14;
    const spotGrad = ctx.createRadialGradient(focalX, focalY, innerRadius, focalX, focalY, radius);
    spotGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    spotGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.18)');
    spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');

    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 3D Glassmorphic Keystroke HUD Badge
  private drawKeystrokeHud(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    keystrokes: KeystrokeEvent[],
    currentTimeMs: number,
    preset: VibePreset
  ) {
    // Find latest keystroke within 1400ms
    const recent = keystrokes
      .filter((k) => currentTimeMs >= k.t && currentTimeMs - k.t <= 1400)
      .sort((a, b) => b.t - a.t)[0];

    if (!recent) return;

    const elapsed = currentTimeMs - recent.t;
    // Entrance bounce + exit fade
    let alpha = 1.0;
    let offsetY = 0;
    if (elapsed < 200) {
      const enterProgress = elapsed / 200;
      alpha = enterProgress;
      offsetY = (1 - enterProgress) * 15;
    } else if (elapsed > 1100) {
      alpha = Math.max(0, 1 - (elapsed - 1100) / 300);
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    const text = recent.combo;
    ctx.font = '600 22px "JetBrains Mono", Inter, monospace';
    const textMetrics = ctx.measureText(text);
    const padX = 26;
    const padY = 14;
    const badgeW = textMetrics.width + padX * 2;
    const badgeH = 50;

    const x = (canvasW - badgeW) / 2;
    const y = canvasH - 90 + offsetY;

    // Glassmorphic shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;

    // 3D Keycap background
    const bgGrad = ctx.createLinearGradient(x, y, x, y + badgeH);
    if (preset.keycapTheme === 'light') {
      bgGrad.addColorStop(0, '#FFFFFF');
      bgGrad.addColorStop(1, '#E4E4E7');
    } else {
      bgGrad.addColorStop(0, 'rgba(30, 32, 42, 0.95)');
      bgGrad.addColorStop(1, 'rgba(15, 17, 23, 0.95)');
    }

    ctx.fillStyle = bgGrad;
    this.roundRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.fill();

    // 3D Keycap upper bevel border
    ctx.strokeStyle = preset.keycapTheme === 'light' ? 'rgba(0,0,0,0.15)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.stroke();

    // Render key text
    ctx.fillStyle = preset.keycapTheme === 'light' ? '#0F1117' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvasW / 2, y + badgeH / 2);

    ctx.restore();
  }

  // Render modern animated word-by-word captions (TikTok / Apple Keynote style)
  private drawAnimatedCaptions(
    ctx: CanvasRenderingContext2D,
    windowW: number,
    windowH: number,
    captions: CaptionBlock[],
    timeMs: number,
    style: CaptionStyle,
    backdrop: number = 70
  ) {
    const active = captions.find((c) => timeMs >= c.startTime && timeMs <= c.endTime);
    if (!active) return;

    ctx.save();

    const isTikTok = style === 'tiktok-bold';
    const isKeynote = style === 'apple-keynote';
    const isMinimal = style === 'minimal-pill';

    // User-controlled backdrop: 0% = barely-there frosted tint, 100% = heavy blur + near-opaque pill
    const backdropLevel = Math.max(0, Math.min(100, backdrop));
    const backdropAlpha = 0.25 + (backdropLevel / 100) * 0.65;
    const backdropBlurPx = (backdropLevel / 100) * 16;
    const borderAlpha = 0.10 + (backdropLevel / 100) * 0.38;

    const baseFontSize = isTikTok ? Math.max(18, Math.min(26, Math.round(windowW * 0.022)))
      : isKeynote ? Math.max(16, Math.min(22, Math.round(windowW * 0.019)))
      : Math.max(15, Math.min(20, Math.round(windowW * 0.017)));

    const fontFace = isKeynote
      ? '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Plus Jakarta Sans", Inter, sans-serif'
      : '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    ctx.font = `${isTikTok ? '900' : '600'} ${baseFontSize}px ${fontFace}`;
    ctx.textBaseline = 'middle';

    const words = active.words && active.words.length > 0 ? active.words : active.text.split(' ').map((w, i, arr) => {
      const dur = active.endTime - active.startTime;
      return {
        word: w,
        startTime: active.startTime + (i / arr.length) * dur,
        endTime: active.startTime + ((i + 1) / arr.length) * dur
      };
    });

    const maxLineWidth = windowW * 0.84;
    const spaceWidth = ctx.measureText(' ').width;

    // Group words into lines for clean responsive wrap
    const lines: { words: typeof words; lineWidth: number; wordWidths: number[] }[] = [];
    let currentLineWords: typeof words = [];
    let currentLineWidth = 0;
    let currentWordWidths: number[] = [];

    words.forEach((w) => {
      const wWidth = ctx.measureText(w.word).width;
      const addedWidth = currentLineWords.length === 0 ? wWidth : spaceWidth + wWidth;

      if (currentLineWidth + addedWidth > maxLineWidth && currentLineWords.length > 0) {
        lines.push({
          words: currentLineWords,
          lineWidth: currentLineWidth,
          wordWidths: currentWordWidths
        });
        currentLineWords = [w];
        currentLineWidth = wWidth;
        currentWordWidths = [wWidth];
      } else {
        currentLineWords.push(w);
        currentLineWidth += addedWidth;
        currentWordWidths.push(wWidth);
      }
    });

    if (currentLineWords.length > 0) {
      lines.push({
        words: currentLineWords,
        lineWidth: currentLineWidth,
        wordWidths: currentWordWidths
      });
    }

    const lineHeight = baseFontSize * 1.5;
    const maxLineW = Math.max(...lines.map((l) => l.lineWidth));
    const padX = isKeynote ? 28 : 22;
    const padY = 12;
    const badgeW = maxLineW + padX * 2;
    const badgeH = lines.length * lineHeight + padY * 2;
    const badgeX = (windowW - badgeW) / 2;
    const badgeY = windowH - badgeH - 36;

    // Draw caption container pill: dynamic backdrop blur + frosted tint + contrast border
    const pillRadius = isTikTok ? 14 : isKeynote || isMinimal ? 9999 : 8;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    this.fillCaptionPill(ctx, badgeX, badgeY, badgeW, badgeH, pillRadius, style, backdropAlpha, backdropBlurPx);
    ctx.restore();

    const borderColor = isMinimal
      ? `rgba(139, 92, 246, ${Math.min(1, borderAlpha + 0.18)})`
      : isKeynote
        ? `rgba(125, 211, 252, ${Math.min(1, borderAlpha + 0.08)})`
        : `rgba(255, 255, 255, ${borderAlpha})`;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, pillRadius);
    ctx.stroke();

    // Render individual words across lines with active word highlight & micro-pop
    lines.forEach((line, lineIdx) => {
      let curX = (windowW - line.lineWidth) / 2;
      const curY = badgeY + padY + lineIdx * lineHeight + lineHeight / 2;

      line.words.forEach((w, wIdx) => {
        const isWordActive = timeMs >= w.startTime && timeMs <= w.endTime;
        const isPast = timeMs > w.endTime;
        const wWidth = line.wordWidths[wIdx];

        ctx.save();

        if (isWordActive) {
          if (isTikTok) {
            ctx.fillStyle = '#FACC15'; // Punchy viral TikTok yellow
            ctx.shadowColor = '#FACC15';
            ctx.shadowBlur = 14;
            // Micro-pop scale on active word
            ctx.translate(curX + wWidth / 2, curY);
            ctx.scale(1.08, 1.08);
            ctx.translate(-(curX + wWidth / 2), -curY);
          } else if (isKeynote) {
            ctx.fillStyle = '#38BDF8'; // Electric Keynote cyan
            ctx.shadowColor = '#38BDF8';
            ctx.shadowBlur = 12;
            ctx.translate(curX + wWidth / 2, curY);
            ctx.scale(1.05, 1.05);
            ctx.translate(-(curX + wWidth / 2), -curY);
          } else if (isMinimal) {
            ctx.fillStyle = '#C084FC';
            ctx.shadowColor = '#C084FC';
            ctx.shadowBlur = 8;
          } else {
            ctx.fillStyle = '#FDE047';
          }
        } else if (isPast) {
          ctx.fillStyle = '#FFFFFF';
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        }

        ctx.textAlign = 'left';
        ctx.fillText(w.word, curX, curY);
        ctx.restore();

        curX += wWidth + spaceWidth;
      });
    });

    ctx.restore();
  }

  // Caption pill backdrop: blurred copy of the already-rendered frame + frosted tint overlay
  private fillCaptionPill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    style: CaptionStyle,
    alpha: number,
    blurPx: number
  ) {
    ctx.save();
    this.roundRect(ctx, x, y, w, h, radius);
    ctx.clip();

    // Real frosted glass: blur the canvas region sitting behind the pill, then draw it back clipped
    if (blurPx >= 1 && 'filter' in ctx) {
      try {
        const m = ctx.getTransform();
        const tl = m.transformPoint(new DOMPoint(x, y));
        const br = m.transformPoint(new DOMPoint(x + w, y + h));
        const sx = Math.max(0, Math.floor(Math.min(tl.x, br.x)));
        const sy = Math.max(0, Math.floor(Math.min(tl.y, br.y)));
        const sw = Math.min(ctx.canvas.width - sx, Math.ceil(Math.abs(br.x - tl.x)));
        const sh = Math.min(ctx.canvas.height - sy, Math.ceil(Math.abs(br.y - tl.y)));

        if (sw > 1 && sh > 1) {
          const bctx = getCaptionBlurContext(sw, sh);
          if (bctx && captionBlurCanvas) {
            bctx.clearRect(0, 0, sw, sh);
            bctx.filter = `blur(${blurPx}px)`;
            bctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            bctx.filter = 'none';
            ctx.drawImage(captionBlurCanvas, 0, 0, sw, sh, x, y, w, h);
          }
        }
      } catch {
        // Fallback: flat frosted tint only
      }
    }

    // Frosted tint overlay (per-style tint keeps each caption vibe distinct)
    const tint = style === 'apple-keynote' ? '15, 20, 30' : style === 'minimal-pill' ? '15, 17, 23' : '0, 0, 0';
    ctx.fillStyle = `rgba(${tint}, ${alpha})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // Floating Glassmorphic Intro Hook Card over brand mesh gradient
  private drawIntroTitleCard(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    headline: string,
    subheadline: string,
    alpha: number,
    scale: number,
    preset: VibePreset
  ) {
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(scale, scale);

    const cardW = Math.min(canvasW * 0.78, 860);
    const cardH = Math.min(canvasH * 0.44, 300);
    const cardX = -cardW / 2;
    const cardY = -cardH / 2;

    // Card shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 20;

    // Background gradient
    const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cardGrad.addColorStop(0, 'rgba(20, 24, 35, 0.88)');
    cardGrad.addColorStop(1, 'rgba(11, 13, 20, 0.94)');
    ctx.fillStyle = cardGrad;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.restore();

    // Glass Card Bevel Border
    ctx.save();
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    borderGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    borderGrad.addColorStop(1, 'rgba(139, 92, 246, 0.35)');
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.stroke();
    ctx.restore();

    // Top Badge Pill
    const badgeText = 'SMOOTHSTUDIO PRO DEMO';
    ctx.save();
    ctx.font = '700 11px Inter, sans-serif';
    const badgeMetrics = ctx.measureText(badgeText);
    const badgeW = badgeMetrics.width + 24;
    const badgeH = 26;
    const badgeX = -badgeW / 2;
    const badgeY = cardY + 36;

    ctx.fillStyle = 'rgba(139, 92, 246, 0.2)';
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 13);
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 13);
    ctx.stroke();

    ctx.fillStyle = '#C084FC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, 0, badgeY + badgeH / 2);
    ctx.restore();

    // Main Headline
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const headlineFontSize = Math.max(28, Math.min(52, Math.round(cardW * 0.058)));
    ctx.font = `bold ${headlineFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillText(headline || 'Introducing SmoothStudio 2.0', 0, cardY + cardH * 0.52);
    ctx.restore();

    // Subheadline
    if (subheadline) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const subFontSize = Math.max(15, Math.min(22, Math.round(cardW * 0.026)));
      ctx.font = `400 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.fillText(subheadline, 0, cardY + cardH * 0.76);
      ctx.restore();
    }

    ctx.restore();
  }

  // Outro CTA hook card: headline + glowing gradient CTA pill over the brand mesh gradient
  private drawOutroCtaCard(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    headline: string,
    ctaText: string,
    alpha: number,
    scale: number,
    preset: VibePreset
  ) {
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(scale, scale);

    const cardW = Math.min(canvasW * 0.72, 780);
    const cardH = Math.min(canvasH * 0.46, 320);
    const cardX = -cardW / 2;
    const cardY = -cardH / 2;

    // Card shadow + glass background
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 20;
    const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cardGrad.addColorStop(0, 'rgba(20, 24, 35, 0.88)');
    cardGrad.addColorStop(1, 'rgba(11, 13, 20, 0.94)');
    ctx.fillStyle = cardGrad;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.restore();

    // Glass bevel border with brand accent
    ctx.save();
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    borderGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    borderGrad.addColorStop(1, 'rgba(236, 72, 153, 0.4)');
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.stroke();
    ctx.restore();

    // Eyebrow
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = '#C084FC';
    ctx.fillText('THANKS FOR WATCHING', 0, cardY + 38);
    ctx.restore();

    // Outro Headline
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const headlineFontSize = Math.max(26, Math.min(46, Math.round(cardW * 0.054)));
    ctx.font = `bold ${headlineFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillText(headline || 'Ready to ship better demos?', 0, cardY + cardH * 0.44);
    ctx.restore();

    // Glowing gradient CTA pill badge
    const cta = ctaText || 'Try SmoothStudio Free';
    ctx.save();
    ctx.font = '700 15px Inter, sans-serif';
    const ctaMetrics = ctx.measureText(cta);
    const ctaPadX = 24;
    const ctaW = ctaMetrics.width + ctaPadX * 2;
    const ctaH = 46;
    const ctaX = -ctaW / 2;
    const ctaY = cardY + cardH * 0.64;

    // Outer glow
    ctx.shadowColor = 'rgba(139, 92, 246, 0.8)';
    ctx.shadowBlur = 28;
    const ctaGrad = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaW, ctaY + ctaH);
    ctaGrad.addColorStop(0, '#8B5CF6');
    ctaGrad.addColorStop(0.5, '#6366F1');
    ctaGrad.addColorStop(1, '#EC4899');
    ctx.fillStyle = ctaGrad;
    this.roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 9999);
    ctx.fill();
    ctx.restore();

    // CTA top highlight bevel
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 9999);
    ctx.stroke();
    ctx.restore();

    // CTA label
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 15px Inter, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.fillText(cta, 0, ctaY + ctaH / 2 + 1);
    ctx.restore();

    ctx.restore();
  }

  // Cross-browser canvas rounded rectangle helper
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

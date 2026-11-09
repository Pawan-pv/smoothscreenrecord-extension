import {
  AspectRatioType,
  VibePreset,
  VibePresetId,
  ZoomPill,
  KeystrokeEvent
} from '../types/telemetry';
import { CameraState } from './spring-physics';
import { CursorSplineEngine, InterpolatedCursor } from './cursor-spline';

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
      metadata
    } = options;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;

    // 1. Draw Animated Procedural Mesh Gradient Background
    this.drawMeshGradientBackground(ctx, canvasW, canvasH, preset, currentTimeMs);

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

    // 4. Draw Window Framing with 3D Isometric Transform and Diffused Shadow
    ctx.save();

    // Pivot center of the window
    const centerX = windowX + windowW / 2;
    const centerY = windowY + windowH / 2;
    ctx.translate(centerX, centerY);

    // Apply 3D isometric perspective tilt via shear & scale matrix
    if (Math.abs(camera.tiltX) > 0.1 || Math.abs(camera.tiltY) > 0.1) {
      const radY = (camera.tiltY * Math.PI) / 180;
      const radX = (camera.tiltX * Math.PI) / 180;
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
      // The focal center in the window is windowW * 0.5, windowH * 0.5
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
        activeRipples
      );
    }

    // Subtle window inner border for crisp Apple-like finish
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
    ctx.stroke();

    ctx.restore(); // end clip
    ctx.restore(); // end 3D transform

    // 8. Render 3D Glassmorphic Keystroke HUD at bottom
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

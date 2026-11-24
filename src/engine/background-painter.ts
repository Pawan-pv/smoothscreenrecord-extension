import type { BackgroundLayer } from '../types/telemetry';
import { drawWallpaper, drawGrain, wallpaperGrain } from './wallpapers';

/**
 * Static backgrounds (solid, image, ...) are painted ONCE per renderer into an
 * offscreen canvas at the output size and copied in every frame. Each renderer
 * (the preview and every export) paints at its own canvas size, so a background
 * is sharp at 1080p and at 4K, and the preview and the exports show the same
 * picture.
 *
 * With Motion on, wallpapers, gradients and images animate slowly, as a pure
 * function of the timeline time (so preview and export match frame for frame):
 * wallpapers drift and roll, gradients sway, images do a slow Ken Burns push and
 * pan. Built for 60 fps: a wallpaper is drawn at half resolution (its soft glows
 * do not need more) with the grain at full resolution on top; an image is
 * prepared once (cover fit + blur) and only moved per frame.
 */

export interface CoverFitResult {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Source crop that covers a targetW x targetH area with the image (centred, no bars). */
export function computeCoverFit(imgW: number, imgH: number, targetW: number, targetH: number): CoverFitResult {
  const safeImgW = Math.max(1, imgW);
  const safeImgH = Math.max(1, imgH);
  const targetAspect = targetW / targetH;
  const imgAspect = safeImgW / safeImgH;
  let sx = 0;
  let sy = 0;
  let sw = safeImgW;
  let sh = safeImgH;
  if (imgAspect > targetAspect) {
    // Image is wider than the canvas: crop the sides.
    sw = Math.round(safeImgH * targetAspect);
    sx = Math.round((safeImgW - sw) / 2);
  } else {
    // Image is taller than the canvas: crop top and bottom.
    sh = Math.round(safeImgW / targetAspect);
    sy = Math.round((safeImgH - sh) / 2);
  }
  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: targetW, dh: targetH };
}

/** Built-in gradients (colors spread evenly, CSS angle convention). */
export const GRADIENT_PRESETS: Array<{ name: string; colors: string[]; angle: number; shape: 'linear' | 'radial' }> = [
  { name: 'Violet', colors: ['#4F46E5', '#9333EA', '#EC4899'], angle: 135, shape: 'linear' },
  { name: 'Sunset', colors: ['#FF7E5F', '#FEB47B'], angle: 135, shape: 'linear' },
  { name: 'Ocean', colors: ['#1E3A8A', '#0EA5E9', '#67E8F9'], angle: 160, shape: 'linear' },
  { name: 'Aurora', colors: ['#00C9FF', '#92FE9D'], angle: 120, shape: 'linear' },
  { name: 'Ember', colors: ['#7F1D1D', '#F83600', '#F9D423'], angle: 45, shape: 'linear' },
  { name: 'Midnight', colors: ['#0F2027', '#203A43', '#2C5364'], angle: 180, shape: 'linear' },
  { name: 'Blush', colors: ['#FBCFE8', '#C4B5FD', '#A5F3FC'], angle: 135, shape: 'linear' },
  { name: 'Spotlight', colors: ['#3B3F58', '#0B0C10'], angle: 0, shape: 'radial' }
];

/** The same gradient as CSS, for swatches in the editor. */
export function gradientCss(colors: string[], angle: number, shape: 'linear' | 'radial'): string {
  const list = colors.length > 1 ? colors : [colors[0] || '#000000', colors[0] || '#000000'];
  return shape === 'radial'
    ? `radial-gradient(circle at center, ${list.join(', ')})`
    : `linear-gradient(${angle}deg, ${list.join(', ')})`;
}

/** Wallpapers, gradients and images can move; a solid color stays still. */
export function backgroundTakesMotion(layer: BackgroundLayer): boolean {
  const k = layer.spec.kind;
  return k === 'wallpaper' || k === 'gradient' || k === 'image';
}

/** Seconds of motion at a timeline time: Motion 40 = real time, 100 = 2.5x, 0 = still. */
export function backgroundMotionSeconds(layer: BackgroundLayer, timeMs: number): number {
  const m = Math.max(0, Math.min(100, Number.isFinite(layer.effects?.motion) ? layer.effects.motion : 0));
  if (m <= 0 || !Number.isFinite(timeMs)) return 0;
  return (Math.max(0, timeMs) / 1000) * (m / 40);
}

/**
 * 'backdrop' = the preset's animated backdrop; 'static' = painted once and cached;
 * 'animated' = a wallpaper / gradient / image with Motion on, drawn per frame.
 */
export function backgroundMode(layer: BackgroundLayer | null | undefined): 'backdrop' | 'static' | 'animated' {
  if (!layer) return 'backdrop';
  const spec = layer.spec;
  let ready = false;
  if (spec.kind === 'solid') ready = Boolean(spec.color);
  else if (spec.kind === 'gradient') ready = spec.colors.length > 0;
  else if (spec.kind === 'wallpaper') ready = true;
  else if (spec.kind === 'image') ready = Boolean(layer.image);
  if (!ready) return 'backdrop';
  const moving = backgroundTakesMotion(layer) && (layer.effects?.motion ?? 0) > 0;
  return moving ? 'animated' : 'static';
}

const TAU = Math.PI * 2;
/** A slow seamless sway, zero at t = 0 (see wallpapers.ts). */
function sway(t: number, amplitude: number, period: number, phase = 0): number {
  return amplitude * (Math.sin((TAU * t) / period + phase) - Math.sin(phase));
}

function imageSize(img: CanvasImageSource, fallbackW: number, fallbackH: number): { w: number; h: number } {
  const any = img as any;
  return {
    w: any.naturalWidth || any.videoWidth || any.displayWidth || any.width || fallbackW,
    h: any.naturalHeight || any.videoHeight || any.displayHeight || any.height || fallbackH
  };
}

/**
 * A gradient like CSS `linear-gradient(<angle>deg, ...)` (0 = towards the top, 90 = towards
 * the right; the gradient line spans the whole box) or `radial-gradient(circle at center, ...)`
 * reaching the corners. Colors are spread evenly.
 */
export function paintGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  angle: number,
  shape: 'linear' | 'radial',
  center: { x: number; y: number } = { x: 0.5, y: 0.5 }
): void {
  const list = colors.length > 0 ? colors : ['#000000'];
  let gradient: CanvasGradient;
  if (shape === 'radial') {
    const cx = center.x * w;
    const cy = center.y * h;
    // Reaches the farthest corner, like CSS farthest-corner.
    const reach = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
  } else {
    const rad = ((Number.isFinite(angle) ? angle : 135) * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    gradient = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  }
  if (list.length === 1) {
    gradient.addColorStop(0, list[0]);
    gradient.addColorStop(1, list[0]);
  } else {
    list.forEach((c, i) => gradient.addColorStop(i / (list.length - 1), c));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** Blur radius in px for a 0..100 setting, relative to the canvas (same look at 1080p and 4K). */
export function backgroundBlurPx(blur: number, w: number, h: number): number {
  const v = Math.max(0, Math.min(100, Number.isFinite(blur) ? blur : 0));
  return (v / 100) * 40 * (Math.min(w, h) / 1080);
}

/** Opacity of the black dim overlay for a 0..100 setting. */
export function backgroundDimAlpha(dim: number): number {
  const v = Math.max(0, Math.min(100, Number.isFinite(dim) ? dim : 0));
  return (v / 100) * 0.7;
}

/** Wallpapers and images take blur / dim; colors and gradients are already plain. */
export function backgroundTakesEffects(layer: BackgroundLayer): boolean {
  return layer.spec.kind === 'wallpaper' || layer.spec.kind === 'image';
}

/** Paints a static background into ctx (w x h), with its blur and dim. */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
  const effects = backgroundTakesEffects(layer) ? layer.effects : null;
  const blurPx = effects ? backgroundBlurPx(effects.blur, w, h) : 0;
  if (blurPx >= 0.5) {
    // Paint sharp first, then copy it blurred. The copy is drawn a little larger than the
    // canvas: a blur fades towards the transparent outside, and that fade must stay off-canvas.
    const sharp = document.createElement('canvas');
    sharp.width = w;
    sharp.height = h;
    const sctx = sharp.getContext('2d');
    if (sctx) {
      paintSharp(sctx, w, h, layer);
      const margin = blurPx * 3;
      ctx.save();
      ctx.filter = `blur(${blurPx}px)`;
      ctx.drawImage(sharp, -margin, -margin, w + margin * 2, h + margin * 2);
      ctx.restore();
    }
  } else {
    paintSharp(ctx, w, h, layer);
  }
  const dimAlpha = effects ? backgroundDimAlpha(effects.dim) : 0;
  if (dimAlpha > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${dimAlpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

function paintSharp(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
  const spec = layer.spec;
  ctx.save();
  if (spec.kind === 'solid') {
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, w, h);
  } else if (spec.kind === 'gradient') {
    paintGradient(ctx, w, h, spec.colors, spec.angle, spec.shape);
  } else if (spec.kind === 'wallpaper') {
    drawWallpaper(ctx, w, h, spec.id);
  } else if (spec.kind === 'image' && layer.image) {
    const size = imageSize(layer.image, w, h);
    const fit = computeCoverFit(size.w, size.h, w, h);
    ctx.drawImage(layer.image, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, w, h);
  }
  ctx.restore();
}

let nextImageId = 1;
const imageIds = new WeakMap<object, number>();
function imageKey(img: CanvasImageSource | null | undefined): number {
  if (!img) return 0;
  let id = imageIds.get(img as object);
  if (!id) {
    id = nextImageId++;
    imageIds.set(img as object, id);
  }
  return id;
}

function dimOver(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
  if (!backgroundTakesEffects(layer)) return;
  const a = backgroundDimAlpha(layer.effects.dim);
  if (a <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function ensureCanvas(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const canvas = c || document.createElement('canvas');
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas;
}

/** Ken Burns for images: zoom between these, with a pan smaller than the zoom's spare margin. */
const KB_MIN = 1.04;
const KB_MAX = 1.12;
const KB_PAN = 0.015;

/** One renderer's background: the cached static picture, and the buffers of the animated one. */
export class BackgroundCache {
  private canvas: HTMLCanvasElement | null = null;
  private key = '';
  private low: HTMLCanvasElement | null = null;
  private lowBlur: HTMLCanvasElement | null = null;
  private stage: HTMLCanvasElement | null = null;
  private stageKey = '';

  /** Draws the background of this frame: cached when still, animated by the timeline time when moving. */
  public draw(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer, timeMs = 0): void {
    if (backgroundMode(layer) === 'animated') {
      this.drawAnimated(ctx, w, h, layer, backgroundMotionSeconds(layer, timeMs));
      return;
    }
    this.drawStatic(ctx, w, h, layer);
  }

  private drawAnimated(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer, t: number): void {
    const spec = layer.spec;
    if (spec.kind === 'gradient') {
      // A gentle sway of the angle; a radial centre drifts on a slow ellipse.
      const angle = spec.angle + sway(t, 18, 26);
      const center = { x: 0.5 + sway(t, 0.12, 30), y: 0.5 + sway(t, 0.09, 41, 1.2) };
      paintGradient(ctx, w, h, spec.colors, angle, spec.shape, center);
      return;
    }
    if (spec.kind === 'wallpaper') {
      const lw = Math.max(2, Math.ceil(w / 2));
      const lh = Math.max(2, Math.ceil(h / 2));
      this.low = ensureCanvas(this.low, lw, lh);
      const lctx = this.low.getContext('2d');
      if (!lctx) return;
      lctx.clearRect(0, 0, lw, lh);
      drawWallpaper(lctx, lw, lh, spec.id, t, { grain: false });
      let source: HTMLCanvasElement = this.low;
      const blurPx = backgroundBlurPx(layer.effects.blur, lw, lh);
      if (blurPx >= 0.5) {
        this.lowBlur = ensureCanvas(this.lowBlur, lw, lh);
        const bctx = this.lowBlur.getContext('2d');
        if (bctx) {
          const margin = blurPx * 3;
          bctx.save();
          bctx.clearRect(0, 0, lw, lh);
          bctx.filter = `blur(${blurPx}px)`;
          bctx.drawImage(this.low, -margin, -margin, lw + margin * 2, lh + margin * 2);
          bctx.restore();
          source = this.lowBlur;
        }
      }
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
      drawGrain(ctx, w, h, wallpaperGrain(spec.id));
      dimOver(ctx, w, h, layer);
      return;
    }
    if (spec.kind === 'image' && layer.image) {
      // The stage is the image covering a KB_MAX-larger area, blurred once.
      const sw = Math.ceil(w * KB_MAX);
      const sh = Math.ceil(h * KB_MAX);
      const key = `${sw}x${sh}|${imageKey(layer.image)}|${layer.effects.blur}`;
      if (!this.stage || key !== this.stageKey) {
        this.stage = ensureCanvas(this.stage, sw, sh);
        const sctx = this.stage.getContext('2d');
        if (!sctx) return;
        sctx.clearRect(0, 0, sw, sh);
        paintBackground(sctx, sw, sh, { ...layer, effects: { ...layer.effects, dim: 0 } });
        this.stageKey = key;
      }
      // Slow push in and out between KB_MIN and KB_MAX, with a drifting pan.
      const zoom = KB_MIN + (KB_MAX - KB_MIN) * (0.5 - 0.5 * Math.cos((TAU * t) / 34));
      const dw = w * zoom;
      const dh = h * zoom;
      const dx = (w - dw) / 2 + Math.sin((TAU * t) / 47) * KB_PAN * w;
      const dy = (h - dh) / 2 + Math.sin((TAU * t) / 39 + 1) * KB_PAN * h;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.stage, dx, dy, dw, dh);
      ctx.restore();
      dimOver(ctx, w, h, layer);
      return;
    }
    this.drawStatic(ctx, w, h, layer);
  }

  /** Draws the static background onto ctx, repainting the cache only when the layer or the size changed. */
  private drawStatic(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
    const key = `${w}x${h}|${JSON.stringify(layer.spec)}|${layer.effects.blur}|${layer.effects.dim}|${imageKey(layer.image)}`;
    if (!this.canvas || key !== this.key) {
      if (!this.canvas) this.canvas = document.createElement('canvas');
      this.canvas.width = w;
      this.canvas.height = h;
      const cctx = this.canvas.getContext('2d');
      if (!cctx) return;
      cctx.clearRect(0, 0, w, h);
      paintBackground(cctx, w, h, layer);
      this.key = key;
    }
    ctx.drawImage(this.canvas, 0, 0, w, h);
  }
}

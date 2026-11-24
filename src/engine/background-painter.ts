import type { BackgroundLayer } from '../types/telemetry';

/**
 * Static backgrounds (solid, image, ...) are painted ONCE per renderer into an
 * offscreen canvas at the output size and copied in every frame. Each renderer
 * (the preview and every export) paints at its own canvas size, so a background
 * is sharp at 1080p and at 4K, and the preview and the exports show the same
 * picture. Only the animated Backdrop Matrix ('backdrop') is drawn per frame.
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

/** 'backdrop' = the animated preset backdrop, drawn every frame; 'static' = painted once and cached. */
export function backgroundMode(layer: BackgroundLayer | null | undefined): 'backdrop' | 'static' {
  if (!layer) return 'backdrop';
  const spec = layer.spec;
  if (spec.kind === 'solid') return spec.color ? 'static' : 'backdrop';
  if (spec.kind === 'gradient') return spec.colors.length > 0 ? 'static' : 'backdrop';
  if (spec.kind === 'image') return layer.image ? 'static' : 'backdrop';
  return 'backdrop';
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
  shape: 'linear' | 'radial'
): void {
  const list = colors.length > 0 ? colors : ['#000000'];
  let gradient: CanvasGradient;
  if (shape === 'radial') {
    gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
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

/** Paints a static background into ctx (w x h). */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
  const spec = layer.spec;
  ctx.save();
  if (spec.kind === 'solid') {
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, w, h);
  } else if (spec.kind === 'gradient') {
    paintGradient(ctx, w, h, spec.colors, spec.angle, spec.shape);
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

/** One renderer's cached static background. */
export class BackgroundCache {
  private canvas: HTMLCanvasElement | null = null;
  private key = '';

  /** Draws the static background onto ctx, repainting the cache only when the layer or the size changed. */
  public draw(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
    const key = `${w}x${h}|${JSON.stringify(layer.spec)}|${JSON.stringify(layer.effects)}|${imageKey(layer.image)}`;
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

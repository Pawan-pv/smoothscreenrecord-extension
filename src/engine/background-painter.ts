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

/** 'backdrop' = the animated preset backdrop, drawn every frame; 'static' = painted once and cached. */
export function backgroundMode(layer: BackgroundLayer | null | undefined): 'backdrop' | 'static' {
  if (!layer) return 'backdrop';
  const spec = layer.spec;
  if (spec.kind === 'solid') return spec.color ? 'static' : 'backdrop';
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

/** Paints a static background into ctx (w x h). */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, layer: BackgroundLayer): void {
  const spec = layer.spec;
  ctx.save();
  if (spec.kind === 'solid') {
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, w, h);
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

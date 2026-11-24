/**
 * Built-in wallpapers, generated in code (the extension makes no network
 * requests, so nothing is downloaded and no image files ship).
 *
 * Every design is drawn with sizes that are fractions of the canvas, and every
 * random detail comes from a seeded generator, so a wallpaper has the same
 * composition at every size and on every render: the preview and a 4K export
 * match, and both are sharp. (Only the fine film grain is per pixel.)
 *
 * Motion: `draw(ctx, w, h, t)` takes a time in seconds. Glows drift on slow
 * closed paths, waves roll, stars twinkle; every movement is a sine with a long
 * period (18-40 s), so it loops seamlessly and never jerks. t = 0 is exactly the
 * still wallpaper.
 */

export interface Wallpaper {
  id: string;
  name: string;
  /** Strength of the film grain laid over the design. */
  grain: number;
  /** Draws the design at time t (seconds of motion; 0 = still). Grain is added separately. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

/** mulberry32: small, fast, seeded. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TAU = Math.PI * 2;

/**
 * A slow, seamless sway: amplitude * (sin(2 pi t / period + phase) - sin(phase)).
 * Zero at t = 0, so the still frame is the motion's first frame.
 */
function sway(t: number, amplitude: number, period: number, phase = 0): number {
  return amplitude * (Math.sin((TAU * t) / period + phase) - Math.sin(phase));
}

/** Base gradient over the whole canvas (angle in CSS degrees). */
function base(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[], angle = 180): void {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * A soft glow: a radial gradient fading to transparent. Position and radius are
 * fractions; it drifts on a slow ellipse (a Lissajous path) when t > 0.
 */
function blob(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fx: number,
  fy: number,
  fr: number,
  color: string,
  alpha: number,
  t = 0,
  drift: { ax?: number; ay?: number; period?: number; phase?: number } = {}
): void {
  const period = drift.period ?? 26;
  const phase = drift.phase ?? 0;
  const x = (fx + sway(t, drift.ax ?? 0.08, period, phase)) * w;
  const y = (fy + sway(t, drift.ay ?? 0.06, period * 1.37, phase + 1.3)) * h;
  // A gentle "breath" of the glow's size.
  const r = fr * (1 + sway(t, 0.06, period * 0.83, phase + 0.7)) * Math.max(w, h);
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.55));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A filled wave band from a baseline (fraction of h) down to the bottom edge; it rolls with t. */
function wave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  baseline: number,
  amplitude: number,
  periods: number,
  phase: number,
  fill: string | CanvasGradient,
  t = 0,
  rollPeriod = 30
): void {
  const roll = (TAU * t) / rollPeriod;
  const breathe = 1 + sway(t, 0.25, rollPeriod * 1.6, phase);
  ctx.beginPath();
  ctx.moveTo(0, h);
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const y = (baseline + amplitude * breathe * Math.sin(p * periods * TAU + phase + roll)) * h;
    ctx.lineTo(p * w, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function vertical(ctx: CanvasRenderingContext2D, h: number, from: number, to: number, a: string, b: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, from * h, 0, to * h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

let grainTile: HTMLCanvasElement | null = null;
/** Fine film grain (a seeded 128 px noise tile), so large gradients never band. */
export function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  if (!(alpha > 0)) return;
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = 128;
    grainTile.height = 128;
    const tctx = grainTile.getContext('2d');
    if (!tctx) return;
    const img = tctx.createImageData(128, 128);
    const rnd = seeded(1337);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rnd() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
  }
  const pattern = ctx.createPattern(grainTile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, seed: number, t = 0): void {
  const rnd = seeded(seed);
  const unit = Math.min(w, h) / 1080;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.6 + rnd() * 1.6) * unit;
    const alpha = 0.25 + rnd() * 0.65;
    const twinklePeriod = 3 + rnd() * 5;
    const twinklePhase = rnd() * TAU;
    // Twinkle: each star breathes on its own slow rhythm (unchanged at t = 0).
    const twinkle = t > 0 ? 0.65 + 0.35 * Math.cos((TAU * t) / twinklePeriod + twinklePhase) - 0.35 * Math.cos(twinklePhase) : 1;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * twinkle));
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'aurora-violet',
    name: 'Aurora Violet',
    grain: 0.06,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#0B0A1F', '#140B2E'], 160);
      blob(ctx, w, h, 0.18, 0.28, 0.55, '#7C3AED', 0.85, t, { period: 24, phase: 0 });
      blob(ctx, w, h, 0.82, 0.18, 0.45, '#EC4899', 0.7, t, { period: 30, phase: 2.1 });
      blob(ctx, w, h, 0.62, 0.88, 0.55, '#3B82F6', 0.7, t, { period: 27, phase: 4.2 });
    }
  },
  {
    id: 'aurora-teal',
    name: 'Aurora Teal',
    grain: 0.06,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#021417', '#04232A'], 180);
      blob(ctx, w, h, 0.25, 0.75, 0.55, '#14B8A6', 0.8, t, { period: 28, phase: 0.5 });
      blob(ctx, w, h, 0.78, 0.3, 0.5, '#22C55E', 0.55, t, { period: 23, phase: 2.6 });
      blob(ctx, w, h, 0.5, 0.05, 0.45, '#06B6D4', 0.6, t, { period: 32, phase: 4.4 });
    }
  },
  {
    id: 'sunset-dune',
    name: 'Sunset Dune',
    grain: 0.05,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#FDBA74', '#F472B6', '#7C3AED'], 180);
      blob(ctx, w, h, 0.5, 0.42, 0.25, '#FEF3C7', 0.75, t, { ax: 0.03, ay: 0.02, period: 36 });
      wave(ctx, w, h, 0.66, 0.035, 1.2, 0.4, vertical(ctx, h, 0.6, 1, '#9D4EDD', '#5B21B6'), t, 40);
      wave(ctx, w, h, 0.76, 0.03, 0.9, 2.1, vertical(ctx, h, 0.7, 1, '#6D28D9', '#3B0764'), t, 32);
      wave(ctx, w, h, 0.88, 0.025, 1.4, 4.0, vertical(ctx, h, 0.8, 1, '#3B0764', '#1E0533'), t, 26);
    }
  },
  {
    id: 'ocean-depth',
    name: 'Ocean Depth',
    grain: 0.05,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#0C4A6E', '#082F49', '#020617'], 180);
      blob(ctx, w, h, 0.3, 0.0, 0.5, '#38BDF8', 0.45, t, { period: 30, phase: 1 });
      blob(ctx, w, h, 0.85, 0.35, 0.35, '#22D3EE', 0.25, t, { period: 25, phase: 3 });
      wave(ctx, w, h, 0.8, 0.02, 2.0, 0.0, rgba('#0EA5E9', 0.18), t, 22);
      wave(ctx, w, h, 0.86, 0.025, 1.5, 1.7, rgba('#0284C7', 0.22), t, 28);
    }
  },
  {
    id: 'mint-glass',
    name: 'Mint Glass',
    grain: 0.04,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#ECFDF5', '#E0F2FE'], 135);
      blob(ctx, w, h, 0.2, 0.25, 0.45, '#6EE7B7', 0.7, t, { period: 26, phase: 0.3 });
      blob(ctx, w, h, 0.85, 0.7, 0.5, '#93C5FD', 0.65, t, { period: 31, phase: 2.2 });
      blob(ctx, w, h, 0.55, 0.95, 0.35, '#A7F3D0', 0.6, t, { period: 22, phase: 4.0 });
    }
  },
  {
    id: 'peach-blobs',
    name: 'Peach',
    grain: 0.04,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#FFF7ED', '#FFE4E6'], 160);
      blob(ctx, w, h, 0.15, 0.8, 0.45, '#FDBA74', 0.75, t, { period: 27, phase: 0.8 });
      blob(ctx, w, h, 0.75, 0.2, 0.45, '#FCA5A5', 0.65, t, { period: 24, phase: 2.9 });
      blob(ctx, w, h, 0.9, 0.9, 0.35, '#F9A8D4', 0.6, t, { period: 33, phase: 5.0 });
    }
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    grain: 0.04,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#FBCFE8', '#E9D5FF', '#C7D2FE'], 120 + sway(t, 10, 40));
      blob(ctx, w, h, 0.3, 0.35, 0.4, '#FFFFFF', 0.55, t, { period: 29, phase: 1.1 });
      blob(ctx, w, h, 0.8, 0.75, 0.35, '#F0ABFC', 0.45, t, { period: 25, phase: 3.6 });
    }
  },
  {
    id: 'nebula',
    name: 'Nebula',
    grain: 0.05,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#05010F', '#0B0420'], 180);
      blob(ctx, w, h, 0.3, 0.4, 0.4, '#9333EA', 0.55, t, { period: 34, phase: 0.2 });
      blob(ctx, w, h, 0.65, 0.55, 0.35, '#DB2777', 0.45, t, { period: 28, phase: 2.4 });
      blob(ctx, w, h, 0.5, 0.3, 0.25, '#2563EB', 0.45, t, { period: 38, phase: 4.6 });
      stars(ctx, w, h, 220, 42, t);
    }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    grain: 0.07,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#2A2F38', '#111418'], 160);
      // A slow studio light sweeping across.
      blob(ctx, w, h, 0.25, 0.15, 0.6, '#64748B', 0.35, t, { ax: 0.25, ay: 0.05, period: 36 });
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }
  },
  {
    id: 'midnight-grid',
    name: 'Midnight Grid',
    grain: 0.05,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#020617', '#0B1226'], 180);
      blob(ctx, w, h, 0.5, 1.0, 0.55, '#2563EB', 0.55, t, { ax: 0.12, ay: 0.03, period: 30 });
      const step = Math.min(w, h) / 18;
      // The grid glides diagonally one cell every 12 s: an exact loop.
      const glide = ((t / 12) % 1) * step;
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
      ctx.lineWidth = Math.max(1, Math.min(w, h) / 1080);
      ctx.beginPath();
      for (let x = ((w / 2) % step) + glide - step; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = ((h / 2) % step) + glide - step; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.restore();
    }
  },
  {
    id: 'lime-wave',
    name: 'Lime Wave',
    grain: 0.05,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#0A1208', '#0F1F0B'], 180);
      blob(ctx, w, h, 0.8, 0.15, 0.4, '#84CC16', 0.35, t, { period: 27 });
      wave(ctx, w, h, 0.55, 0.06, 0.8, 0.3, vertical(ctx, h, 0.45, 1, rgba('#A3E635', 0.55), rgba('#365314', 0.2)), t, 34);
      wave(ctx, w, h, 0.68, 0.05, 1.1, 2.4, vertical(ctx, h, 0.6, 1, rgba('#65A30D', 0.6), rgba('#1A2E05', 0.3)), t, 27);
      wave(ctx, w, h, 0.82, 0.04, 1.4, 4.6, vertical(ctx, h, 0.75, 1, rgba('#3F6212', 0.85), '#0A1208'), t, 21);
    }
  },
  {
    id: 'paper-light',
    name: 'Paper Light',
    grain: 0.05,
    draw(ctx, w, h, t) {
      base(ctx, w, h, ['#FAFAF9', '#F1F0EE'], 180);
      blob(ctx, w, h, 0.15, 0.1, 0.5, '#FFFFFF', 0.9, t, { period: 32 });
      blob(ctx, w, h, 0.9, 0.95, 0.45, '#D6D3D1', 0.35, t, { period: 28, phase: 2.5 });
    }
  }
];

const BY_ID = new Map(WALLPAPERS.map((w) => [w.id, w]));

export function getWallpaper(id: string): Wallpaper | undefined {
  return BY_ID.get(id);
}

/**
 * Draws a wallpaper filling w x h at time t (seconds of motion; 0 = still); an unknown
 * id is a neutral dark fill. `grain: false` leaves the grain out (the caller adds it,
 * e.g. at full resolution over a design rendered smaller).
 */
export function drawWallpaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  id: string,
  t = 0,
  options: { grain?: boolean } = {}
): void {
  const wallpaper = BY_ID.get(id);
  ctx.save();
  if (wallpaper) {
    wallpaper.draw(ctx, w, h, Number.isFinite(t) ? t : 0);
    if (options.grain !== false) drawGrain(ctx, w, h, wallpaper.grain);
  } else {
    ctx.fillStyle = '#0B0C10';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Grain strength of a wallpaper (0 for an unknown id). */
export function wallpaperGrain(id: string): number {
  return BY_ID.get(id)?.grain ?? 0;
}

const thumbnails = new Map<string, string>();
/** A small preview of a wallpaper as a data: URL (local, no request), rendered once. */
export function getWallpaperThumbnail(id: string): string {
  const cached = thumbnails.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 108;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawWallpaper(ctx, canvas.width, canvas.height, id);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  thumbnails.set(id, url);
  return url;
}

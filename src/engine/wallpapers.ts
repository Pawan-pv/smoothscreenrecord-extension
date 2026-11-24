/**
 * Built-in wallpapers, generated in code (the extension makes no network
 * requests, so nothing is downloaded and no image files ship).
 *
 * Every design is drawn with sizes that are fractions of the canvas, and every
 * random detail comes from a seeded generator, so a wallpaper has the same
 * composition at every size and on every render: the preview and a 4K export
 * match, and both are sharp. (Only the fine film grain is per pixel.)
 */

export interface Wallpaper {
  id: string;
  name: string;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

/** mulberry32: small, fast, seeded. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

/** Vertical / angled base gradient over the whole canvas (angle in CSS degrees). */
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

/** A soft glow: a radial gradient fading to transparent. Position and radius are fractions. */
function blob(ctx: CanvasRenderingContext2D, w: number, h: number, fx: number, fy: number, fr: number, color: string, alpha: number): void {
  const r = fr * Math.max(w, h);
  const x = fx * w;
  const y = fy * h;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.55));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A filled wave band from a baseline (fraction of h) down to the bottom edge. */
function wave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  baseline: number,
  amplitude: number,
  periods: number,
  phase: number,
  fill: string | CanvasGradient
): void {
  ctx.beginPath();
  ctx.moveTo(0, h);
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const y = (baseline + amplitude * Math.sin(p * periods * Math.PI * 2 + phase)) * h;
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
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
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

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, seed: number): void {
  const rnd = seeded(seed);
  const unit = Math.min(w, h) / 1080;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.6 + rnd() * 1.6) * unit;
    ctx.globalAlpha = 0.25 + rnd() * 0.65;
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
    draw(ctx, w, h) {
      base(ctx, w, h, ['#0B0A1F', '#140B2E'], 160);
      blob(ctx, w, h, 0.18, 0.28, 0.55, '#7C3AED', 0.85);
      blob(ctx, w, h, 0.82, 0.18, 0.45, '#EC4899', 0.7);
      blob(ctx, w, h, 0.62, 0.88, 0.55, '#3B82F6', 0.7);
      grain(ctx, w, h, 0.06);
    }
  },
  {
    id: 'aurora-teal',
    name: 'Aurora Teal',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#021417', '#04232A'], 180);
      blob(ctx, w, h, 0.25, 0.75, 0.55, '#14B8A6', 0.8);
      blob(ctx, w, h, 0.78, 0.3, 0.5, '#22C55E', 0.55);
      blob(ctx, w, h, 0.5, 0.05, 0.45, '#06B6D4', 0.6);
      grain(ctx, w, h, 0.06);
    }
  },
  {
    id: 'sunset-dune',
    name: 'Sunset Dune',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#FDBA74', '#F472B6', '#7C3AED'], 180);
      blob(ctx, w, h, 0.5, 0.42, 0.25, '#FEF3C7', 0.75);
      wave(ctx, w, h, 0.66, 0.035, 1.2, 0.4, vertical(ctx, h, 0.6, 1, '#9D4EDD', '#5B21B6'));
      wave(ctx, w, h, 0.76, 0.03, 0.9, 2.1, vertical(ctx, h, 0.7, 1, '#6D28D9', '#3B0764'));
      wave(ctx, w, h, 0.88, 0.025, 1.4, 4.0, vertical(ctx, h, 0.8, 1, '#3B0764', '#1E0533'));
      grain(ctx, w, h, 0.05);
    }
  },
  {
    id: 'ocean-depth',
    name: 'Ocean Depth',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#0C4A6E', '#082F49', '#020617'], 180);
      blob(ctx, w, h, 0.3, 0.0, 0.5, '#38BDF8', 0.45);
      blob(ctx, w, h, 0.85, 0.35, 0.35, '#22D3EE', 0.25);
      wave(ctx, w, h, 0.8, 0.02, 2.0, 0.0, rgba('#0EA5E9', 0.18));
      wave(ctx, w, h, 0.86, 0.025, 1.5, 1.7, rgba('#0284C7', 0.22));
      grain(ctx, w, h, 0.05);
    }
  },
  {
    id: 'mint-glass',
    name: 'Mint Glass',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#ECFDF5', '#E0F2FE'], 135);
      blob(ctx, w, h, 0.2, 0.25, 0.45, '#6EE7B7', 0.7);
      blob(ctx, w, h, 0.85, 0.7, 0.5, '#93C5FD', 0.65);
      blob(ctx, w, h, 0.55, 0.95, 0.35, '#A7F3D0', 0.6);
      grain(ctx, w, h, 0.04);
    }
  },
  {
    id: 'peach-blobs',
    name: 'Peach',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#FFF7ED', '#FFE4E6'], 160);
      blob(ctx, w, h, 0.15, 0.8, 0.45, '#FDBA74', 0.75);
      blob(ctx, w, h, 0.75, 0.2, 0.45, '#FCA5A5', 0.65);
      blob(ctx, w, h, 0.9, 0.9, 0.35, '#F9A8D4', 0.6);
      grain(ctx, w, h, 0.04);
    }
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#FBCFE8', '#E9D5FF', '#C7D2FE'], 120);
      blob(ctx, w, h, 0.3, 0.35, 0.4, '#FFFFFF', 0.55);
      blob(ctx, w, h, 0.8, 0.75, 0.35, '#F0ABFC', 0.45);
      grain(ctx, w, h, 0.04);
    }
  },
  {
    id: 'nebula',
    name: 'Nebula',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#05010F', '#0B0420'], 180);
      blob(ctx, w, h, 0.3, 0.4, 0.4, '#9333EA', 0.55);
      blob(ctx, w, h, 0.65, 0.55, 0.35, '#DB2777', 0.45);
      blob(ctx, w, h, 0.5, 0.3, 0.25, '#2563EB', 0.45);
      stars(ctx, w, h, 220, 42);
      grain(ctx, w, h, 0.05);
    }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#2A2F38', '#111418'], 160);
      blob(ctx, w, h, 0.25, 0.15, 0.6, '#64748B', 0.35);
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      grain(ctx, w, h, 0.07);
    }
  },
  {
    id: 'midnight-grid',
    name: 'Midnight Grid',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#020617', '#0B1226'], 180);
      blob(ctx, w, h, 0.5, 1.0, 0.55, '#2563EB', 0.55);
      const step = Math.min(w, h) / 18;
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
      ctx.lineWidth = Math.max(1, Math.min(w, h) / 1080);
      ctx.beginPath();
      for (let x = (w / 2) % step; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = (h / 2) % step; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.restore();
      grain(ctx, w, h, 0.05);
    }
  },
  {
    id: 'lime-wave',
    name: 'Lime Wave',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#0A1208', '#0F1F0B'], 180);
      blob(ctx, w, h, 0.8, 0.15, 0.4, '#84CC16', 0.35);
      wave(ctx, w, h, 0.55, 0.06, 0.8, 0.3, vertical(ctx, h, 0.45, 1, rgba('#A3E635', 0.55), rgba('#365314', 0.2)));
      wave(ctx, w, h, 0.68, 0.05, 1.1, 2.4, vertical(ctx, h, 0.6, 1, rgba('#65A30D', 0.6), rgba('#1A2E05', 0.3)));
      wave(ctx, w, h, 0.82, 0.04, 1.4, 4.6, vertical(ctx, h, 0.75, 1, rgba('#3F6212', 0.85), '#0A1208'));
      grain(ctx, w, h, 0.05);
    }
  },
  {
    id: 'paper-light',
    name: 'Paper Light',
    draw(ctx, w, h) {
      base(ctx, w, h, ['#FAFAF9', '#F1F0EE'], 180);
      blob(ctx, w, h, 0.15, 0.1, 0.5, '#FFFFFF', 0.9);
      blob(ctx, w, h, 0.9, 0.95, 0.45, '#D6D3D1', 0.35);
      grain(ctx, w, h, 0.05);
    }
  }
];

const BY_ID = new Map(WALLPAPERS.map((w) => [w.id, w]));

export function getWallpaper(id: string): Wallpaper | undefined {
  return BY_ID.get(id);
}

/** Draws a wallpaper filling w x h; an unknown id is a neutral dark fill. */
export function drawWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number, id: string): void {
  const wallpaper = BY_ID.get(id);
  ctx.save();
  if (wallpaper) {
    wallpaper.draw(ctx, w, h);
  } else {
    ctx.fillStyle = '#0B0C10';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
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

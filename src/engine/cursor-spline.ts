import { MousePoint, ClickEvent, CursorTheme } from '../types/telemetry';

export interface InterpolatedCursor {
  x: number;
  y: number;
  style: string;
  vx: number;
  vy: number;
  speed: number;
}

// Catmull-Rom spline interpolation between 4 points
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export class CursorSplineEngine {
  private mousePoints: MousePoint[] = [];
  private clicks: ClickEvent[] = [];

  constructor(mousePoints: MousePoint[] = [], clicks: ClickEvent[] = []) {
    this.setData(mousePoints, clicks);
  }

  public setData(mousePoints: MousePoint[], clicks: ClickEvent[]) {
    this.mousePoints = [...mousePoints].sort((a, b) => a.t - b.t);
    this.clicks = [...clicks].sort((a, b) => a.t - b.t);
  }

  public getCursorAt(timeMs: number): InterpolatedCursor {
    if (this.mousePoints.length === 0) {
      return { x: 0, y: 0, style: 'default', vx: 0, vy: 0, speed: 0 };
    }

    if (timeMs <= this.mousePoints[0].t) {
      const p = this.mousePoints[0];
      return { x: p.x, y: p.y, style: p.c, vx: 0, vy: 0, speed: 0 };
    }

    const last = this.mousePoints[this.mousePoints.length - 1];
    if (timeMs >= last.t) {
      return { x: last.x, y: last.y, style: last.c, vx: 0, vy: 0, speed: 0 };
    }

    // Binary search for closest points surrounding timeMs
    let low = 0;
    let high = this.mousePoints.length - 1;
    let index = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.mousePoints[mid].t <= timeMs) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const i1 = index;
    const i2 = Math.min(this.mousePoints.length - 1, i1 + 1);
    const i0 = Math.max(0, i1 - 1);
    const i3 = Math.min(this.mousePoints.length - 1, i2 + 1);

    const p0 = this.mousePoints[i0];
    const p1 = this.mousePoints[i1];
    const p2 = this.mousePoints[i2];
    const p3 = this.mousePoints[i3];

    const segmentDuration = p2.t - p1.t;
    const t = segmentDuration > 0 ? (timeMs - p1.t) / segmentDuration : 0;
    const clampedT = Math.max(0, Math.min(1, t));

    // Use Catmull-Rom for rapid 120Hz micro-movements (< 120ms), linear blend for pauses to prevent spline overshooting
    let x: number;
    let y: number;
    if (segmentDuration > 120) {
      x = p1.x + (p2.x - p1.x) * clampedT;
      y = p1.y + (p2.y - p1.y) * clampedT;
    } else {
      x = catmullRom(p0.x, p1.x, p2.x, p3.x, clampedT);
      y = catmullRom(p0.y, p1.y, p2.y, p3.y, clampedT);
    }

    // Calculate instantaneous velocity in pixels/second
    const dt = Math.max(0.001, segmentDuration / 1000);
    const vx = segmentDuration < 300 ? (p2.x - p1.x) / dt : 0;
    const vy = segmentDuration < 300 ? (p2.y - p1.y) / dt : 0;
    const speed = Math.hypot(vx, vy);

    return {
      x,
      y,
      style: p1.c || 'default',
      vx,
      vy,
      speed
    };
  }

  public getClicks(): ClickEvent[] {
    return this.clicks;
  }

  // Draw crisp 4K vector cursor and physics click ripple rings at specific screen coordinates
  public drawCursorAt(
    ctx: CanvasRenderingContext2D,
    cursor: InterpolatedCursor,
    screenX: number,
    screenY: number,
    currentTimeMs: number,
    ringColor: string = '#8B5CF6',
    activeRipples?: { x: number; y: number; progress: number }[],
    theme: CursorTheme = 'mac-obsidian',
    cursorScale: number = 1.0
  ): void {
    ctx.save();

    // 1. Draw Active Click Ripples
    if (activeRipples && activeRipples.length > 0) {
      for (const ripple of activeRipples) {
        const progress = ripple.progress;
        const radius = (10 + progress * 34) * Math.min(1.4, Math.max(0.8, cursorScale));
        const alpha = Math.max(0, (1 - progress) * 0.85);

        ctx.save();
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Inner solid dot pop
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 2. Motion trail / directional motion blur if moving fast
    if (cursor.speed > 350) {
      ctx.save();
      const blurLen = Math.min(24, cursor.speed * 0.02) * cursorScale;
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(
        screenX - Math.cos(angle) * blurLen,
        screenY - Math.sin(angle) * blurLen
      );
      ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 4 * cursorScale;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor
    ctx.translate(screenX, screenY);
    if (cursorScale !== 1.0) {
      ctx.scale(cursorScale, cursorScale);
    }

    // Subtle drop shadow for vector cursor
    if (theme === 'neon-glow') {
      ctx.shadowColor = '#8B5CF6';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;
    }

    if (cursor.style.includes('pointer') || cursor.style.includes('hand')) {
      // Sleek pointing hand SVG vector
      this.drawHandCursor(ctx, theme);
    } else if (cursor.style.includes('text')) {
      // macOS style I-beam cursor
      this.drawIBeamCursor(ctx, theme);
    } else {
      // Sleek modern Arrow Pointer
      this.drawArrowCursor(ctx, theme);
    }

    ctx.restore();
  }

  // Draw crisp 4K vector cursor and physics click ripple rings (legacy fallback)
  public drawCursor(
    ctx: CanvasRenderingContext2D,
    cursor: InterpolatedCursor,
    currentTimeMs: number,
    ringColor: string = '#8B5CF6'
  ): void {
    ctx.save();

    // 1. Draw Active Click Ripples
    for (const click of this.clicks) {
      const elapsed = currentTimeMs - click.t;
      if (elapsed >= 0 && elapsed <= 500) {
        const progress = elapsed / 500;
        const radius = 10 + progress * 34;
        const alpha = Math.max(0, (1 - progress) * 0.85);

        ctx.save();
        ctx.beginPath();
        ctx.arc(click.x, click.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Inner solid dot pop
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(click.x, click.y, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 2. Motion trail / directional motion blur if moving fast
    if (cursor.speed > 350) {
      ctx.save();
      const blurLen = Math.min(24, cursor.speed * 0.02);
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(cursor.x, cursor.y);
      ctx.lineTo(
        cursor.x - Math.cos(angle) * blurLen,
        cursor.y - Math.sin(angle) * blurLen
      );
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor
    ctx.translate(cursor.x, cursor.y);

    // Subtle drop shadow for vector cursor
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;

    if (cursor.style.includes('pointer') || cursor.style.includes('hand')) {
      // Sleek pointing hand SVG vector
      this.drawHandCursor(ctx);
    } else if (cursor.style.includes('text')) {
      // macOS style I-beam cursor
      this.drawIBeamCursor(ctx);
    } else {
      // Sleek modern Arrow Pointer
      this.drawArrowCursor(ctx);
    }

    ctx.restore();
  }

  private drawArrowCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 19);
    ctx.lineTo(5.2, 14.8);
    ctx.lineTo(9.5, 23.5);
    ctx.lineTo(13, 22);
    ctx.lineTo(8.5, 13.5);
    ctx.lineTo(15, 13.5);
    ctx.closePath();

    if (theme === 'neon-glow') {
      ctx.fillStyle = '#8B5CF6'; // Vibrant electric violet
      ctx.fill();
      ctx.strokeStyle = '#F3E8FF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (theme === 'minimal-white') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#0F1117'; // Crisp obsidian black fill
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; // Crisp white outline
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  private drawHandCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.translate(-4, -1);
    ctx.scale(0.85, 0.85);

    ctx.beginPath();
    // Index finger pointing up
    ctx.moveTo(8, 2);
    ctx.lineTo(8, 12);
    ctx.lineTo(6, 12);
    ctx.lineTo(6, 14);
    ctx.lineTo(4, 15);
    ctx.lineTo(4, 21);
    ctx.quadraticCurveTo(4, 25, 9, 25);
    ctx.lineTo(16, 25);
    ctx.quadraticCurveTo(20, 25, 20, 21);
    ctx.lineTo(20, 13);
    ctx.quadraticCurveTo(20, 11, 18, 11);
    ctx.quadraticCurveTo(16, 11, 16, 13);
    ctx.lineTo(16, 11);
    ctx.quadraticCurveTo(16, 9, 14, 9);
    ctx.quadraticCurveTo(12, 9, 12, 11);
    ctx.lineTo(12, 2);
    ctx.quadraticCurveTo(10, 0, 8, 2);
    ctx.closePath();

    if (theme === 'neon-glow') {
      ctx.fillStyle = '#8B5CF6';
      ctx.fill();
      ctx.strokeStyle = '#F3E8FF';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (theme === 'minimal-white') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#0F1117';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  private drawIBeamCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.translate(0, -9);
    ctx.beginPath();
    // Top bar
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    // Vertical stem
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 18);
    // Bottom bar
    ctx.moveTo(-5, 18);
    ctx.lineTo(5, 18);

    if (theme === 'neon-glow') {
      ctx.strokeStyle = '#C084FC';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else if (theme === 'minimal-white') {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(0, 17);
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(0, 17);
      ctx.strokeStyle = '#0F1117';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

import { MousePoint, ClickEvent, CursorTheme, PressEvent, CursorStyle } from '../types/telemetry';

export interface InterpolatedCursor {
  x: number;
  y: number;
  style: string;
  vx: number;
  vy: number;
  speed: number;
  opacity: number;
}

export interface CursorSplineOptions {
  smoothing?: number;
  cutRanges?: Array<{ startTime: number; endTime: number }>;
  trimStartMs?: number;
  trimEndMs?: number;
}

export const CURSOR_IDLE_TIMEOUT_MS = 1500;
export const CURSOR_IDLE_FADE_MS = 300;

export function getPressScale(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  return 0.85 + 0.15 * eased;
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
  private filteredMousePoints: MousePoint[] = [];
  private clicks: ClickEvent[] = [];
  private pressEvents: PressEvent[] = [];
  private activityTimestamps: number[] = [];
  private smoothing = 0.6;
  private cutRanges: Array<{ startTime: number; endTime: number }> = [];
  /**
   * The filtered trajectory depends ONLY on the raw points and the smoothing
   * strength. Trim handles, silence cuts and every other option leave it alone,
   * so it is rebuilt only when one of those two changed.
   */
  private filterDirty = true;

  constructor(mousePoints: MousePoint[] = [], clicks: ClickEvent[] = [], pressEvents: PressEvent[] = [], options: CursorSplineOptions = {}) {
    this.setData(mousePoints, clicks, pressEvents, options);
  }

  public setData(mousePoints: MousePoint[], clicks: ClickEvent[], pressEvents: PressEvent[] = [], options: CursorSplineOptions = {}) {
    this.mousePoints = [...mousePoints].sort((a, b) => a.t - b.t);
    this.filterDirty = true;
    this.clicks = [...clicks].sort((a, b) => a.t - b.t);
    this.pressEvents = [...pressEvents].sort((a, b) => a.t - b.t);
    this.setOptions(options);

    const activities: number[] = [];
    for (const c of this.clicks) {
      if (Number.isFinite(c.t)) {
        activities.push(c.t);
      }
    }

    if (this.mousePoints.length > 0) {
      activities.push(this.mousePoints[0].t);
      for (let i = 1; i < this.mousePoints.length; i++) {
        const prev = this.mousePoints[i - 1];
        const curr = this.mousePoints[i];
        if (curr.x !== prev.x || curr.y !== prev.y) {
          activities.push(curr.t);
        }
      }
    }

    activities.sort((a, b) => a - b);
    this.activityTimestamps = activities.filter((t, idx) => idx === 0 || t !== activities[idx - 1]);
  }

  public setOptions(options: CursorSplineOptions = {}): void {
    if (typeof options.smoothing === 'number' && Number.isFinite(options.smoothing)) {
      const next = Math.max(0, Math.min(1, options.smoothing));
      if (next !== this.smoothing) this.filterDirty = true;
      this.smoothing = next;
    }
    if (options.cutRanges) {
      this.cutRanges = options.cutRanges
        .filter((range) => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime)
        .map((range) => ({ startTime: range.startTime, endTime: range.endTime }))
        .sort((a, b) => a.startTime - b.startTime);
    }
    if (this.filterDirty) {
      this.rebuildFilteredMousePoints();
      this.filterDirty = false;
    }
  }

  /** Build a centred, zero-phase trajectory before Catmull-Rom interpolation. */
  private rebuildFilteredMousePoints(): void {
    if (this.mousePoints.length === 0 || this.smoothing <= 0) {
      this.filteredMousePoints = this.mousePoints.map((point) => ({ ...point }));
      return;
    }

    const maxCoordinate = this.mousePoints.reduce((max, point) => Math.max(max, Math.abs(point.x), Math.abs(point.y)), 0);
    const coordinateScale = maxCoordinate <= 1.01 ? 1 / 1920 : 1;
    const deadband = 2 * coordinateScale;
    const sigmaMs = 18 + this.smoothing * 55;
    const radiusMs = sigmaMs * 3;
    const filtered: MousePoint[] = [];
    const points = this.mousePoints;

    // Telemetry timestamps are whole milliseconds, so the Gaussian weight of a
    // candidate is a lookup by its integer distance. (A fractional distance
    // falls back to the exact formula, so the result never differs.)
    const weightAt = new Float64Array(Math.floor(radiusMs) + 1);
    for (let d = 0; d < weightAt.length; d++) weightAt[d] = Math.exp(-0.5 * (d / sigmaMs) ** 2);

    // The points are sorted by time, so the window [t - radius, t + radius] only
    // ever slides forward: each point looks at the ~2*radius/dt samples around
    // it (about 55 at 120 Hz), never at the whole recording. O(N).
    let windowStart = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      while (windowStart < i && point.t - points[windowStart].t > radiusMs) windowStart++;
      let weightSum = 0;
      let x = 0;
      let y = 0;
      for (let j = windowStart; j < points.length; j++) {
        const candidate = points[j];
        const distance = Math.abs(candidate.t - point.t);
        if (distance > radiusMs) {
          if (candidate.t > point.t) break;
          continue;
        }
        const weight = Number.isInteger(distance) ? weightAt[distance] : Math.exp(-0.5 * (distance / sigmaMs) ** 2);
        weightSum += weight;
        x += candidate.x * weight;
        y += candidate.y * weight;
      }
      const previous = filtered[i - 1];
      let nextX = weightSum > 0 ? x / weightSum : point.x;
      let nextY = weightSum > 0 ? y / weightSum : point.y;
      if (previous) {
        const dt = Math.max(1, point.t - this.mousePoints[i - 1].t);
        const rawDistance = Math.hypot(point.x - this.mousePoints[i - 1].x, point.y - this.mousePoints[i - 1].y);
        const filteredDistance = Math.hypot(nextX - previous.x, nextY - previous.y);
        if (filteredDistance < deadband && rawDistance / dt * 1000 < 120 * coordinateScale) {
          nextX = previous.x;
          nextY = previous.y;
        }
      }
      filtered.push({ ...point, x: nextX, y: nextY });
    }
    if (filtered.length > 0) filtered[0] = { ...this.mousePoints[0] };
    if (filtered.length > 1) filtered[filtered.length - 1] = { ...this.mousePoints[this.mousePoints.length - 1] };
    this.filteredMousePoints = filtered;
  }

  private pinToClick(timeMs: number, x: number, y: number): { x: number; y: number } {
    const click = this.clicks.reduce<ClickEvent | null>((nearest, candidate) => {
      if (Math.abs(candidate.t - timeMs) > 60) return nearest;
      return !nearest || Math.abs(candidate.t - timeMs) < Math.abs(nearest.t - timeMs) ? candidate : nearest;
    }, null);
    if (!click) return { x, y };
    const normalized = 1 - Math.abs(click.t - timeMs) / 60;
    const weight = normalized * normalized * (3 - 2 * normalized);
    return { x: x + (click.x - x) * weight, y: y + (click.y - y) * weight };
  }

  public getCursorOpacityAt(timeMs: number): number {
    if (this.activityTimestamps.length === 0) {
      return 1.0;
    }

    let low = 0;
    let high = this.activityTimestamps.length - 1;
    let lastActivity = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.activityTimestamps[mid] <= timeMs) {
        lastActivity = this.activityTimestamps[mid];
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let idleMs: number;
    if (lastActivity === -1) {
      idleMs = Math.max(0, timeMs);
    } else {
      idleMs = Math.max(0, timeMs - lastActivity);
    }

    if (idleMs <= CURSOR_IDLE_TIMEOUT_MS) {
      return 1.0;
    }
    if (idleMs >= CURSOR_IDLE_TIMEOUT_MS + CURSOR_IDLE_FADE_MS) {
      return 0.0;
    }

    const progress = (idleMs - CURSOR_IDLE_TIMEOUT_MS) / CURSOR_IDLE_FADE_MS;
    return 0.5 * (1 + Math.cos(Math.PI * progress));
  }

  public getCursorAt(timeMs: number): InterpolatedCursor {
    const opacity = this.getCursorOpacityAt(timeMs);

    if (this.mousePoints.length === 0) {
      return { x: 0, y: 0, style: 'default', vx: 0, vy: 0, speed: 0, opacity };
    }

    const points = this.filteredMousePoints.length > 0 ? this.filteredMousePoints : this.mousePoints;

    if (timeMs <= this.mousePoints[0].t) {
      const p = points[0];
      const pinned = this.pinToClick(timeMs, p.x, p.y);
      return { x: pinned.x, y: pinned.y, style: this.mousePoints[0].c, vx: 0, vy: 0, speed: 0, opacity };
    }

    const seamCut = this.cutRanges.find((range) => timeMs >= range.startTime && timeMs <= range.endTime + 80);
    if (seamCut) {
      const postCutIndex = points.findIndex((point) => point.t >= seamCut.endTime);
      const postCut = postCutIndex >= 0 ? points[postCutIndex] : points[points.length - 1];
      const rawPostCut = postCutIndex >= 0 ? this.mousePoints[postCutIndex] : this.mousePoints[this.mousePoints.length - 1];
      const seamProgress = timeMs <= seamCut.endTime ? 0 : Math.min(1, (timeMs - seamCut.endTime) / 80);
      return {
        x: rawPostCut.x,
        y: rawPostCut.y,
        style: rawPostCut.c,
        vx: 0,
        vy: 0,
        speed: 0,
        opacity: opacity * seamProgress
      };
    }

    const last = points[points.length - 1];
    if (timeMs >= last.t) {
      const pinned = this.pinToClick(timeMs, last.x, last.y);
      return { x: pinned.x, y: pinned.y, style: this.mousePoints[this.mousePoints.length - 1].c, vx: 0, vy: 0, speed: 0, opacity };
    }

    // Binary search for closest points surrounding timeMs
    let low = 0;
    let high = points.length - 1;
    let index = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].t <= timeMs) {
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

    const p0 = points[i0];
    const p1 = points[i1];
    const p2 = points[i2];
    const p3 = points[i3];
    const rawP1 = this.mousePoints[i1];

    const crossesCut = this.cutRanges.some((range) => p1.t < range.startTime && p2.t > range.endTime);
    if (crossesCut) {
      const cut = this.cutRanges.find((range) => p1.t < range.startTime && p2.t > range.endTime);
      const before = timeMs < (cut?.startTime || timeMs);
      const seamRawPoint = before ? this.mousePoints[i1] : this.mousePoints[i2];
      return {
        x: seamRawPoint.x,
        y: seamRawPoint.y,
        style: seamRawPoint.c,
        vx: 0,
        vy: 0,
        speed: 0,
        opacity
      };
    }

    const segmentDuration = p2.t - p1.t;
    const t = segmentDuration > 0 ? (timeMs - p1.t) / segmentDuration : 0;
    const clampedT = Math.max(0, Math.min(1, t));

    // Use Catmull-Rom for rapid 120Hz micro-movements (< 120ms), linear blend for pauses to prevent spline overshooting
    let x: number;
    let y: number;
    const linearX = p1.x + (p2.x - p1.x) * clampedT;
    const linearY = p1.y + (p2.y - p1.y) * clampedT;
    if (segmentDuration > 120) {
      x = linearX;
      y = linearY;
    } else {
      const splineX = catmullRom(p0.x, p1.x, p2.x, p3.x, clampedT);
      const splineY = catmullRom(p0.y, p1.y, p2.y, p3.y, clampedT);
      x = linearX + (splineX - linearX) * this.smoothing;
      y = linearY + (splineY - linearY) * this.smoothing;
    }

    // Calculate instantaneous velocity in pixels/second
    const dt = Math.max(0.001, segmentDuration / 1000);
    const vx = segmentDuration < 300 ? (p2.x - p1.x) / dt : 0;
    const vy = segmentDuration < 300 ? (p2.y - p1.y) / dt : 0;
    const speed = Math.hypot(vx, vy);

    const pinned = this.pinToClick(timeMs, x, y);
    return {
      x: pinned.x,
      y: pinned.y,
      style: rawP1.c || 'default',
      vx,
      vy,
      speed,
      opacity
    };
  }

  public getClicks(): ClickEvent[] {
    return this.clicks;
  }

  public getPressScaleAt(timeMs: number): number {
    const latestDown = [...this.pressEvents].reverse().find((event) => event.t <= timeMs && event.type === 'down');
    const latestUp = [...this.pressEvents].reverse().find((event) => event.t <= timeMs && event.type === 'up');
    if (latestDown && (!latestUp || latestDown.t > latestUp.t)) return 0.85;
    const latestClick = [...this.clicks].reverse().find((click) => click.t <= timeMs && timeMs - click.t <= 140);
    return latestClick ? getPressScale((timeMs - latestClick.t) / 140) : 1;
  }

  public getTrailAt(timeMs: number, maxSamples = 4, outputFps = 60): InterpolatedCursor[] {
    if (outputFps <= 20) return [];
    const current = this.getCursorAt(timeMs);
    if (current.speed * 1920 <= 350 || current.opacity <= 0.001) return [];
    const trail: InterpolatedCursor[] = [];
    const sampleMs = 1000 / Math.max(30, outputFps);
    for (let i = 1; i <= maxSamples; i++) {
      const sampleTime = timeMs - sampleMs * i;
      if (this.cutRanges.some((range) => sampleTime <= range.endTime + 120 && timeMs >= range.startTime)) return [];
      const sample = this.getCursorAt(sampleTime);
      trail.push({ ...sample, opacity: current.opacity * (1 - i / (maxSamples + 1)) * 0.24 });
    }
    return trail;
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
    cursorScale: number = 1.0,
    canvasScale: number = 1.0,
    trailPoints: Array<{ x: number; y: number; opacity: number }> = []
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
    const cursorOpacity = typeof cursor.opacity === 'number' ? cursor.opacity : 1.0;
    if (cursorOpacity <= 0.001) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * cursorOpacity));
    const pressScale = this.getPressScaleAt(currentTimeMs);
    const outputScale = Math.max(0.75, Math.min(2, canvasScale));

    if (trailPoints.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * cursorScale * outputScale;
      for (let i = trailPoints.length - 1; i > 0; i--) {
        const from = trailPoints[i];
        const to = trailPoints[i - 1];
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(168, 85, 247, 0.35)' : 'rgba(255, 255, 255, 0.20)';
        ctx.globalAlpha = Math.max(0, Math.min(1, from.opacity));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Handles normalized (0..1) speeds (scaled to ~1920px equivalent) as well as legacy pixel speeds
    const effectiveSpeed = cursor.x <= 1.0 ? cursor.speed * 1920 : cursor.speed;
    if (effectiveSpeed > 350) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02) * cursorScale * outputScale;
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(
        screenX - Math.cos(angle) * blurLen,
        screenY - Math.sin(angle) * blurLen
      );
      ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 4 * cursorScale * outputScale;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor
    ctx.translate(screenX, screenY);
    if (pressScale < 0.999) {
      ctx.beginPath();
      ctx.arc(0, 0, 18 * cursorScale * outputScale, 0, Math.PI * 2);
      ctx.strokeStyle = theme === 'neon-glow' ? 'rgba(192, 132, 252, 0.30)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2 * outputScale;
      ctx.globalAlpha *= 0.7;
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, Math.min(1, cursorOpacity));
    }
    if (cursorScale * pressScale * outputScale !== 1.0) {
      ctx.scale(cursorScale * pressScale * outputScale, cursorScale * pressScale * outputScale);
    }

    // Subtle drop shadow for vector cursor
    if (theme === 'neon-glow') {
      ctx.shadowColor = '#8B5CF6';
      ctx.shadowBlur = 14 * outputScale;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8 * outputScale;
      ctx.shadowOffsetX = 1 * outputScale;
      ctx.shadowOffsetY = 2 * outputScale;
    }

    if (cursor.style === 'pointer') {
      // Sleek pointing hand SVG vector
      this.drawHandCursor(ctx, theme);
    } else if (cursor.style === 'text') {
      // macOS style I-beam cursor
      this.drawIBeamCursor(ctx, theme);
    } else if (cursor.style === 'grab') {
      this.drawGrabCursor(ctx, theme);
    } else if (cursor.style === 'grabbing') {
      this.drawGrabbingCursor(ctx, theme);
    } else {
      // Sleek modern Arrow Pointer
      this.drawArrowCursor(ctx, theme);
    }

    ctx.restore();
  }

  private drawGrabCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    this.drawHandCursor(ctx, theme);
  }

  private drawGrabbingCursor(ctx: CanvasRenderingContext2D, theme: CursorTheme = 'mac-obsidian') {
    ctx.save();
    ctx.scale(0.9, 0.9);
    this.drawHandCursor(ctx, theme);
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

    const canvasW = ctx.canvas?.width || 1920;
    const canvasH = ctx.canvas?.height || 1080;

    // 1. Draw Active Click Ripples
    for (const click of this.clicks) {
      const elapsed = currentTimeMs - click.t;
      if (elapsed >= 0 && elapsed <= 500) {
        const progress = elapsed / 500;
        const radius = 10 + progress * 34;
        const alpha = Math.max(0, (1 - progress) * 0.85);

        const clickX = click.x <= 1.0 ? click.x * canvasW : click.x;
        const clickY = click.y <= 1.0 ? click.y * canvasH : click.y;

        ctx.save();
        ctx.beginPath();
        ctx.arc(clickX, clickY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Inner solid dot pop
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(clickX, clickY, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    const cursorX = cursor.x <= 1.0 ? cursor.x * canvasW : cursor.x;
    const cursorY = cursor.y <= 1.0 ? cursor.y * canvasH : cursor.y;
    const effectiveSpeed = cursor.x <= 1.0 ? cursor.speed * canvasW : cursor.speed;

    // 2. Motion trail / directional motion blur if moving fast
    if (effectiveSpeed > 350) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02);
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(cursorX, cursorY);
      ctx.lineTo(
        cursorX - Math.cos(angle) * blurLen,
        cursorY - Math.sin(angle) * blurLen
      );
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render High-Resolution Vector Cursor
    ctx.translate(cursorX, cursorY);

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

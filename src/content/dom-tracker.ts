import {
  MousePoint,
  ClickEvent,
  KeystrokeEvent,
  InputFocusEvent,
  TelemetryData,
  TypingSession,
  BoundingBox,
  ScrollEvent,
  VisibilityEvent,
  CursorStyle,
  PressEvent,
  ScreenLayout
} from '../types/telemetry';
import {
  applyAutoRedaction,
  startElementPicker,
  stopElementPicker,
  resetRedactions,
  isSensitiveElement,
  isSensitiveString
} from './privacy-redactor';
import { TelemetryBatch, TelemetrySegment, batchIsEmpty } from '../background/telemetry-merge';

// Idempotence: a tab can receive this file again when the service worker repairs
// a missing receiver. The message listener below is guarded by
// `__smoothstudio_dom_listener_registered`, so a second evaluation never adds a
// second listener.

let isRecording = false;
let startTime = 0;
let mousePoints: MousePoint[] = [];
let clicks: ClickEvent[] = [];
let keystrokes: KeystrokeEvent[] = [];
let inputEvents: InputFocusEvent[] = [];
let typingSessions: TypingSession[] = [];
let scrollEvents: ScrollEvent[] = [];
let visibilityEvents: VisibilityEvent[] = [];
let pressEvents: PressEvent[] = [];

let lastMouseX = 0;
let lastMouseY = 0;
let lastCursor: CursorStyle = 'default';
/** performance.now() of the last cursor-style read (elementFromPoint is not free). */
let lastSampleTime = 0;
let lastScrollTime = 0;
/**
 * Every pointer move is recorded with its own event time (moves are dispatched at most
 * once per display frame, so this is ~60-144 a second while moving). The editor
 * resamples the path onto an even time grid before smoothing, so the device's event
 * rate does not matter. (Stamping the latest position with a 16 ms timer's time, as
 * before, made samples repeat and then jump: visible micro-stutter.)
 * The timer below only pins a pointer that rests, every STILL_SAMPLE_MS.
 */
const SAMPLE_INTERVAL_MS = 16;
const CURSOR_STYLE_READ_MS = 50;
/** A pointer that has not moved is sampled this often (instead of every 16 ms). */
const STILL_SAMPLE_MS = 100;
/** No sample before the first real pointer position (never a made-up (0,0)). */
let hasPointer = false;
/**
 * The pointer is over an iframe this page cannot see into: its moves arrive later,
 * forwarded by the frame (ingestFrameEvents). The sampler pauses meanwhile so it
 * never records the stale position in between.
 */
let pointerInOpaqueFrame = false;
/**
 * The pointer is over this page (it moved here and has not left the viewport).
 * Several tabs can be tracked at once (a screen recording follows tab switches):
 * only the page that owns the pointer records it, never a stale position.
 */
let pointerInside = false;

/**
 * The pointer left the viewport (relatedTarget null: out of the page, not into a child).
 * A leave marker is recorded: the cursor is not on the page from here until it moves
 * back, so the editor fades it out instead of leaving it frozen at the edge.
 */
function handlePointerLeave(e: MouseEvent) {
  if (e.relatedTarget) return;
  pointerInside = false;
  if (isRecording && hasPointer) recordPointSample(eventRelativeTime(e), lastMouseX, lastMouseY, true);
}
let sampleTimer: ReturnType<typeof setInterval> | null = null;

export function normalizeCursorStyle(raw: string): CursorStyle {
  const value = (raw || '').trim().toLowerCase();
  if (value.includes('pointer')) return 'pointer';
  if (value === 'text' || value === 'vertical-text') return 'text';
  if (value === 'grab') return 'grab';
  if (value === 'grabbing') return 'grabbing';
  if (value === 'not-allowed' || value === 'no-drop') return 'not-allowed';
  if (value === 'crosshair') return 'crosshair';
  return 'default';
}

function readCursorStyle(e: MouseEvent): CursorStyle {
  try {
    const doc = (e.target as Node)?.ownerDocument || document;
    const target = doc.elementFromPoint(e.clientX, e.clientY);
    if (target) return normalizeCursorStyle((doc.defaultView || window).getComputedStyle(target).cursor || 'default');
  } catch {
    // Fall back to the stable default cursor when a frame is unavailable.
  }
  return 'default';
}

/**
 * Shared timeline origin.
 * The recorder publishes the wall-clock timestamp of the first captured video
 * frame. Every telemetry timestamp is measured against that exact instant so
 * video time and telemetry time are directly comparable (no per-page drift).
 */
let originEpoch = 0;
/** Recording session id handed over by START_TELEMETRY (M1-08). */
let sessionId: string | null = null;
/**
 * QA-029: the recorder starts PAUSED and goes live at the instant the recorded
 * tab's HUD is actually on screen. This content script owns that instant: it
 * sends HUD_VISIBLE with the epoch, and re-bases its telemetry clock to it, so
 * video t=0 and telemetry t=0 are the same wall-clock moment.
 */
let hudLiveSent = false;
/**
 * True once the recorder's own live instant (TIMELINE_ORIGIN) is applied: it is the
 * video's t = 0 and final. The HUD becoming visible later must not re-base the clock
 * again (that erased every click recorded so far and shifted the rest off the video).
 */
let timelineOriginFixed = false;
let hudVisibilityListener: (() => void) | null = null;
let hudFallbackTimer: ReturnType<typeof setTimeout> | null = null;
/** QA-037: the HUD timer is re-based to the recorder's real live instant. */
let hudTimerEl: HTMLElement | null = null;
let hudTimerStart = 0;
/** After this long hidden, record what is on screen anyway (never hang). */
const HUD_VISIBLE_FALLBACK_MS = 5000;

function epochNow(): number {
  // performance.timeOrigin + performance.now() is a high resolution wall clock
  return performance.timeOrigin + performance.now();
}

function getRelativeTime(): number {
  if (!originEpoch) return 0;
  return epochNow() - originEpoch;
}

/**
 * Timeline time of an input EVENT: when the browser received it (event.timeStamp, on
 * the clock of the window it fired in, e.g. a same-origin iframe), not when our
 * handler ran. Exact timing is what keeps a recorded movement smooth.
 */
function eventRelativeTime(e: Event): number {
  if (!originEpoch) return 0;
  const view = (e as UIEvent).view as (Window & typeof globalThis) | null | undefined;
  let origin = performance.timeOrigin;
  try {
    if (view && view.performance) origin = view.performance.timeOrigin;
  } catch { /* a window we cannot read: our own clock */ }
  const at = origin + e.timeStamp;
  // A timestamp that is not on a sensible clock (very old browsers): the handler time.
  const now = epochNow();
  return Number.isFinite(at) && Math.abs(now - at) < 2000 ? at - originEpoch : now - originEpoch;
}

/** Human readable label for an element (form field name, button caption...). */
function describeElement(el: HTMLElement | null): string {
  if (!el) return '';
  const tag = el.tagName.toLowerCase();

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const id = el.id || '';
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label && label.textContent) {
        const t = label.textContent.replace(/[:*]/g, '').trim();
        if (t) return t;
      }
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const ph = el.getAttribute('placeholder');
    if (ph) return ph.trim();
    const name = el.getAttribute('name');
    if (name) return name.trim();
    return id || tag;
  }

  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 60);
  return el.id || tag;
}

// Extract website brand colors to automatically style the video background
export function extractBrandColors(): { primary: string; secondary: string; accent: string; background: string } {
  try {
    const metaTheme = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;

    // Search for primary buttons or accent links
    const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'));
    let buttonBg = '#8B5CF6';
    for (const btn of buttons) {
      const bg = window.getComputedStyle(btn).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== bodyBg) {
        buttonBg = bg;
        break;
      }
    }

    return {
      primary: buttonBg || '#8B5CF6',
      secondary: '#6366F1',
      accent: metaTheme || '#EC4899',
      background: bodyBg || '#0B0C10'
    };
  } catch {
    return {
      primary: '#8B5CF6',
      secondary: '#6366F1',
      accent: '#EC4899',
      background: '#0B0C10'
    };
  }
}

export interface NormalizedCoordinates {
  x: number; // 0..1 normalized focal X
  y: number; // 0..1 normalized focal Y
  rawX: number; // raw CSS pixels relative to top viewport
  rawY: number; // raw CSS pixels relative to top viewport
  offsetX: number; // same-origin iframe offset X
  offsetY: number; // same-origin iframe offset Y
}

/**
 * Normalizes capture-time mouse and click coordinates into 0..1 relative to the
 * top-level recording viewport, taking into account capture-time viewport size, DPR,
 * and same-origin iframe offsets.
 */
export function normalizeCaptureCoordinates(
  e: MouseEvent,
  topWindow: Window = window
): NormalizedCoordinates {
  let offsetX = 0;
  let offsetY = 0;

  try {
    const targetNode = e.target as Node | null;
    const targetDoc = targetNode?.ownerDocument || (e.view as Window | null)?.document;
    if (targetDoc && targetDoc !== topWindow.document) {
      let curWin: Window | null = targetDoc.defaultView;
      while (curWin && curWin !== topWindow) {
        const frame = curWin.frameElement as HTMLElement | null;
        if (frame) {
          const rect = frame.getBoundingClientRect();
          offsetX += rect.left;
          offsetY += rect.top;
          curWin = frame.ownerDocument?.defaultView || null;
        } else {
          break;
        }
      }
    }
  } catch {
    // Cross-origin iframe boundaries safely ignored
  }

  const rawX = e.clientX + offsetX;
  const rawY = e.clientY + offsetY;

  const vpW = topWindow.innerWidth || topWindow.document?.documentElement?.clientWidth || 1920;
  const vpH = topWindow.innerHeight || topWindow.document?.documentElement?.clientHeight || 1080;

  const normX = Math.max(0, Math.min(1, rawX / vpW));
  const normY = Math.max(0, Math.min(1, rawY / vpH));

  return { x: normX, y: normY, rawX, rawY, offsetX, offsetY };
}

// DOM tree climbing to find meaningful UI container for smart camera framing
// Strictly uses viewport client coordinates so coordinates match getDisplayMedia viewport
function findParentContainer(target: Element | null, offsetX = 0, offsetY = 0): BoundingBox | undefined {
  if (!target) return undefined;

  const selector = 'dialog, [role="dialog"], [role="alertdialog"], form, [class*="modal"], [class*="card"], [class*="dialog"], section, article, table, nav, aside';
  const container = target.closest(selector) || target;

  const rect = container.getBoundingClientRect();
  return {
    x: rect.left + offsetX,
    y: rect.top + offsetY,
    width: rect.width,
    height: rect.height
  };
}

/**
 * True when the clicked element is something a user operates. Plain page content
 * (a heading, an empty area) is NOT interactive. Used downstream to tell a real UI
 * click from a stray one; when in doubt the answer is true.
 */
export function isInteractiveTarget(target: Element | null, cursor: CursorStyle): boolean {
  if (!target) return true;
  if (cursor === 'pointer') return true;
  try {
    const hit = target.closest?.('button, a, input, textarea, select, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [contenteditable]:not([contenteditable="false"])');
    if (hit) return true;
    if ((target as HTMLElement).isContentEditable) return true;
  } catch {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Where the page sits on the screen. Screen coordinates (event.screenX/Y) are
// shared by every frame of the window, so they place a click made inside a
// cross-origin iframe on the page, and a page click on a window / entire-screen
// recording.
// ---------------------------------------------------------------------------
const CHROME_ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
/** Browser zoom of the page: screen pixels per page CSS pixel, measured from real pointer motion. */
let pageZoom = 1;
/** Last pointer event of the top page: screen position and top-viewport position of the same instant. */
let lastPointer: { screenX: number; screenY: number; rawX: number; rawY: number } | null = null;
let zoomRef: { screenX: number; screenY: number; rawX: number; rawY: number; at: number } | null = null;

function notePointer(e: MouseEvent, rawX: number, rawY: number): void {
  if (!Number.isFinite(e.screenX) || !Number.isFinite(e.screenY) || !Number.isFinite(rawX) || !Number.isFinite(rawY)) return;
  const now = performance.now();
  lastPointer = { screenX: e.screenX, screenY: e.screenY, rawX, rawY };
  if (!zoomRef || now - zoomRef.at > 400) {
    zoomRef = { ...lastPointer, at: now };
    return;
  }
  const dx = rawX - zoomRef.rawX;
  const dy = rawY - zoomRef.rawY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 60) return;
  const ratio = Math.abs(dx) >= Math.abs(dy) ? (e.screenX - zoomRef.screenX) / dx : (e.screenY - zoomRef.screenY) / dy;
  if (ratio > 0.2 && ratio < 6) {
    pageZoom = CHROME_ZOOM_LEVELS.reduce((best, z) => (Math.abs(z - ratio) < Math.abs(best - ratio) ? z : best), 1);
  }
  zoomRef = { ...lastPointer, at: now };
}

/** Top-left corner of the top page's viewport on the screen. */
function viewportScreenOrigin(): { left: number; top: number } {
  if (lastPointer) {
    return { left: lastPointer.screenX - lastPointer.rawX * pageZoom, top: lastPointer.screenY - lastPointer.rawY * pageZoom };
  }
  // No pointer event yet: the viewport sits at the bottom of the window, centred between its side borders.
  const side = Math.max(0, (window.outerWidth - window.innerWidth * pageZoom) / 2);
  return {
    left: window.screenX + side,
    top: window.screenY + Math.max(0, window.outerHeight - window.innerHeight * pageZoom - side)
  };
}

function currentScreenLayout(): ScreenLayout | undefined {
  try {
    const origin = viewportScreenOrigin();
    const s = window.screen as Screen & { availLeft?: number; availTop?: number };
    const layout: ScreenLayout = {
      viewportLeft: origin.left,
      viewportTop: origin.top,
      zoom: pageZoom,
      screenLeft: Number(s.availLeft) || 0,
      screenTop: Number(s.availTop) || 0,
      screenWidth: s.width,
      screenHeight: s.height,
      windowLeft: window.screenX,
      windowTop: window.screenY,
      windowWidth: window.outerWidth,
      windowHeight: window.outerHeight
    };
    return Object.values(layout).every((v) => Number.isFinite(v)) ? layout : undefined;
  } catch {
    return undefined;
  }
}

/** What a click hit, without its position. The privacy shield's rules apply. */
function clickDetails(e: MouseEvent, cursor: CursorStyle): Pick<ClickEvent, 'button' | 'targetTag' | 'targetText' | 'targetLabel' | 'clickCount' | 'interactive'> {
  const target = e.target as Element | null;
  const tag = target?.tagName.toLowerCase() || 'unknown';
  const fullText = (target?.textContent?.trim() || '').slice(0, 2000);
  let text = fullText.slice(0, 80) || undefined;
  let checkedText = fullText;
  if (target instanceof HTMLInputElement && target.value) {
    text = target.value.trim().slice(0, 80);
    checkedText = target.value.trim();
  }
  // The privacy shield only BLURS the page (it never rewrites its text), so the
  // raw value is still in the DOM: decide on the FULL text, not on the 80
  // characters that are stored, and never record anything the shield covers.
  const coveredByShield = Boolean(
    target?.closest?.('[data-smoothstudio-redacted="true"]') ||
    target?.querySelector?.('[data-smoothstudio-redacted="true"]')
  );
  const sensitive = coveredByShield ||
    isSensitiveElement(target as HTMLElement | null) ||
    Boolean(checkedText && isSensitiveString(checkedText));
  if (sensitive) {
    text = '[hidden input]';
  }
  return {
    button: e.button,
    targetTag: tag,
    targetText: text,
    targetLabel: sensitive ? '[hidden input]' : describeElement(target as HTMLElement | null),
    clickCount: Math.max(1, Math.round(e.detail || 1)),
    interactive: isInteractiveTarget(target, cursor)
  };
}

// Mousemove only updates the latest pointer position (and, throttled, its CSS cursor).
function handleMouseMove(e: MouseEvent) {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;

  const coords = normalizeCaptureCoordinates(e);
  notePointer(e, coords.rawX, coords.rawY);
  lastMouseX = coords.x;
  lastMouseY = coords.y;
  hasPointer = true;
  pointerInside = true;
  pointerInOpaqueFrame = isOpaqueIframe(e.target);

  const now = performance.now();
  if (now - lastSampleTime >= CURSOR_STYLE_READ_MS) {
    lastSampleTime = now;
    lastCursor = readCursorStyle(e);
  }
  recordPointSample(eventRelativeTime(e), coords.x, coords.y);
}

/** Records one cursor position at a timeline time (never two at the same millisecond). */
function recordPointSample(time: number, x: number, y: number, left = false): void {
  if (!originEpoch) return;
  const t = Math.round(time);
  if (t < 0) return;
  const last = mousePoints[mousePoints.length - 1];
  const point: MousePoint = left ? { t, x, y, c: lastCursor, l: 1 } : { t, x, y, c: lastCursor };
  if (last && last.t === t) {
    mousePoints[mousePoints.length - 1] = point; // the newer position of the same instant
    return;
  }
  if (last && last.t > t) {
    insertByTime(mousePoints, point); // an event that was dispatched late
    return;
  }
  mousePoints.push(point);
}

/** An <iframe> whose document this page cannot reach (cross-origin). */
function isOpaqueIframe(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLIFrameElement)) return false;
  try {
    return !target.contentDocument;
  } catch {
    return true;
  }
}

/** Fixed-rate sampler: records the latest pointer position every SAMPLE_INTERVAL_MS. */
function sampleCursor() {
  if (!isRecording || !hasPointer || !originEpoch || pointerInOpaqueFrame) return;
  // Hidden tab, or the pointer is elsewhere: another page (or nothing) owns it now.
  if (!pointerInside || document.visibilityState !== 'visible') return;
  const t = Math.round(getRelativeTime());
  if (t < 0) return;
  const last = mousePoints[mousePoints.length - 1];
  if (last && last.t >= t) return;
  // Moves record themselves (handleMouseMove). This only pins a resting pointer, so a
  // pause is held in place instead of being bridged by a slow glide.
  if (last && t - last.t < STILL_SAMPLE_MS) return;
  recordPointSample(t, lastMouseX, lastMouseY);
}

function startCursorSampler() {
  if (sampleTimer !== null) clearInterval(sampleTimer);
  sampleTimer = setInterval(sampleCursor, SAMPLE_INTERVAL_MS);
}

function stopCursorSampler() {
  if (sampleTimer !== null) clearInterval(sampleTimer);
  sampleTimer = null;
}

function handlePress(e: MouseEvent, type: 'down' | 'up') {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;
  const coords = normalizeCaptureCoordinates(e);
  notePointer(e, coords.rawX, coords.rawY);
  lastMouseX = coords.x;
  lastMouseY = coords.y;
  hasPointer = true;
  pointerInside = true;
  lastCursor = readCursorStyle(e);
  // A press is an exact event: its position is recorded at its own (event) time.
  const at = eventRelativeTime(e);
  recordPointSample(at, coords.x, coords.y);
  pressEvents.push({ t: Math.round(at), type, x: coords.x, y: coords.y, button: e.button });
}

function handlePointerDown(e: PointerEvent) { handlePress(e, 'down'); }
function handlePointerUp(e: PointerEvent) { handlePress(e, 'up'); }
function handleMouseDown(e: MouseEvent) {
  if (typeof PointerEvent !== 'undefined') return;
  handlePress(e, 'down');
}
function handleMouseUp(e: MouseEvent) {
  if (typeof PointerEvent !== 'undefined') return;
  handlePress(e, 'up');
}

// Track clicks with smart bounding box lock
function handleClick(e: MouseEvent) {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;

  const coords = normalizeCaptureCoordinates(e);
  notePointer(e, coords.rawX, coords.rawY);
  const target = e.target as Element | null;
  const containerBounds = findParentContainer(target, coords.offsetX, coords.offsetY);

  const at = eventRelativeTime(e);
  clicks.push({
    t: Math.round(at),
    x: coords.x,
    y: coords.y,
    ...clickDetails(e, lastCursor),
    containerBounds
  });

  // The cursor is exactly here as the click lands.
  recordPointSample(at, coords.x, coords.y);
}

// ---------------------------------------------------------------------------
// Cross-origin iframes (Word for the web, embedded editors, ...). The top page
// cannot see their events, so the tracker in the iframe hands its pointer
// events to the service worker, which relays them to the top page. The top page
// places them on its own viewport via screen coordinates and records them in
// its ONE telemetry stream.
// ---------------------------------------------------------------------------
interface FrameEvent {
  kind: 'move' | 'down' | 'up' | 'click';
  /** Wall-clock time of the event (ms since epoch). */
  epoch: number;
  screenX: number;
  screenY: number;
  c: CursorStyle;
  button?: number;
  click?: ReturnType<typeof clickDetails> & {
    /** The container box, relative to the click point (page CSS pixels). */
    container?: { dx: number; dy: number; width: number; height: number };
  };
}

function insertByTime<T extends { t: number }>(list: T[], item: T): void {
  let i = list.length;
  while (i > 0 && list[i - 1].t > item.t) i--;
  list.splice(i, 0, item);
}

/** Top page: records the pointer events an iframe handed over. */
function ingestFrameEvents(events: unknown): void {
  if (!isRecording || !Array.isArray(events)) return;
  const vpW = window.innerWidth || document.documentElement?.clientWidth || 1920;
  const vpH = window.innerHeight || document.documentElement?.clientHeight || 1080;
  const origin = viewportScreenOrigin();
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  for (const ev of events as FrameEvent[]) {
    if (!ev || !finite(ev.epoch) || !finite(ev.screenX) || !finite(ev.screenY)) continue;
    const t = Math.round(ev.epoch - originEpoch);
    if (t < 0) continue;
    const rawX = (ev.screenX - origin.left) / pageZoom;
    const rawY = (ev.screenY - origin.top) / pageZoom;
    const x = clamp01(rawX / vpW);
    const y = clamp01(rawY / vpH);
    const c = normalizeCursorStyle(String(ev.c || 'default'));
    const button = finite(ev.button) ? ev.button : 0;

    if (ev.kind === 'move' || ev.kind === 'down' || ev.kind === 'up') {
      lastCursor = c;
      insertByTime(mousePoints, { t, x, y, c });
      if (ev.kind !== 'move') insertByTime(pressEvents, { t, type: ev.kind, x, y, button });
      continue;
    }
    if (ev.kind !== 'click' || !ev.click) continue;
    const d = ev.click;
    const box = d.container;
    const containerBounds = box && finite(box.dx) && finite(box.dy) && finite(box.width) && finite(box.height)
      ? { x: rawX + box.dx, y: rawY + box.dy, width: box.width, height: box.height }
      : undefined;
    const hidden = d.targetLabel === '[hidden input]';
    insertByTime(clicks, {
      t,
      x,
      y,
      button,
      targetTag: String(d.targetTag || 'unknown').slice(0, 40),
      targetText: hidden ? '[hidden input]' : (d.targetText ? String(d.targetText).slice(0, 80) : undefined),
      targetLabel: hidden ? '[hidden input]' : String(d.targetLabel || '').slice(0, 80),
      containerBounds,
      clickCount: finite(d.clickCount) ? Math.max(1, Math.round(d.clickCount)) : 1,
      interactive: d.interactive !== false
    });
    insertByTime(mousePoints, { t, x, y, c });
  }
}

/** True in an iframe the top page cannot reach: its events are lost unless handed over. */
function isUnreachableFrame(): boolean {
  if (typeof window === 'undefined' || window.self === window.top) return false;
  try {
    void window.top!.document.documentElement;
    return false; // same origin: the top page listens to this document itself
  } catch {
    return true;
  }
}

let frameForwarding = false;
let frameQueue: FrameEvent[] = [];
let frameFlushTimer: ReturnType<typeof setTimeout> | null = null;
let frameLastMoveAt = 0;
let frameCursor: CursorStyle = 'default';
const FRAME_MOVE_INTERVAL_MS = 16;
const FRAME_FLUSH_MS = 50;

function flushFrameEvents(): void {
  if (frameFlushTimer !== null) {
    clearTimeout(frameFlushTimer);
    frameFlushTimer = null;
  }
  if (frameQueue.length === 0) return;
  const events = frameQueue;
  frameQueue = [];
  try {
    chrome.runtime.sendMessage({ type: 'FRAME_TELEMETRY', events }, () => { void chrome.runtime?.lastError; });
  } catch { /* extension context gone */ }
}

function queueFrameEvent(ev: FrameEvent, immediately = false): void {
  frameQueue.push(ev);
  if (immediately) {
    flushFrameEvents();
  } else if (frameFlushTimer === null) {
    frameFlushTimer = setTimeout(flushFrameEvents, FRAME_FLUSH_MS);
  }
}

function frameEvent(e: MouseEvent, kind: FrameEvent['kind']): FrameEvent | null {
  if (!Number.isFinite(e.screenX) || !Number.isFinite(e.screenY)) return null;
  return { kind, epoch: epochNow(), screenX: e.screenX, screenY: e.screenY, c: frameCursor };
}

function handleFrameMouseMove(e: MouseEvent): void {
  const now = performance.now();
  if (now - frameLastMoveAt < FRAME_MOVE_INTERVAL_MS) return;
  frameLastMoveAt = now;
  frameCursor = readCursorStyle(e);
  const ev = frameEvent(e, 'move');
  if (ev) queueFrameEvent(ev);
}

function handleFramePress(e: PointerEvent): void {
  frameCursor = readCursorStyle(e);
  const ev = frameEvent(e, e.type === 'pointerdown' ? 'down' : 'up');
  if (!ev) return;
  ev.button = e.button;
  queueFrameEvent(ev);
}

function handleFrameClick(e: MouseEvent): void {
  const ev = frameEvent(e, 'click');
  if (!ev) return;
  const box = findParentContainer(e.target as Element | null);
  ev.button = e.button;
  ev.click = {
    ...clickDetails(e, frameCursor),
    ...(box ? { container: { dx: box.x - e.clientX, dy: box.y - e.clientY, width: box.width, height: box.height } } : {})
  };
  queueFrameEvent(ev, true);
}

function startFrameForwarding(): void {
  if (frameForwarding || !isUnreachableFrame()) return;
  frameForwarding = true;
  frameLastMoveAt = 0;
  window.addEventListener('mousemove', handleFrameMouseMove, { passive: true, capture: true });
  window.addEventListener('pointerdown', handleFramePress, { passive: true, capture: true });
  window.addEventListener('pointerup', handleFramePress, { passive: true, capture: true });
  window.addEventListener('click', handleFrameClick, { passive: true, capture: true });
}

function stopFrameForwarding(): void {
  if (!frameForwarding) return;
  frameForwarding = false;
  window.removeEventListener('mousemove', handleFrameMouseMove, { capture: true });
  window.removeEventListener('pointerdown', handleFramePress, { capture: true });
  window.removeEventListener('pointerup', handleFramePress, { capture: true });
  window.removeEventListener('click', handleFrameClick, { capture: true });
  if (frameFlushTimer !== null) clearTimeout(frameFlushTimer);
  frameFlushTimer = null;
  frameQueue = [];
}

// Track keyboard shortcuts for the 3D HUD (e.g. Cmd+K, Ctrl+C, Enter)
function handleKeyDown(e: KeyboardEvent) {
  if (!isRecording) return;

  // Never record passwords or sensitive form inputs - log as [hidden input]
  const target = e.target as HTMLElement | null;
  if (isSensitiveElement(target)) {
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      keystrokes.push({
        t: Math.round(getRelativeTime()),
        key: '[hidden input]',
        combo: '[hidden input]'
      });
    }
    recordTypingActivity(target, e);
    return;
  }

  // Detect key combinations
  const parts: string[] = [];
  if (e.metaKey) parts.push('⌘');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && parts.length > 0) parts.push('Shift');

  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key === 'Escape') key = 'Esc';
  if (key === 'ArrowUp') key = '↑';
  if (key === 'ArrowDown') key = '↓';
  if (key === 'ArrowLeft') key = '←';
  if (key === 'ArrowRight') key = '→';

  // Only push non-modifier keys or modifier combinations
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
    parts.push(key.toUpperCase());
    const combo = parts.join(' + ');

    keystrokes.push({
      t: Math.round(getRelativeTime()),
      key: e.key,
      combo
    });
  }

  recordTypingActivity(target, e);
}

// ---------------------------------------------------------------------------
// Typing session grouping: a burst of characters typed into one field becomes
// ONE session so the SOP renderer can emit "Type "x" into "Field"" instead of
// one step per character.
// ---------------------------------------------------------------------------
interface ActiveTypingSession {
  el: HTMLElement;
  startT: number;
  endT: number;
  chars: string;
  sensitive: boolean;
  label: string;
  tag: string;
}
let activeTyping: ActiveTypingSession | null = null;
const TYPING_SESSION_GAP_MS = 1500;

function closeTypingSession() {
  if (!activeTyping) return;
  const s = activeTyping;
  activeTyping = null;
  if (!s.chars && !s.sensitive) return;
  typingSessions.push({
    t: Math.round(s.startT),
    endT: Math.round(s.endT),
    text: s.sensitive ? '' : s.chars,
    sensitive: s.sensitive,
    targetLabel: s.sensitive ? '[hidden input]' : s.label,
    targetTag: s.tag
  });
}

function recordTypingActivity(target: HTMLElement | null, e: KeyboardEvent) {
  const isTextField = Boolean(
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
  const now = getRelativeTime();

  if (!isTextField || !target) {
    closeTypingSession();
    return;
  }

  const field: HTMLElement = target;

  if (!activeTyping || activeTyping.el !== field || (now - activeTyping.endT) > TYPING_SESSION_GAP_MS) {
    closeTypingSession();
    activeTyping = {
      el: field,
      startT: now,
      endT: now,
      chars: '',
      sensitive: isSensitiveElement(field),
      label: describeElement(field),
      tag: field.tagName.toLowerCase()
    };
  }

  const session = activeTyping;
  session.endT = now;
  if (session.sensitive) return;

  if (e.key === 'Backspace') {
    session.chars = session.chars.slice(0, -1);
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    session.chars += e.key;
  }
}

// Track input focus & typing for smart camera zoom on text entry (in viewport coordinates)
function handleFocusIn(e: FocusEvent) {
  if (!isRecording) return;
  const target = e.target as HTMLElement | null;

  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    const rect = target.getBoundingClientRect();
    inputEvents.push({
      t: Math.round(getRelativeTime()),
      type: 'focus',
      bounds: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
    });
  }
}

function handleFocusOut(e: FocusEvent) {
  if (!isRecording) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    closeTypingSession();
  }
}

function handleInput(e: Event) {
  if (!isRecording) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    const rect = target.getBoundingClientRect();
    inputEvents.push({
      t: Math.round(getRelativeTime()),
      type: 'type',
      bounds: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
    });
  }
}

// Lightweight passive throttled (~100ms) scroll listener
function handleScroll() {
  if (!isRecording) return;
  const now = performance.now();
  if (now - lastScrollTime >= 100) {
    lastScrollTime = now;
    scrollEvents.push({
      t: Math.round(getRelativeTime()),
      scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
      scrollY: Math.round(window.scrollY || window.pageYOffset || 0)
    });
  }
}

// ---------------------------------------------------------------------------
// Segment hand-over. A navigation or reload destroys this page's memory, so what
// has been captured is pushed to the service worker every FLUSH_INTERVAL_MS and
// on pagehide / beforeunload. The service worker stitches the segments back into
// one stream at stop time. A segment the service worker did not acknowledge is
// kept (with the SAME seq) and handed over again with the final capture, where
// (loadId, seq) de-duplicates it.
// ---------------------------------------------------------------------------
const FLUSH_INTERVAL_MS = 2000;
const loadId = Math.random().toString(36).slice(2) + Date.now().toString(36);
let segmentSeq = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let unackedSegments: TelemetrySegment[] = [];

function takeBatch(): TelemetryBatch {
  const batch: TelemetryBatch = { mousePoints, clicks, pressEvents, keystrokes, inputEvents, typingSessions, scrollEvents, visibilityEvents };
  mousePoints = [];
  clicks = [];
  pressEvents = [];
  keystrokes = [];
  inputEvents = [];
  typingSessions = [];
  scrollEvents = [];
  visibilityEvents = [];
  return batch;
}

function pageInfo(withBrandColors: boolean) {
  const screenLayout = currentScreenLayout();
  return {
    url: window.location.href,
    title: document.title || 'Screen Recording',
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    ...(screenLayout ? { screenLayout } : {}),
    ...(withBrandColors ? { brandColors: extractBrandColors() } : {})
  };
}

function sendSegment(segment: TelemetrySegment): void {
  const drop = () => { /* stays in unackedSegments: handed over again at stop */ };
  try {
    chrome.runtime.sendMessage({ type: 'TELEMETRY_SEGMENT', segment }, (response) => {
      if (chrome.runtime?.lastError || !response || response.ok !== true) { drop(); return; }
      unackedSegments = unackedSegments.filter((s) => s !== segment);
    });
  } catch { drop(); }
}

export function flushTelemetry(reason: 'interval' | 'pagehide' = 'interval'): void {
  if (!isRecording || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  // Leaving the page ends the typing burst: finalize it so it is not lost.
  if (reason === 'pagehide') closeTypingSession();
  for (const pending of unackedSegments) sendSegment(pending);
  const batch = takeBatch();
  if (batchIsEmpty(batch)) return;
  const segment: TelemetrySegment = {
    sessionId: sessionId as string,
    loadId,
    seq: segmentSeq++,
    originEpoch,
    batch,
    page: pageInfo(reason === 'pagehide')
  };
  unackedSegments.push(segment);
  sendSegment(segment);
}

function handlePageHide(): void {
  flushTelemetry('pagehide');
}

/** The user left (or came back to) the recorded tab: a zoom must not stay held on a page nobody sees. */
function handleVisibilityChange() {
  if (!isRecording) return;
  const state = document.visibilityState === 'hidden' ? 'hidden' : 'visible';
  if (state === 'hidden' && hasPointer && pointerInside) {
    // The tab went away (tab switch, minimise): the cursor is no longer on this page.
    pointerInside = false;
    recordPointSample(getRelativeTime(), lastMouseX, lastMouseY, true);
  }
  if (!hudLiveSent) return;
  visibilityEvents.push({ t: Math.round(getRelativeTime()), state });
}

let floatingHudEl: HTMLElement | null = null;
let timerInterval: number | null = null;

function injectRecordingHud() {
  if (typeof window !== 'undefined' && window.self !== window.top) return;
  if (floatingHudEl || document.getElementById('smoothstudio-floating-hud')) return;
  if (!document.body) {
    // A resumed page can be armed before <body> exists.
    document.addEventListener('DOMContentLoaded', () => { if (isRecording) injectRecordingHud(); }, { once: true });
    return;
  }

  floatingHudEl = document.createElement('div');
  floatingHudEl.id = 'smoothstudio-floating-hud';
  floatingHudEl.setAttribute('data-smoothstudio-ignore', 'true');
  floatingHudEl.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    background: #14161D;
    color: #F3F4F6;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 9999px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    user-select: none;
    backdrop-filter: blur(12px);
  `;

  // Built with DOM APIs, never innerHTML: pages that enforce Trusted Types (Gemini, Gmail,
  // YouTube, Docs...) throw on string HTML, also from an extension's content script.
  const live = document.createElement('div');
  live.style.cssText = 'display:flex; align-items:center; gap:8px;';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:10px; height:10px; border-radius:50%; background:#EF4444; display:inline-block; animation: smoothstudio-pulse 1.4s infinite;';
  const timerEl = document.createElement('span');
  timerEl.id = 'smoothstudio-timer';
  timerEl.style.cssText = 'font-family:monospace; font-weight:600; color:#F3F4F6;';
  timerEl.textContent = '00:00';
  live.append(dot, timerEl);
  const divider = document.createElement('div');
  divider.style.cssText = 'width:1px; height:16px; background:rgba(255,255,255,0.15);';
  const stopBtn = document.createElement('button');
  stopBtn.id = 'smoothstudio-stop-btn';
  stopBtn.type = 'button';
  stopBtn.style.cssText = 'background:#8B5CF6; color:#FFF; border:none; border-radius:9999px; padding:4px 12px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px;';
  stopBtn.textContent = 'Stop & Edit';
  const style = document.createElement('style');
  style.textContent = `
    @keyframes smoothstudio-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    #smoothstudio-stop-btn:hover { background: #7C3AED; }
  `;
  floatingHudEl.append(live, divider, stopBtn, style);

  document.body.appendChild(floatingHudEl);

  stopBtn.onclick = (e) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      console.log('[SmoothStudio DOM-Tracker] HUD stop clicked at epoch', Date.now());
      const sendStop = (remaining: number) => {
        chrome.runtime.sendMessage(
          { type: 'STOP_STUDIO_RECORDING', ...(sessionId ? { sessionId } : {}) },
          (response) => {
            if (chrome.runtime?.lastError || !response) {
              if (remaining > 0) {
                setTimeout(() => sendStop(remaining - 1), 100);
              } else {
                // Visible HUD feedback: no ack from service worker after retries.
                stopBtn.textContent = 'Stopping...';
                console.warn('[SmoothStudio DOM-Tracker] HUD stop: no ack from service worker after retries');
              }
            }
          }
        );
      };
      sendStop(3);
    }
  };

  // A resumed page joins a recording that is already running: its timer shows
  // the time since the shared origin, not since this page loaded.
  const startT = hudLiveSent && originEpoch
    ? performance.now() - Math.max(0, epochNow() - originEpoch)
    : performance.now();
  hudTimerEl = timerEl;
  hudTimerStart = startT;
  timerInterval = window.setInterval(renderHudTimer, 1000);
  renderHudTimer();
}

/** QA-037: the HUD timer follows the recorder's real live instant. */
function renderHudTimer(): void {
  if (!hudTimerEl) return;
  const elapsedSec = Math.floor(Math.max(0, performance.now() - hudTimerStart) / 1000);
  const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const s = String(elapsedSec % 60).padStart(2, '0');
  hudTimerEl.innerText = `${m}:${s}`;
}

function removeRecordingHud() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  hudTimerEl = null;
  hudTimerStart = 0;
  if (floatingHudEl) {
    floatingHudEl.remove();
    floatingHudEl = null;
  }
}

/** Stops waiting for the recorded tab to become visible. */
function clearHudLiveWaiters(): void {
  if (hudVisibilityListener) {
    document.removeEventListener('visibilitychange', hudVisibilityListener);
    hudVisibilityListener = null;
  }
  if (hudFallbackTimer !== null) {
    clearTimeout(hudFallbackTimer);
    hudFallbackTimer = null;
  }
}

/**
 * QA-029: the instant the recorded tab (with its HUD) is on screen is the
 * instant the recording goes live. Everything captured before it is dropped;
 * the telemetry clock is re-based to the same epoch the recorder uses.
 */
function markRecordingLiveOnScreen(): void {
  if (hudLiveSent || !isRecording || timelineOriginFixed) return;
  hudLiveSent = true;
  clearHudLiveWaiters();
  originEpoch = epochNow();
  startTime = performance.now();
  mousePoints = [];
  clicks = [];
  keystrokes = [];
  inputEvents = [];
  typingSessions = [];
  scrollEvents = [];
  visibilityEvents = [];
  pressEvents = [];
  lastSampleTime = 0;
  lastScrollTime = 0;
  activeTyping = null;
  console.log('[SmoothStudio DOM-Tracker] HUD on screen: recording goes live. Origin epoch:', Math.round(originEpoch));
  try {
    chrome.runtime.sendMessage({ type: 'HUD_VISIBLE', epoch: originEpoch, sessionId }, () => {
      void chrome.runtime?.lastError;
    });
  } catch { /* extension context gone: the stop path will report it */ }
}

/**
 * QA-037: the recorder publishes the instant its first encoded picture really
 * shows the recorded tab. "The HUD is visible" fires earlier: Chromium swaps
 * the tab ~0.5 s later and then stalls the screen capture while the capturing
 * tab is backgrounded. Telemetry and the HUD timer are re-based to the real
 * instant so video, audio and telemetry share one origin.
 */
function applyTimelineOrigin(epoch: number, incomingSessionId?: string | null): void {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch) || epoch <= 0) return;
  if (incomingSessionId && sessionId && incomingSessionId !== sessionId) return;
  if (!isRecording) return;
  // The same origin again (a repeated message): nothing to re-base, nothing to drop.
  if (timelineOriginFixed && Math.abs(epoch - originEpoch) < 1) return;
  timelineOriginFixed = true;
  // The recorder is live: the HUD-visible signal is no longer needed (and must not re-base).
  hudLiveSent = true;
  clearHudLiveWaiters();
  originEpoch = epoch;
  const behindMs = Math.max(0, Date.now() - epoch);
  startTime = performance.now() - behindMs;
  hudTimerStart = startTime;
  // Nothing before this instant is in the video: the video's first picture is
  // the recorded surface at this exact instant, so earlier samples are dropped.
  mousePoints = [];
  clicks = [];
  keystrokes = [];
  inputEvents = [];
  typingSessions = [];
  scrollEvents = [];
  visibilityEvents = [];
  pressEvents = [];
  lastSampleTime = 0;
  lastScrollTime = 0;
  activeTyping = null;
  renderHudTimer();
  console.log('[SmoothStudio DOM-Tracker] Timeline origin from the recorder:', epoch);
}

/**
 * The HUD is injected immediately, but the recording must not start until the
 * user can actually see it. When the tab is already visible this is synchronous;
 * otherwise the visibilitychange and (after 5 s) a fallback start it, so a
 * recording can never hang in the paused state.
 */
function armHudLiveSignal(): void {
  clearHudLiveWaiters();
  hudLiveSent = false;
  // Two animation frames mean "the HUD has actually been painted": the first
  // callback runs before the paint, the second after it.
  const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(markRecordingLiveOnScreen));
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    afterPaint();
    return;
  }
  hudVisibilityListener = () => {
    if (document.visibilityState === 'visible') afterPaint();
  };
  document.addEventListener('visibilitychange', hudVisibilityListener);
  hudFallbackTimer = setTimeout(markRecordingLiveOnScreen, HUD_VISIBLE_FALLBACK_MS);
}

let attachedIframeDocs: Document[] = [];

function attachSameOriginIframes() {
  try {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of Array.from(iframes)) {
      try {
        const doc = iframe.contentDocument;
        if (doc && !attachedIframeDocs.includes(doc)) {
          attachedIframeDocs.push(doc);
          doc.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
          doc.addEventListener('click', handleClick, { passive: true, capture: true });
        }
      } catch {
        // Cross-origin iframe
      }
    }
  } catch {
    // Ignore
  }
}

function detachSameOriginIframes() {
  for (const doc of attachedIframeDocs) {
    try {
      doc.removeEventListener('mousemove', handleMouseMove, { capture: true });
      doc.removeEventListener('click', handleClick, { capture: true });
    } catch {
      // Ignore
    }
  }
  attachedIframeDocs = [];
}

export function startTracking(
  originEpochMs?: number,
  recordingSessionId?: string | null,
  options: { resume?: boolean } = {}
): void {
  const nextSessionId = recordingSessionId || null;
  // A repeated START for the session that is already running is a no-op: a
  // retried message must never erase the telemetry captured so far.
  if (isRecording && sessionId === nextSessionId) return;

  isRecording = true;
  sessionId = nextSessionId;
  startTime = performance.now();
  // Provisional only: the HUD-visible instant below is the authoritative
  // origin shared with the recorder (QA-029).
  originEpoch = typeof originEpochMs === 'number' && originEpochMs > 0
    ? originEpochMs
    : epochNow();
  mousePoints = [];
  clicks = [];
  pressEvents = [];
  keystrokes = [];
  inputEvents = [];
  typingSessions = [];
  scrollEvents = [];
  visibilityEvents = [];
  lastSampleTime = 0;
  lastScrollTime = 0;
  activeTyping = null;
  unackedSegments = [];
  segmentSeq = 0;
  // A resumed page joins a recording that is already live: the HUD is shown
  // and the origin is the recording's own, never re-based to this page load.
  hudLiveSent = Boolean(options.resume);
  timelineOriginFixed = Boolean(options.resume);

  // Tracking first: the listeners, the sampler and the hand-over are set up before
  // anything touches the page's DOM, so a page that rejects our HUD (or anything
  // else) can never leave a recording without clicks.
  window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
  document.addEventListener('mouseout', handlePointerLeave, { passive: true, capture: true });
  window.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });
  window.addEventListener('pointerup', handlePointerUp, { passive: true, capture: true });
  window.addEventListener('mousedown', handleMouseDown, { passive: true, capture: true });
  window.addEventListener('mouseup', handleMouseUp, { passive: true, capture: true });
  window.addEventListener('click', handleClick, { passive: true, capture: true });
  window.addEventListener('keydown', handleKeyDown, { passive: true, capture: true });
  window.addEventListener('focusin', handleFocusIn, { passive: true, capture: true });
  window.addEventListener('focusout', handleFocusOut, { passive: true, capture: true });
  window.addEventListener('input', handleInput, { passive: true, capture: true });
  window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  window.addEventListener('pagehide', handlePageHide, { capture: true });
  window.addEventListener('beforeunload', handlePageHide, { capture: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  if (flushTimer !== null) clearInterval(flushTimer);
  flushTimer = setInterval(() => flushTelemetry('interval'), FLUSH_INTERVAL_MS);
  hasPointer = false;
  pointerInside = false;
  pointerInOpaqueFrame = false;
  startCursorSampler();
  try {
    attachSameOriginIframes();
  } catch (err) {
    console.warn('[SmoothStudio DOM-Tracker] Same-origin iframes not attached:', String(err));
  }
  // Decoration last: without the HUD the recording still records every click.
  try {
    injectRecordingHud();
  } catch (err) {
    console.warn('[SmoothStudio DOM-Tracker] Recording HUD could not be shown on this page (tracking continues):', String(err));
  }

  if (options.resume) {
    console.log('[SmoothStudio DOM-Tracker] Tracking resumed after navigation. Session:', nextSessionId);
    return;
  }
  armHudLiveSignal();
  console.log('[SmoothStudio DOM-Tracker] Tracking armed. Waiting for the HUD to be on screen. Session:', nextSessionId);
}

/** The session this content script is tracking right now (null when idle). */
export function getTrackingState(): { recording: boolean; sessionId: string | null } {
  return { recording: isRecording, sessionId };
}

/**
 * Stops the current session and returns its telemetry. Returns null when
 * nothing is recording or when `expectedSessionId` names a DIFFERENT session:
 * a late stop must not close (or hand out) the current one.
 */
export function stopTracking(expectedSessionId: string | null = null): TelemetryData | null {
  if (!isRecording) return null;
  if (expectedSessionId && sessionId && expectedSessionId !== sessionId) return null;

  isRecording = false;
  clearHudLiveWaiters();
  hudLiveSent = false;
  removeRecordingHud();
  closeTypingSession();

  window.removeEventListener('mousemove', handleMouseMove, { capture: true });
  document.removeEventListener('mouseout', handlePointerLeave, { capture: true });
  window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  window.removeEventListener('pointerup', handlePointerUp, { capture: true });
  window.removeEventListener('mousedown', handleMouseDown, { capture: true });
  window.removeEventListener('mouseup', handleMouseUp, { capture: true });
  window.removeEventListener('click', handleClick, { capture: true });
  window.removeEventListener('keydown', handleKeyDown, { capture: true });
  window.removeEventListener('focusin', handleFocusIn, { capture: true });
  window.removeEventListener('focusout', handleFocusOut, { capture: true });
  window.removeEventListener('input', handleInput, { capture: true });
  window.removeEventListener('scroll', handleScroll, { capture: true });
  window.removeEventListener('pagehide', handlePageHide, { capture: true });
  window.removeEventListener('beforeunload', handlePageHide, { capture: true });
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  stopCursorSampler();
  detachSameOriginIframes();

  const durationMs = Math.round(getRelativeTime());
  const stoppedSessionId = sessionId;
  sessionId = null;
  const screenLayout = currentScreenLayout();

  const telemetry: TelemetryData = {
    metadata: {
      id: stoppedSessionId || ('rec_' + Date.now()),
      ...(stoppedSessionId ? { sessionId: stoppedSessionId } : {}),
      startTime: Date.now() - durationMs,
      endTime: Date.now(),
      durationMs,
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      title: document.title || 'Screen Recording',
      url: window.location.href,
      ...(screenLayout ? { screenLayout } : {}),
      brandColors: extractBrandColors()
    },
    mousePoints,
    clicks,
    pressEvents,
    keystrokes,
    inputEvents,
    typingSessions,
    scrollEvents,
    visibilityEvents
  };

  console.log('[SmoothStudio DOM-Tracker] Telemetry captured:', telemetry);
  return telemetry;
}

// Chrome extension message listener (only on top-level frame)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && (typeof window === 'undefined' || window.self === window.top) && !(window as any).__smoothstudio_dom_listener_registered) {
  (window as any).__smoothstudio_dom_listener_registered = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'START_TELEMETRY') {
      try {
        startTracking(message.originEpoch, message.sessionId, { resume: message.resume === true });
        sendResponse({ ok: true, status: 'started' });
      } catch (err) {
        console.error('[SmoothStudio DOM-Tracker] Tracking could not start:', err);
        sendResponse({ ok: false, status: 'failed', reason: err instanceof Error ? err.message : String(err) });
      }
      return true;
    } else if (message.type === 'TIMELINE_ORIGIN') {
      applyTimelineOrigin(message.epoch, message.sessionId);
      sendResponse({ ok: true, status: 'origin_applied' });
      return true;
    } else if (message.type === 'STOP_TELEMETRY') {
      const wanted = typeof message.sessionId === 'string' ? message.sessionId : null;
      const active = getTrackingState();
      if (!active.recording) {
        sendResponse({ status: 'not_recording', data: null });
        return true;
      }
      if (wanted && active.sessionId && wanted !== active.sessionId) {
        sendResponse({ status: 'ignored', data: null });
        return true;
      }
      const origin = originEpoch;
      const data = stopTracking(wanted);
      // `unacked`: segments the service worker may not have stored yet. It
      // de-duplicates them by (loadId, seq) when it merges the recording.
      const unacked = unackedSegments;
      unackedSegments = [];
      sendResponse({ status: 'stopped', data, originEpoch: origin, unacked });
      return true;
    } else if (message.type === 'FRAME_TELEMETRY') {
      ingestFrameEvents(message.events);
      sendResponse({ ok: true });
      return true;
    } else if (message.type === 'GET_BRAND_COLORS') {
      sendResponse({ brandColors: extractBrandColors() });
      return true;
    }
    return false;
  });
}

// Cross-origin iframes: hand pointer events to the top page while it records.
// They never answer a message (the top page does), and never keep telemetry of their own.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && isUnreachableFrame() && !(window as any).__smoothstudio_frame_listener_registered) {
  (window as any).__smoothstudio_frame_listener_registered = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'START_TELEMETRY') startFrameForwarding();
    else if (message?.type === 'STOP_TELEMETRY') stopFrameForwarding();
    return false;
  });
  // An iframe that loads while its tab is being recorded joins the recording.
  try {
    chrome.runtime.sendMessage({ type: 'FRAME_TRACKING_STATUS' }, (response) => {
      if (chrome.runtime?.lastError) return;
      if (response?.recording === true) startFrameForwarding();
    });
  } catch { /* extension context gone */ }
}

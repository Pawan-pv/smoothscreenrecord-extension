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
  PressEvent
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
let lastSampleTime = 0;
let lastScrollTime = 0;
const SAMPLE_INTERVAL_MS = 8.33; // ~120Hz sampling

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

// Track mouse position and cursor style at up to 120Hz
function handleMouseMove(e: MouseEvent) {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;

  const coords = normalizeCaptureCoordinates(e);
  lastMouseX = coords.x;
  lastMouseY = coords.y;

  const now = performance.now();
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;

    const cursorStyle = readCursorStyle(e);
    lastCursor = cursorStyle;

    mousePoints.push({
      t: Math.round(getRelativeTime()),
      x: coords.x,
      y: coords.y,
      c: cursorStyle
    });
  }
}

function handlePress(e: MouseEvent, type: 'down' | 'up') {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;
  const coords = normalizeCaptureCoordinates(e);
  lastCursor = readCursorStyle(e);
  mousePoints.push({ t: Math.round(getRelativeTime()), x: coords.x, y: coords.y, c: lastCursor });
  pressEvents.push({ t: Math.round(getRelativeTime()), type, x: coords.x, y: coords.y, button: e.button });
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
  const containerBounds = findParentContainer(target, coords.offsetX, coords.offsetY);

  clicks.push({
    t: Math.round(getRelativeTime()),
    x: coords.x,
    y: coords.y,
    button: e.button,
    targetTag: tag,
    targetText: text,
    targetLabel: sensitive ? '[hidden input]' : describeElement(target as HTMLElement | null),
    containerBounds,
    clickCount: Math.max(1, Math.round(e.detail || 1)),
    interactive: isInteractiveTarget(target, lastCursor)
  });

  // Ensure an immediate mouse point is also captured on click
  mousePoints.push({
    t: Math.round(getRelativeTime()),
    x: coords.x,
    y: coords.y,
    c: lastCursor
  });
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
  return {
    url: window.location.href,
    title: document.title || 'Screen Recording',
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
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
  if (!isRecording || !hudLiveSent) return;
  const state = document.visibilityState === 'hidden' ? 'hidden' : 'visible';
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

  floatingHudEl.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="width:10px; height:10px; border-radius:50%; background:#EF4444; display:inline-block; animation: smoothstudio-pulse 1.4s infinite;"></span>
      <span id="smoothstudio-timer" style="font-family:monospace; font-weight:600; color:#F3F4F6;">00:00</span>
    </div>
    <div style="width:1px; height:16px; background:rgba(255,255,255,0.15);"></div>
    <button id="smoothstudio-stop-btn" style="background:#8B5CF6; color:#FFF; border:none; border-radius:9999px; padding:4px 12px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px;">
      Stop & Edit
    </button>
    <style>
      @keyframes smoothstudio-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }
      #smoothstudio-stop-btn:hover { background: #7C3AED; }
    </style>
  `;

  document.body.appendChild(floatingHudEl);

  const timerEl = document.getElementById('smoothstudio-timer');
  const stopBtn = document.getElementById('smoothstudio-stop-btn');

  if (stopBtn) {
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
                  const btn = document.getElementById('smoothstudio-stop-btn');
                  if (btn) btn.textContent = 'Stopping...';
                  console.warn('[SmoothStudio DOM-Tracker] HUD stop: no ack from service worker after retries');
                }
              }
            }
          );
        };
        sendStop(3);
      }
    };
  }

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
  if (hudLiveSent || !isRecording) return;
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

  injectRecordingHud();

  window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
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
  attachSameOriginIframes();
  if (flushTimer !== null) clearInterval(flushTimer);
  flushTimer = setInterval(() => flushTelemetry('interval'), FLUSH_INTERVAL_MS);

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
  detachSameOriginIframes();

  const durationMs = Math.round(getRelativeTime());
  const stoppedSessionId = sessionId;
  sessionId = null;

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
      startTracking(message.originEpoch, message.sessionId, { resume: message.resume === true });
      sendResponse({ ok: true, status: 'started' });
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
    } else if (message.type === 'GET_BRAND_COLORS') {
      sendResponse({ brandColors: extractBrandColors() });
      return true;
    }
    return false;
  });
}

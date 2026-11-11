import {
  MousePoint,
  ClickEvent,
  KeystrokeEvent,
  InputFocusEvent,
  TelemetryData,
  TypingSession,
  BoundingBox
} from '../types/telemetry';
import {
  applyAutoRedaction,
  startElementPicker,
  stopElementPicker,
  resetRedactions,
  isSensitiveElement,
  isSensitiveString
} from './privacy-redactor';

let isRecording = false;
let startTime = 0;
let mousePoints: MousePoint[] = [];
let clicks: ClickEvent[] = [];
let keystrokes: KeystrokeEvent[] = [];
let inputEvents: InputFocusEvent[] = [];
let typingSessions: TypingSession[] = [];

let lastMouseX = 0;
let lastMouseY = 0;
let lastCursor = 'default';
let lastSampleTime = 0;
const SAMPLE_INTERVAL_MS = 8.33; // ~120Hz sampling

/**
 * Shared timeline origin.
 * The recorder publishes the wall-clock timestamp of the first captured video
 * frame. Every telemetry timestamp is measured against that exact instant so
 * video time and telemetry time are directly comparable (no per-page drift).
 */
let originEpoch = 0;

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

// DOM tree climbing to find meaningful UI container for smart camera framing
// Strictly uses viewport client coordinates so coordinates match getDisplayMedia viewport
function findParentContainer(target: Element | null): BoundingBox | undefined {
  if (!target) return undefined;

  const selector = 'dialog, [role="dialog"], [role="alertdialog"], form, [class*="modal"], [class*="card"], [class*="dialog"], section, article, table, nav, aside';
  const container = target.closest(selector) || target;

  const rect = container.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

// Track mouse position and cursor style at up to 120Hz
function handleMouseMove(e: MouseEvent) {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;

  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  const now = performance.now();
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;

    // Detect computed cursor style
    let cursorStyle = 'default';
    try {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target) {
        cursorStyle = window.getComputedStyle(target).cursor || 'default';
      }
    } catch {
      cursorStyle = 'default';
    }
    lastCursor = cursorStyle;

    mousePoints.push({
      t: Math.round(getRelativeTime()),
      x: e.clientX,
      y: e.clientY,
      c: cursorStyle
    });
  }
}

// Track clicks with smart bounding box lock
function handleClick(e: MouseEvent) {
  if (!isRecording) return;
  if ((e.target as HTMLElement)?.closest('#smoothstudio-floating-hud')) return;

  const target = e.target as Element | null;
  const tag = target?.tagName.toLowerCase() || 'unknown';
  let text = target?.textContent?.trim().slice(0, 80) || undefined;
  if (target instanceof HTMLInputElement && target.value) {
    text = target.value.trim().slice(0, 80);
  }
  const sensitive = isSensitiveElement(target as HTMLElement | null) || Boolean(text && isSensitiveString(text));
  if (sensitive) {
    text = '[hidden input]';
  }
  const containerBounds = findParentContainer(target);

  clicks.push({
    t: Math.round(getRelativeTime()),
    x: e.clientX,
    y: e.clientY,
    button: e.button,
    targetTag: tag,
    targetText: text,
    targetLabel: sensitive ? '[hidden input]' : describeElement(target as HTMLElement | null),
    containerBounds
  });

  // Ensure an immediate mouse point is also captured on click
  mousePoints.push({
    t: Math.round(getRelativeTime()),
    x: e.clientX,
    y: e.clientY,
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

let floatingHudEl: HTMLElement | null = null;
let timerInterval: number | null = null;

function injectRecordingHud() {
  if (typeof window !== 'undefined' && window.self !== window.top) return;
  if (floatingHudEl || document.getElementById('smoothstudio-floating-hud')) return;

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
        chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' }, () => {
          void chrome.runtime?.lastError;
        });
      }
    };
  }

  const startT = performance.now();
  timerInterval = window.setInterval(() => {
    if (!timerEl) return;
    const elapsedSec = Math.floor((performance.now() - startT) / 1000);
    const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const s = String(elapsedSec % 60).padStart(2, '0');
    timerEl.innerText = `${m}:${s}`;
  }, 1000);
}

function removeRecordingHud() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (floatingHudEl) {
    floatingHudEl.remove();
    floatingHudEl = null;
  }
}

export function startTracking(originEpochMs?: number): void {
  isRecording = true;
  startTime = performance.now();
  // Use the recorder published origin so telemetry and video share one clock.
  originEpoch = typeof originEpochMs === 'number' && originEpochMs > 0
    ? originEpochMs
    : epochNow();
  mousePoints = [];
  clicks = [];
  keystrokes = [];
  inputEvents = [];
  typingSessions = [];
  lastSampleTime = 0;
  activeTyping = null;

  injectRecordingHud();

  window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
  window.addEventListener('click', handleClick, { passive: true, capture: true });
  window.addEventListener('keydown', handleKeyDown, { passive: true, capture: true });
  window.addEventListener('focusin', handleFocusIn, { passive: true, capture: true });
  window.addEventListener('focusout', handleFocusOut, { passive: true, capture: true });
  window.addEventListener('input', handleInput, { passive: true, capture: true });

  console.log('[SmoothStudio DOM-Tracker] Started 120Hz recording telemetry. Origin epoch:', Math.round(originEpoch));
}

export function stopTracking(): TelemetryData {
  isRecording = false;
  removeRecordingHud();
  closeTypingSession();

  window.removeEventListener('mousemove', handleMouseMove, { capture: true });
  window.removeEventListener('click', handleClick, { capture: true });
  window.removeEventListener('keydown', handleKeyDown, { capture: true });
  window.removeEventListener('focusin', handleFocusIn, { capture: true });
  window.removeEventListener('focusout', handleFocusOut, { capture: true });
  window.removeEventListener('input', handleInput, { capture: true });

  const durationMs = Math.round(getRelativeTime());

  const telemetry: TelemetryData = {
    metadata: {
      id: 'rec_' + Date.now(),
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
    keystrokes,
    inputEvents,
    typingSessions
  };

  console.log('[SmoothStudio DOM-Tracker] Telemetry captured:', telemetry);
  return telemetry;
}

// Chrome extension message listener (only on top-level frame)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && (typeof window === 'undefined' || window.self === window.top) && !(window as any).__smoothstudio_dom_listener_registered) {
  (window as any).__smoothstudio_dom_listener_registered = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'START_TELEMETRY') {
      startTracking(message.originEpoch);
      sendResponse({ status: 'started' });
      return true;
    } else if (message.type === 'STOP_TELEMETRY') {
      const data = stopTracking();
      sendResponse({ status: 'stopped', data });
      return true;
    } else if (message.type === 'GET_BRAND_COLORS') {
      sendResponse({ brandColors: extractBrandColors() });
      return true;
    }
    return false;
  });
}

import {
  MousePoint,
  ClickEvent,
  KeystrokeEvent,
  InputFocusEvent,
  TelemetryData,
  BoundingBox
} from '../types/telemetry';
import {
  applyAutoRedaction,
  startElementPicker,
  stopElementPicker,
  resetRedactions
} from './privacy-redactor';

let isRecording = false;
let startTime = 0;
let mousePoints: MousePoint[] = [];
let clicks: ClickEvent[] = [];
let keystrokes: KeystrokeEvent[] = [];
let inputEvents: InputFocusEvent[] = [];

let lastMouseX = 0;
let lastMouseY = 0;
let lastCursor = 'default';
let lastSampleTime = 0;
const SAMPLE_INTERVAL_MS = 8.33; // ~120Hz sampling

function getRelativeTime(): number {
  return performance.now() - startTime;
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
  const text = target?.textContent?.trim().slice(0, 80) || undefined;
  const containerBounds = findParentContainer(target);

  clicks.push({
    t: Math.round(getRelativeTime()),
    x: e.clientX,
    y: e.clientY,
    button: e.button,
    targetTag: tag,
    targetText: text,
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

  // Never record passwords or sensitive form inputs
  const target = e.target as HTMLElement | null;
  if (target instanceof HTMLInputElement && target.type === 'password') {
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
        chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' });
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

export function startTracking(): void {
  isRecording = true;
  startTime = performance.now();
  mousePoints = [];
  clicks = [];
  keystrokes = [];
  inputEvents = [];
  lastSampleTime = 0;

  injectRecordingHud();

  window.addEventListener('mousemove', handleMouseMove, { passive: true, capture: true });
  window.addEventListener('click', handleClick, { passive: true, capture: true });
  window.addEventListener('keydown', handleKeyDown, { passive: true, capture: true });
  window.addEventListener('focusin', handleFocusIn, { passive: true, capture: true });
  window.addEventListener('input', handleInput, { passive: true, capture: true });

  console.log('[SmoothStudio DOM-Tracker] Started 120Hz recording telemetry');
}

export function stopTracking(): TelemetryData {
  isRecording = false;
  removeRecordingHud();

  window.removeEventListener('mousemove', handleMouseMove, { capture: true });
  window.removeEventListener('click', handleClick, { capture: true });
  window.removeEventListener('keydown', handleKeyDown, { capture: true });
  window.removeEventListener('focusin', handleFocusIn, { capture: true });
  window.removeEventListener('input', handleInput, { capture: true });

  const durationMs = Math.round(performance.now() - startTime);

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
    inputEvents
  };

  console.log('[SmoothStudio DOM-Tracker] Telemetry captured:', telemetry);
  return telemetry;
}

// Chrome extension message listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'START_TELEMETRY') {
      startTracking();
      sendResponse({ status: 'started' });
    } else if (message.type === 'STOP_TELEMETRY') {
      const data = stopTracking();
      sendResponse({ status: 'stopped', data });
    } else if (message.type === 'GET_BRAND_COLORS') {
      sendResponse({ brandColors: extractBrandColors() });
    } else if (message.type === 'APPLY_PRIVACY_OPTIONS') {
      applyAutoRedaction(message.options || {});
      sendResponse({ status: 'applied' });
    } else if (message.type === 'START_PICKER') {
      startElementPicker();
      sendResponse({ status: 'picker_active' });
    } else if (message.type === 'STOP_PICKER') {
      stopElementPicker();
      sendResponse({ status: 'picker_stopped' });
    } else if (message.type === 'RESET_PRIVACY') {
      resetRedactions();
      sendResponse({ status: 'reset' });
    }
    return true;
  });
}

/**
 * SmoothStudio Privacy Shield — opt-in, surgical, always reversible.
 *
 * The page's own text is NEVER rewritten: redaction is visual only. Automatic
 * blurring touches just credential inputs and tiny leaf nodes, and inline text
 * matches are covered by frosted pills in ONE isolated Shadow DOM overlay.
 *
 * Hard safety invariant: no code path may apply `filter: blur()` to the page
 * root, a layout container, or any element larger than 15% of the viewport.
 * That is enforced by `isSafeTarget()` at blur time and re-enforced by
 * `enforceGuards()` on scroll, resize, rescan and every watchdog tick, so even
 * an element that grows after being masked is unblurred immediately.
 *
 * State machine: IDLE -> PREVIEW / PICKING -> RECORDING -> TERMINATED.
 * Once TERMINATED, all queued timers, observers and mutation callbacks are
 * inert: a recording that ends from any path unblurs 100% of the page.
 */
export interface PrivacyOptions {
  enabled: boolean;
  secrets: boolean;
  pii: boolean;
  financial: boolean;
}

export type PrivacyState = 'IDLE' | 'PREVIEW' | 'PICKING' | 'RECORDING' | 'TERMINATED';

const DEFAULT_OPTIONS: PrivacyOptions = { enabled: false, secrets: true, pii: true, financial: false };
const ALL_OPTIONS: PrivacyOptions = { enabled: true, secrets: true, pii: true, financial: true };

// Non-global detectors: safe to use with .test() on every call (no lastIndex state).
export const EMAIL_DETECT = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
export const REVENUE_DETECT = /(?:[\$€£¥₹\u20B9]\s?|\b(?:USD|INR|EUR|GBP)\s?)[0-9,]+(?:\.[0-9]{2})?(?:\s?(?:k|m|b|billion|million|crore|lakh))?\b|\b[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?\b/i;
export const API_KEY_DETECT = /\b(?:sk_live_[0-9a-zA-Z_-]{14,}|sk-[A-Za-z0-9_-]{14,}|AIza[0-9A-Za-z_-]{25,}|gh[pousr]_[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{14,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/i;
export const OTP_DETECT = /\b(?:otp|one[-_ ]?time(?:\s+(?:code|password))?)\b\s*[:=#]?\s*\d{4,8}\b/i;
export const PHONE_DETECT = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/;
export const SSN_DETECT = /\b\d{3}-\d{2}-\d{4}\b/;
export const CARD_DETECT = /\b(?:\d[ -]?){13,19}\b/;
export const IBAN_DETECT = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
export const PASSWORD_DETECT = /\b(?:password|passwd|secret|credential|one[-_ ]?time|otp)\b/i;

interface Match { start: number; end: number }

let state: PrivacyState = 'IDLE';
/** Read through a helper so control-flow narrowing can never hide a late teardown. */
function isTerminated(): boolean { return (state as PrivacyState) === 'TERMINATED'; }
let stateBeforePicker: PrivacyState = 'IDLE';
let currentSessionId: string | null = null;
let options: PrivacyOptions = { ...DEFAULT_OPTIONS };
let maskedCount = 0;

let mutationObserver: MutationObserver | null = null;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimeout: ReturnType<typeof setTimeout> | null = null;
let awaitingPing = false;
let viewportTimer: ReturnType<typeof setTimeout> | null = null;

let overlayHost: HTMLElement | null = null;
let hoveredElement: HTMLElement | null = null;
let pickerActive = false;

const autoBlurred = new Set<HTMLElement>();
const manualBlurred = new Set<HTMLElement>();
const previousInline = new Map<HTMLElement, {
  filter: string;
  filterPriority: string;
  webkitFilter: string;
  webkitPriority: string;
}>();

// Tags that must never carry a page blur — blurring one would blur the whole
// app (or the recorder's own HUD), which is explicitly forbidden.
const FORBIDDEN_TAGS = new Set([
  'HTML', 'BODY', 'MAIN', 'HEADER', 'NAV', 'ASIDE', 'SECTION', 'ARTICLE',
  'FORM', 'TABLE', 'IFRAME', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'
]);
const MAX_AREA_RATIO = 0.15;   // auto AND manual: whole-page blur is impossible
const LEAF_MAX_CHARS = 64;
const LEAF_MAX_AREA_RATIO = 0.05;
const WATCHDOG_MS = 2000;
const PING_TIMEOUT_MS = 1800;

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

function viewportArea(): number {
  const w = Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1);
  const h = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
  return w * h;
}

function areaRatio(el: HTMLElement): number {
  try {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 0;
    return (r.width * r.height) / viewportArea();
  } catch {
    return 1; // unmeasurable => refuse to blur
  }
}

function isHud(el: Element | null): boolean {
  return Boolean(el?.closest?.('#smoothstudio-floating-hud, [data-smoothstudio-hud], [data-ss-overlay], [data-ss-pill]'));
}

/** The single gate every blur passes through. No caller can bypass it. */
function isSafeTarget(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  if (FORBIDDEN_TAGS.has(el.tagName)) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (isHud(el)) return false;
  return areaRatio(el) <= MAX_AREA_RATIO;
}

function anyCategoryOn(opts: PrivacyOptions): boolean {
  return Boolean(opts.secrets || opts.pii || opts.financial);
}

// ---------------------------------------------------------------------------
// Detection (pure helpers, also used by the exporters through export-safety)
// ---------------------------------------------------------------------------

function collectMatches(text: string, opts: PrivacyOptions): Match[] {
  if (!text) return [];
  const patterns: RegExp[] = [];
  if (opts.secrets) patterns.push(
    new RegExp(API_KEY_DETECT.source, 'gi'),
    new RegExp(OTP_DETECT.source, 'gi')
  );
  if (opts.pii) patterns.push(
    new RegExp(EMAIL_DETECT.source, 'gi'),
    new RegExp(PHONE_DETECT.source, 'g'),
    new RegExp(SSN_DETECT.source, 'g')
  );
  if (opts.financial) patterns.push(
    new RegExp(REVENUE_DETECT.source, 'gi'),
    new RegExp(CARD_DETECT.source, 'g'),
    new RegExp(IBAN_DETECT.source, 'g')
  );

  const found: Match[] = [];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      found.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const merged: Match[] = [];
  for (const m of found) {
    const last = merged[merged.length - 1];
    if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
    else merged.push({ ...m });
  }
  return merged;
}

export function isSensitiveString(str: string): boolean {
  if (!str) return false;
  return collectMatches(str, ALL_OPTIONS).length > 0 || PASSWORD_DETECT.test(str);
}

/** Used by dom-tracker (kept untouched): never record a value the shield hides. */
export function isSensitiveElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.hasAttribute('data-ss-blur') || el.getAttribute('data-sensitive') === 'true') return true;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const labels = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`.toLowerCase();
    if (el instanceof HTMLInputElement && el.type === 'password') return true;
    if (/current-password|new-password|one-time-code|cc-number|cc-exp|cc-csc/.test(autocomplete)) return true;
    if (/password|passwd|secret|api[_-]?key|token|jwt|bearer|credential|otp|one[-_ ]?time|credit[_-]?card|card[_-]?num|cvv|cvc|ssn|iban/.test(labels)) return true;
    const value = el.value || '';
    return Boolean(value && isSensitiveString(value));
  }

  if (el.isContentEditable && el.innerText) return isSensitiveString(el.innerText);
  return false;
}

/**
 * Pure string scrubber for EXPORTED assets only (SOP guide, HTML widget).
 * It is never applied to the live page: the page itself is only ever blurred.
 */
export function redactTextString(
  text: string,
  options: Partial<PrivacyOptions> = ALL_OPTIONS
): string {
  const opts: PrivacyOptions = { ...ALL_OPTIONS, ...options };
  const matches = collectMatches(text, opts);
  if (matches.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.start);
    const value = text.slice(m.start, m.end);
    if (EMAIL_DETECT.test(value)) out += '••••••@••••.com';
    else if (PHONE_DETECT.test(value)) out += '•••-•••-••••';
    else if (SSN_DETECT.test(value)) out += '•••-••-••••';
    else if (IBAN_DETECT.test(value)) out += '••••••••••••';
    else if (CARD_DETECT.test(value)) out += '•••• •••• •••• ••••';
    else out += '••••••••••••••••';
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

// ---------------------------------------------------------------------------
// Reversible blur (attribute based) + isolated overlay
// ---------------------------------------------------------------------------

function ensureStyles(): void {
  try {
    if (document.getElementById('smoothstudio-redaction-styles')) return;
    const style = document.createElement('style');
    style.id = 'smoothstudio-redaction-styles';
    style.textContent = `
      [data-ss-blur] { filter: blur(8px) !important; -webkit-filter: blur(8px) !important; }
      input[data-ss-blur], textarea[data-ss-blur] {
        color: transparent !important;
        text-shadow: 0 0 8px rgba(255, 255, 255, 0.8) !important;
      }
      [data-ss-hover] { outline: 2px dashed #8B5CF6 !important; cursor: crosshair; }
    `;
    (document.head || document.documentElement).appendChild(style);
  } catch { /* styles are an enhancement; inline filter still masks */ }
}

function applyBlur(el: HTMLElement, kind: 'auto' | 'manual'): boolean {
  if (!isSafeTarget(el)) return false;
  if (autoBlurred.has(el) || manualBlurred.has(el)) return true;
  try {
    previousInline.set(el, {
      filter: el.style.getPropertyValue('filter'),
      filterPriority: el.style.getPropertyPriority('filter'),
      webkitFilter: el.style.getPropertyValue('-webkit-filter'),
      webkitPriority: el.style.getPropertyPriority('-webkit-filter')
    });
    el.setAttribute('data-ss-blur', kind);
    // dom-tracker (kept untouched) checks this attribute before storing text.
    el.setAttribute('data-smoothstudio-redacted', 'true');
    el.style.setProperty('filter', 'blur(8px)', 'important');
    el.style.setProperty('-webkit-filter', 'blur(8px)', 'important');
  } catch { return false; }
  (kind === 'auto' ? autoBlurred : manualBlurred).add(el);
  return true;
}

/** Restores the element's exact pre-shield rendering. */
function restoreElement(el: HTMLElement): void {
  try {
    el.removeAttribute('data-ss-blur');
    el.removeAttribute('data-smoothstudio-redacted');
    const prev = previousInline.get(el);
    if (prev?.filter) el.style.setProperty('filter', prev.filter, prev.filterPriority);
    else el.style.removeProperty('filter');
    if (prev?.webkitFilter) el.style.setProperty('-webkit-filter', prev.webkitFilter, prev.webkitPriority);
    else el.style.removeProperty('-webkit-filter');
  } catch { /* the page may have removed the node */ }
  previousInline.delete(el);
  autoBlurred.delete(el);
  manualBlurred.delete(el);
}

function overlayRoot(): ShadowRoot | null {
  if (overlayHost?.shadowRoot) return overlayHost.shadowRoot;
  if (isTerminated()) return null;
  try {
    const host = document.createElement('div');
    host.setAttribute('data-ss-overlay', 'true');
    host.style.cssText = 'position:fixed;inset:0;left:0;top:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .ss-pill {
        position: fixed;
        box-sizing: border-box;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.22);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
      }
    `;
    shadow.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    overlayHost = host;
    return shadow;
  } catch {
    return null;
  }
}

function clearPills(): void {
  const shadow = overlayHost?.shadowRoot;
  if (!shadow) return;
  shadow.querySelectorAll('.ss-pill').forEach((pill) => pill.remove());
}

function pillCount(): number {
  return overlayHost?.shadowRoot?.querySelectorAll('.ss-pill').length || 0;
}

function refreshCount(): void {
  maskedCount = autoBlurred.size + manualBlurred.size + pillCount();
}

function addPills(node: Text, matches: Match[]): void {
  const shadow = overlayRoot();
  if (!shadow) return;
  for (const m of matches) {
    let range: Range;
    try {
      range = document.createRange();
      range.setStart(node, m.start);
      range.setEnd(node, m.end);
    } catch { continue; }
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width < 1 || r.height < 1) continue;
      const pill = document.createElement('div');
      pill.className = 'ss-pill';
      pill.style.left = `${r.left}px`;
      pill.style.top = `${r.top}px`;
      pill.style.width = `${r.width}px`;
      pill.style.height = `${r.height}px`;
      shadow.appendChild(pill);
    }
  }
}

// ---------------------------------------------------------------------------
// Surgical scanning
// ---------------------------------------------------------------------------

function shouldBlurField(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const labels = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`.toLowerCase();
  const value = el.value || '';
  const input = el instanceof HTMLInputElement ? el : null;

  if (input?.type === 'password') return options.secrets;
  if (/current-password|new-password|one-time-code/.test(autocomplete)) return options.secrets;
  if (options.secrets && (
    /password|passwd|secret|api[_-]?key|token|jwt|bearer|credential|otp|one[-_ ]?time/.test(labels) ||
    API_KEY_DETECT.test(value) || OTP_DETECT.test(value)
  )) return true;
  if (options.pii && (
    input?.type === 'email' || autocomplete.includes('email') ||
    /email|phone|tel|ssn|social[-_ ]?security|account[-_ ]?id/.test(labels) ||
    EMAIL_DETECT.test(value) || PHONE_DETECT.test(value) || SSN_DETECT.test(value)
  )) return true;
  if (options.financial && (
    /cc-number|cc-exp|cc-csc/.test(autocomplete) ||
    /credit[_-]?card|card[_-]?num|cvv|cvc|iban|revenue|amount|balance| price/.test(labels) ||
    CARD_DETECT.test(value) || IBAN_DETECT.test(value) || REVENUE_DETECT.test(value)
  )) return true;
  return false;
}

function scan(root: Node): void {
  if (isTerminated() || !options.enabled || !anyCategoryOn(options)) return;
  const doc = root.ownerDocument || document;
  ensureStyles();

  // 1. Credential / sensitive form controls: blur the control itself.
  const fields = root instanceof Element || root instanceof Document
    ? root.querySelectorAll('input, textarea')
    : null;
  if (fields) {
    for (let i = 0; i < fields.length; i++) {
      const el = fields[i] as HTMLInputElement | HTMLTextAreaElement;
      if (isHud(el) || el.hasAttribute('data-ss-blur')) continue;
      if (shouldBlurField(el)) applyBlur(el, 'auto');
    }
  }

  // 2. Text nodes: tiny leaves get a direct reversible blur; longer / nested
  //    text is covered with frosted pills so no large container is ever blurred.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (isTerminated()) return;
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'].includes(tag)) continue;
    if (isHud(parent) || parent.closest('[data-ss-blur]')) continue;

    const text = node.nodeValue || '';
    const matches = collectMatches(text, options);
    if (matches.length === 0) continue;

    const tinyLeaf = parent.children.length === 0 &&
      text.length <= LEAF_MAX_CHARS &&
      areaRatio(parent) < LEAF_MAX_AREA_RATIO &&
      isSafeTarget(parent);
    if (tinyLeaf) {
      applyBlur(parent, 'auto');
    } else {
      addPills(node, matches);
    }
  }
}

/** Re-checks every masked element: a node that grew past the cap is unblurred. */
function enforceGuards(): void {
  const tracked = new Set<HTMLElement>([...autoBlurred, ...manualBlurred]);
  for (const el of tracked) {
    if (!el.isConnected || !isSafeTarget(el)) restoreElement(el);
  }
}

function rescan(): void {
  if (isTerminated()) return;
  enforceGuards();
  // Rebuild from scratch so a category switched OFF restores its masks at once.
  for (const el of Array.from(autoBlurred)) restoreElement(el);
  clearPills();
  scan(document.body || document.documentElement);
  refreshCount();
}

function observe(): void {
  if (mutationObserver) return;
  const target: Node = document.body || document.documentElement;
  mutationObserver = new MutationObserver(() => {
    if (isTerminated() || mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      if (isTerminated()) return;
      rescan();
    }, 150); // throttled: a React/SPA can emit hundreds of mutations per frame
  });
  // 'style'/'filter' are deliberately NOT observed: our own blur writes must
  // not trigger an endless rescan loop.
  mutationObserver.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['value', 'class']
  });
}

function onViewportChange(): void {
  if (isTerminated()) return;
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => {
    viewportTimer = null;
    if (isTerminated()) return;
    rescan();
  }, 60);
}

function bindViewportListeners(): void {
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
}

// ---------------------------------------------------------------------------
// Watchdog: if the session is not active any more, tear down by ourselves.
// ---------------------------------------------------------------------------

function stopWatchdog(): void {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (watchdogTimeout) { clearTimeout(watchdogTimeout); watchdogTimeout = null; }
  awaitingPing = false;
}

function startWatchdog(sid: string): void {
  stopWatchdog();
  watchdogTimer = setInterval(() => {
    if (isTerminated() || state !== 'RECORDING' || currentSessionId !== sid) {
      stopWatchdog();
      return;
    }
    if (awaitingPing) { teardown(); return; } // no reply to the previous ping
    awaitingPing = true;
    watchdogTimeout = setTimeout(() => {
      if (awaitingPing) teardown();
    }, PING_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage({ type: 'PING_PRIVACY_SESSION', sessionId: sid }, (response) => {
        awaitingPing = false;
        if (watchdogTimeout) { clearTimeout(watchdogTimeout); watchdogTimeout = null; }
        if (isTerminated() || state !== 'RECORDING') return;
        if (chrome.runtime?.lastError || !response || (response as { active?: boolean }).active !== true) {
          teardown();
        }
      });
    } catch {
      teardown();
    }
  }, WATCHDOG_MS);
}

// ---------------------------------------------------------------------------
// Public lifecycle
// ---------------------------------------------------------------------------

/** Apply / re-apply the opt-in options. `recording` starts the watchdog. */
export function applyAutoRedaction(
  partial: Partial<PrivacyOptions> = {},
  sid?: string | null,
  recording = false
): number {
  options = { ...DEFAULT_OPTIONS, ...partial };
  if (typeof sid === 'string') currentSessionId = sid;
  // A fresh message is a legitimate new session; a stale timer is not.
  if (isTerminated()) state = 'IDLE';
  if (state !== 'PICKING') state = recording ? 'RECORDING' : 'PREVIEW';

  ensureStyles();
  observe();
  bindViewportListeners();
  rescan(); // removes auto masks of the previous option set, then re-applies

  if (recording && currentSessionId) startWatchdog(currentSessionId);
  else stopWatchdog();
  return maskedCount;
}

function clearHover(el: HTMLElement | null): void {
  if (!el) return;
  try {
    el.removeAttribute('data-ss-hover');
    el.style.removeProperty('outline');
    el.style.removeProperty('cursor');
  } catch { /* the node may be gone */ }
}

function handlePickerMouseMove(e: MouseEvent): void {
  if (!pickerActive || state !== 'PICKING') return;
  const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!target || !isSafeTarget(target)) {
    clearHover(hoveredElement);
    hoveredElement = null;
    return;
  }
  if (hoveredElement === target) return;
  clearHover(hoveredElement);
  hoveredElement = target;
  try {
    target.setAttribute('data-ss-hover', 'true');
    target.style.setProperty('outline', '2px dashed #8B5CF6');
    target.style.setProperty('cursor', 'crosshair');
  } catch { /* ignore */ }
}

function handlePickerClick(e: MouseEvent): void {
  if (!pickerActive || state !== 'PICKING') return;
  e.preventDefault();
  e.stopPropagation();
  const target = hoveredElement;
  if (!target || !isSafeTarget(target)) return;
  clearHover(target);
  hoveredElement = null;
  if (manualBlurred.has(target)) restoreElement(target);
  else applyBlur(target, 'manual');
  refreshCount();
}

function handlePickerKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && pickerActive) stopElementPicker();
}

export function startElementPicker(): void {
  if (isTerminated()) state = 'IDLE';
  if (state === 'PICKING') return;
  stateBeforePicker = state;
  state = 'PICKING';
  pickerActive = true;
  document.addEventListener('mousemove', handlePickerMouseMove, true);
  document.addEventListener('click', handlePickerClick, true);
  document.addEventListener('keydown', handlePickerKeyDown, true);
}

function stopPickerInternal(): void {
  pickerActive = false;
  clearHover(hoveredElement);
  hoveredElement = null;
  document.removeEventListener('mousemove', handlePickerMouseMove, true);
  document.removeEventListener('click', handlePickerClick, true);
  document.removeEventListener('keydown', handlePickerKeyDown, true);
  if (state === 'PICKING') state = stateBeforePicker;
}

export function stopElementPicker(): void {
  stopPickerInternal();
}

/** Removes only the user's manual picks; auto masks are untouched. */
export function clearManualPicks(): void {
  for (const el of Array.from(manualBlurred)) restoreElement(el);
  manualBlurred.clear();
  refreshCount();
}

/**
 * Complete teardown. Called on every stop path (and by the watchdog). Sets the
 * TERMINATED latch FIRST, so every queued microtask / mutation callback that
 * runs afterwards returns without re-arming or re-blurring anything.
 */
export function teardown(): void {
  if (isTerminated()) return;
  state = 'TERMINATED';
  stopWatchdog();
  stopPickerInternal();

  if (mutationObserver) { try { mutationObserver.disconnect(); } catch {} mutationObserver = null; }
  if (mutationTimer) { clearTimeout(mutationTimer); mutationTimer = null; }
  if (viewportTimer) { clearTimeout(viewportTimer); viewportTimer = null; }
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);

  try {
    document.querySelectorAll('[data-ss-blur], [data-smoothstudio-redacted="true"], .smoothstudio-blur-redacted')
      .forEach((el) => restoreElement(el as HTMLElement));
  } catch { /* frame may be tearing down */ }
  for (const el of new Set<HTMLElement>([...autoBlurred, ...manualBlurred])) restoreElement(el);
  autoBlurred.clear();
  manualBlurred.clear();
  previousInline.clear();

  clearPills();
  if (overlayHost) { try { overlayHost.remove(); } catch {} overlayHost = null; }
  try { document.getElementById('smoothstudio-redaction-styles')?.remove(); } catch {}
  currentSessionId = null;
  maskedCount = 0;
}

/** Full reset, including manual picks (kept as an alias for older callers). */
export function resetRedactions(): void {
  teardown();
}

export const redactSensitiveData = applyAutoRedaction;
export const unredactSensitiveData = teardown;
export const restoreRedactions = teardown;

// ---------------------------------------------------------------------------
// Extension messages (one guarded listener per frame, even after re-injection)
// ---------------------------------------------------------------------------

const LISTENER_FLAG = '__smoothstudioPrivacyListener';
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && !(window as any)[LISTENER_FLAG]) {
  (window as any)[LISTENER_FLAG] = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      switch (message?.type) {
        case 'APPLY_PRIVACY_OPTIONS': {
          const count = applyAutoRedaction(message.options || {}, message.sessionId, message.recording === true);
          sendResponse({ ok: true, status: state, count });
          return true;
        }
        case 'START_PICKER':
          startElementPicker();
          sendResponse({ ok: true, status: 'picker_active', count: maskedCount });
          return true;
        case 'STOP_PICKER':
          stopElementPicker();
          sendResponse({ ok: true, status: 'picker_stopped', count: maskedCount });
          return true;
        case 'CLEAR_PICKS':
          clearManualPicks();
          sendResponse({ ok: true, status: 'picks_cleared', count: maskedCount });
          return true;
        case 'STOP_PRIVACY':
        case 'RESET_PRIVACY': {
          // A stale stop for an older session must not unblur a newer one.
          if (typeof message.sessionId === 'string' && currentSessionId && message.sessionId !== currentSessionId) {
            sendResponse({ ok: true, status: 'ignored_stale_session', count: maskedCount });
          } else {
            teardown();
            sendResponse({ ok: true, status: 'terminated', count: 0 });
          }
          return true;
        }
        case 'PING_PRIVACY_SESSION': {
          const active = state === 'RECORDING' &&
            (!message.sessionId || currentSessionId === message.sessionId);
          sendResponse({ ok: true, active });
          return true;
        }
        case 'GET_PRIVACY_STATUS': {
          sendResponse({
            ok: true,
            state,
            enabled: options.enabled,
            sessionId: currentSessionId,
            count: maskedCount
          });
          return true;
        }
      }
    } catch (err) {
      try { sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }); } catch {}
    }
    return false;
  });
}

export interface PrivacyOptions {
  blurEmails: boolean;
  blurRevenue: boolean;
  blurApiKeys: boolean;
  interactivePicker: boolean;
}

let isPickerActive = false;
let hoveredElement: HTMLElement | null = null;
let blurredElements: Set<HTMLElement> = new Set();
let textNodeOriginals: Map<Text, string> = new Map();

// Non-global detection patterns (safe for .test() without mutating lastIndex)
const EMAIL_DETECT = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
const REVENUE_DETECT = /(?:[\$€£¥]\s?|\bUSD\s?)[0-9,]+(?:\.[0-9]{2})?(?:\s?(?:k|m|b|billion|million|k))?\b|\b[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?\b/i;
const API_KEY_DETECT = /\b(?:sk_live_[0-9a-zA-Z]{24,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/i;

export function applyAutoRedaction(options: Partial<PrivacyOptions>) {
  if (!document?.body) return 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    if (!node.nodeValue || !node.parentElement) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(node.parentElement.tagName)) continue;
    if (node.parentElement.getAttribute('data-redacted') === 'true') continue;

    let content = node.nodeValue;
    let modified = false;

    if (options.blurEmails) {
      if (EMAIL_DETECT.test(content)) {
        content = content.replace(new RegExp(EMAIL_DETECT.source, 'gi'), '••••••@••••.com');
        modified = true;
      }
    }

    if (options.blurRevenue) {
      if (REVENUE_DETECT.test(content)) {
        content = content.replace(new RegExp(REVENUE_DETECT.source, 'gi'), '$••,•••');
        modified = true;
      }
    }

    if (options.blurApiKeys) {
      if (API_KEY_DETECT.test(content)) {
        content = content.replace(new RegExp(API_KEY_DETECT.source, 'gi'), '••••••••••••••••');
        modified = true;
      }
    }

    if (modified) {
      if (!textNodeOriginals.has(node)) {
        textNodeOriginals.set(node, node.nodeValue);
      }
      node.nodeValue = content;
      try {
        node.parentElement.setAttribute('data-redacted', 'true');
      } catch {
        // Ignore if parent no longer exists
      }
    }
  }

  // Also blur password and token input fields
  document.querySelectorAll('input[type="password"], [data-sensitive="true"]').forEach((el) => {
    (el as HTMLElement).style.filter = 'blur(8px)';
    blurredElements.add(el as HTMLElement);
  });
}

function handlePickerMouseMove(e: MouseEvent) {
  if (!isPickerActive) return;

  const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!target || target === document.body || target === document.documentElement) return;

  if (hoveredElement && hoveredElement !== target) {
    hoveredElement.style.outline = '';
  }

  hoveredElement = target;
  hoveredElement.style.outline = '2px dashed #8B5CF6';
  hoveredElement.style.cursor = 'crosshair';
}

function handlePickerClick(e: MouseEvent) {
  if (!isPickerActive) return;

  e.preventDefault();
  e.stopPropagation();

  const target = hoveredElement;
  if (!target) return;

  if (blurredElements.has(target)) {
    target.style.filter = '';
    target.style.outline = '';
    blurredElements.delete(target);
  } else {
    target.style.filter = 'blur(8px)';
    target.style.outline = '';
    blurredElements.add(target);
  }
}

function handlePickerKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isPickerActive) {
    stopElementPicker();
  }
}

export function startElementPicker(): void {
  isPickerActive = true;
  document.addEventListener('mousemove', handlePickerMouseMove, true);
  document.addEventListener('click', handlePickerClick, true);
  document.addEventListener('keydown', handlePickerKeyDown, true);
  console.log('[SmoothStudio Privacy] Interactive element picker activated. Click elements to blur, press ESC to finish.');
}

export function stopElementPicker(): void {
  isPickerActive = false;
  if (hoveredElement) {
    hoveredElement.style.outline = '';
    hoveredElement.style.cursor = '';
    hoveredElement = null;
  }
  document.removeEventListener('mousemove', handlePickerMouseMove, true);
  document.removeEventListener('click', handlePickerClick, true);
  document.removeEventListener('keydown', handlePickerKeyDown, true);
  console.log('[SmoothStudio Privacy] Interactive element picker deactivated.');
}

export function resetRedactions(): void {
  stopElementPicker();

  for (const [node, original] of textNodeOriginals.entries()) {
    try {
      node.nodeValue = original;
    } catch {
      // Node may no longer exist
    }
  }
  textNodeOriginals.clear();

  for (const el of blurredElements) {
    el.style.filter = '';
  }
  blurredElements.clear();

  try {
    document.querySelectorAll('[data-redacted="true"]').forEach((el) => el.removeAttribute('data-redacted'));
  } catch {
    // Ignore
  }
}

// Backwards/alternate names expected by tooling and tests
export const redactSensitiveData = applyAutoRedaction;
export const unredactSensitiveData = resetRedactions;
export const restoreRedactions = resetRedactions;

// Extension message listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && !(window as any).__smoothstudio_privacy_listener) {
  (window as any).__smoothstudio_privacy_listener = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'APPLY_PRIVACY_OPTIONS') {
      applyAutoRedaction(message.options || {});
      sendResponse({ status: 'applied' });
      return true;
    } else if (message.type === 'START_PICKER') {
      startElementPicker();
      sendResponse({ status: 'picker_active' });
      return true;
    } else if (message.type === 'STOP_PICKER') {
      stopElementPicker();
      sendResponse({ status: 'picker_stopped' });
      return true;
    } else if (message.type === 'RESET_PRIVACY') {
      resetRedactions();
      sendResponse({ status: 'reset' });
      return true;
    }
    return false;
  });
}

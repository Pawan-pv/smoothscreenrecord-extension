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

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const REVENUE_REGEX = /(?:[\$€£¥]\s?|\bUSD\s?)[0-9,]+(?:\.[0-9]{2})?(?:\s?(?:k|m|b|billion|million|k))?\b|\b[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?\b/gi;
const API_KEY_REGEX = /\b(?:sk_live_[0-9a-zA-Z]{24,}|ghp_[0-9a-zA-Z]{36}|AIza[0-9A-Za-z-_]{35}|bearer\s+[a-zA-Z0-9_\-\.]{20,}|[a-zA-Z0-9_-]{32,})\b/gi;

export function applyAutoRedaction(options: Partial<PrivacyOptions>) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    if (!node.nodeValue || !node.parentElement) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName)) continue;

    let content = node.nodeValue;
    let modified = false;

    if (options.blurEmails && EMAIL_REGEX.test(content)) {
      content = content.replace(EMAIL_REGEX, '••••••@••••.com');
      modified = true;
    }

    if (options.blurRevenue && REVENUE_REGEX.test(content)) {
      content = content.replace(REVENUE_REGEX, '$••,•••');
      modified = true;
    }

    if (options.blurApiKeys && API_KEY_REGEX.test(content)) {
      content = content.replace(API_KEY_REGEX, '••••••••••••••••');
      modified = true;
    }

    if (modified) {
      if (!textNodeOriginals.has(node)) {
        textNodeOriginals.set(node, node.nodeValue);
      }
      node.nodeValue = content;
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
}

// Extension message listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'APPLY_PRIVACY_OPTIONS') {
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

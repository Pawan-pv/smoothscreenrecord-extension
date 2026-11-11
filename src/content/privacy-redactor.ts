export interface PrivacyOptions {
  blurEmails: boolean;
  blurRevenue: boolean;
  blurApiKeys: boolean;
  interactivePicker: boolean;
}

let isPickerActive = false;
let hoveredElement: HTMLElement | null = null;
let blurredElements: Set<HTMLElement> = new Set();
let activeObservers: MutationObserver[] = [];
let mutationTimeout: any = null;
// Original text of every masked text node, so a reset can restore the DOM exactly.
// `masked` records what we wrote, so a later page-driven text change is
// detected and the freshly captured value becomes the new restore point.
let textNodeOriginals: Map<Text, { original: string; masked: string }> = new Map();

// Non-global detection patterns (safe for .test() without mutating lastIndex)
export const EMAIL_DETECT = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
export const REVENUE_DETECT = /(?:[\$€£¥₹\u20B9]\s?|\b(?:USD|INR|EUR|GBP)\s?)[0-9,]+(?:\.[0-9]{2})?(?:\s?(?:k|m|b|billion|million|crore|lakh))?\b|\b[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?\b/i;
export const API_KEY_DETECT = /\b(?:sk_live_[0-9a-zA-Z_-]{14,}|sk-[A-Za-z0-9_-]{14,}|AIza[0-9A-Za-z_-]{25,}|gh[pousr]_[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{14,})\b/i;

export function isSensitiveElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.getAttribute('data-sensitive') === 'true') return true;

  if (el instanceof HTMLInputElement) {
    if (el.type === 'password' || el.type === 'email') return true;
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (['cc-number', 'current-password', 'one-time-code', 'new-password', 'cc-exp', 'cc-csc', 'cc-type'].some((v) => autocomplete.includes(v))) {
      return true;
    }
    const nameOrId = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`.toLowerCase();
    if (/(password|passwd|secret|api[_-]?key|token|credit[_-]?card|card[_-]?num|cvv|cvc|ssn)/i.test(nameOrId)) {
      return true;
    }
    if (el.value && (EMAIL_DETECT.test(el.value) || API_KEY_DETECT.test(el.value) || REVENUE_DETECT.test(el.value))) {
      return true;
    }
  }

  if (el instanceof HTMLTextAreaElement) {
    const nameOrId = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.placeholder || ''}`.toLowerCase();
    if (/(password|passwd|secret|api[_-]?key|token|credit[_-]?card|card[_-]?num|cvv|cvc|ssn)/i.test(nameOrId)) {
      return true;
    }
    if (el.value && (EMAIL_DETECT.test(el.value) || API_KEY_DETECT.test(el.value) || REVENUE_DETECT.test(el.value))) {
      return true;
    }
  }

  if (el.isContentEditable && el.innerText) {
    if (EMAIL_DETECT.test(el.innerText) || API_KEY_DETECT.test(el.innerText) || REVENUE_DETECT.test(el.innerText)) {
      return true;
    }
  }

  return false;
}

export function isSensitiveString(str: string): boolean {
  if (!str) return false;
  return EMAIL_DETECT.test(str) || API_KEY_DETECT.test(str) || REVENUE_DETECT.test(str) || /(password|secret|sk_live_|bearer\s+)/i.test(str);
}

export function redactTextString(
  text: string,
  options: Partial<PrivacyOptions> = { blurEmails: true, blurRevenue: true, blurApiKeys: true }
): string {
  let content = text;
  if (options.blurEmails && EMAIL_DETECT.test(content)) {
    content = content.replace(new RegExp(EMAIL_DETECT.source, 'gi'), '••••••@••••.com');
  }
  if (options.blurRevenue && REVENUE_DETECT.test(content)) {
    content = content.replace(new RegExp(REVENUE_DETECT.source, 'gi'), '$••,•••');
  }
  if (options.blurApiKeys && API_KEY_DETECT.test(content)) {
    content = content.replace(new RegExp(API_KEY_DETECT.source, 'gi'), '••••••••••••••••');
  }
  return content;
}

export function isRevenueTableCell(el: HTMLElement): boolean {
  const text = (el.textContent || '').trim();
  if (!text || !/^[0-9,]+(?:\.[0-9]{1,2})?$/.test(text)) return false;

  const tagOrClass = `${el.className || ''} ${el.id || ''} ${el.getAttribute('data-type') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
  if (/(revenue|mrr|arr|sales|amount|price|billing|income|balance)/i.test(tagOrClass)) {
    return true;
  }

  if (el.tagName === 'TD') {
    const tr = el.parentElement;
    if (tr) {
      const cellIndex = Array.prototype.indexOf.call(tr.children, el);
      const table = tr.closest('table');
      if (table && cellIndex >= 0) {
        const ths = table.querySelectorAll('th');
        if (ths[cellIndex]) {
          const headerText = ths[cellIndex].textContent || '';
          if (/(revenue|mrr|arr|sales|amount|price|billing|income|balance)/i.test(headerText)) {
            return true;
          }
        }
      }
    }
  }

  const revenueParent = el.closest('[id*="revenue" i], [class*="revenue" i], [data-revenue], [data-type*="revenue" i]');
  if (revenueParent) return true;

  return false;
}

function ensureRedactionStyles(docOrShadow: Document | ShadowRoot) {
  try {
    if (docOrShadow.querySelector('#smoothstudio-redaction-styles')) return;
    const style = document.createElement('style');
    style.id = 'smoothstudio-redaction-styles';
    style.textContent = `
      .smoothstudio-blur-redacted {
        filter: blur(8px) !important;
        -webkit-filter: blur(8px) !important;
        user-select: none !important;
        transition: filter 0.1s ease !important;
      }
      input.smoothstudio-blur-redacted, textarea.smoothstudio-blur-redacted {
        filter: blur(8px) !important;
        -webkit-filter: blur(8px) !important;
        color: transparent !important;
        text-shadow: 0 0 8px rgba(255, 255, 255, 0.8) !important;
      }
    `;
    const targetHead = (docOrShadow as Document).head || docOrShadow;
    targetHead.appendChild(style);
  } catch {}
}

function blurElement(el: HTMLElement) {
  if (!blurredElements.has(el)) {
    el.classList.add('smoothstudio-blur-redacted');
    el.setAttribute('data-smoothstudio-redacted', 'true');
    // Inline filter as well as the class: inline styling survives pages that
    // strip injected stylesheets, and it is what the picker toggles back off.
    el.style.filter = 'blur(8px)';
    blurredElements.add(el);
  }
}

// Masks sensitive substrings inside every text node of a root.
// The original text is remembered so `resetRedactions` can restore the DOM.
function maskSensitiveText(root: Node, options: Partial<PrivacyOptions>): number {
  let masked = 0;
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    if (!node.nodeValue || !node.parentElement) continue;

    const parent = node.parentElement;
    // Never touch code, styles, form controls, or the in-page recording HUD.
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) continue;
    if (parent.closest('#smoothstudio-floating-hud')) continue;

    const original = node.nodeValue;
    const redacted = redactTextString(original, options);
    if (redacted === original) continue;

    const tracked = textNodeOriginals.get(node);
    if (!tracked) {
      textNodeOriginals.set(node, { original, masked: redacted });
    } else if (tracked.masked !== original) {
      // The page rewrote this node since we last masked it. The new content is
      // the value that must be restored, so re-anchor the restore point.
      tracked.original = original;
      tracked.masked = redacted;
    }
    node.nodeValue = redacted;
    try {
      parent.setAttribute('data-redacted', 'true');
    } catch {
      // Parent may have been detached between the walk and the write
    }
    masked++;
  }

  return masked;
}

function checkAndBlurInput(el: HTMLInputElement | HTMLTextAreaElement, options: Partial<PrivacyOptions>) {
  if (el.type === 'password') {
    blurElement(el);
    return;
  }
  const val = el.value || '';
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const nameOrId = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`.toLowerCase();

  let shouldBlur = false;
  if (['cc-number', 'current-password', 'one-time-code', 'new-password'].some(v => autocomplete.includes(v))) {
    shouldBlur = true;
  }
  if (/(password|secret|api[_-]?key|token|credit[_-]?card|cvv|cvc)/i.test(nameOrId)) {
    shouldBlur = true;
  }
  if (options.blurEmails && (el.type === 'email' || EMAIL_DETECT.test(val) || autocomplete.includes('email') || nameOrId.includes('email'))) {
    shouldBlur = true;
  }
  if (options.blurRevenue && (REVENUE_DETECT.test(val) || nameOrId.includes('revenue') || nameOrId.includes('mrr'))) {
    shouldBlur = true;
  }
  if (options.blurApiKeys && (API_KEY_DETECT.test(val) || nameOrId.includes('token') || nameOrId.includes('key'))) {
    shouldBlur = true;
  }

  if (shouldBlur) {
    blurElement(el);
  }
}

function checkAndBlurElement(el: HTMLElement, options: Partial<PrivacyOptions>) {
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) return;
  if (el.id === 'smoothstudio-floating-hud' || el.closest('#smoothstudio-floating-hud')) return;

  if (el.getAttribute('data-sensitive') === 'true') {
    blurElement(el);
    return;
  }

  // Only blur leaf elements (children.length === 0) or buttons/links/spans
  if (el.children.length > 0 && el.tagName !== 'BUTTON' && el.tagName !== 'A' && el.tagName !== 'SPAN') {
    return;
  }

  const text = (el.innerText || el.textContent || '').trim();
  if (!text) return;

  let shouldBlur = false;
  if (options.blurEmails && EMAIL_DETECT.test(text)) {
    shouldBlur = true;
  }
  if (options.blurRevenue && (REVENUE_DETECT.test(text) || isRevenueTableCell(el))) {
    shouldBlur = true;
  }
  if (options.blurApiKeys && API_KEY_DETECT.test(text)) {
    shouldBlur = true;
  }

  if (shouldBlur) {
    blurElement(el);
  }
}

function scanContainer(root: Document | ShadowRoot | Element, options: Partial<PrivacyOptions>) {
  try {
    const docOrShadow = (root instanceof Document || root instanceof ShadowRoot) ? root : (root.ownerDocument || document);
    ensureRedactionStyles(docOrShadow as any);

    // 0. Mask sensitive substrings inside text nodes first. This is the
    //    strongest form of redaction: the raw value never reaches the DOM,
    //    the recorder, or the exported video. Blur below then only covers
    //    what text masking cannot reach (input values, canvas, attributes).
    maskSensitiveText(root, options);

    const elements = root.querySelectorAll('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      if (!el || !el.tagName) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
      if (el.id === 'smoothstudio-floating-hud') continue;

      // 1. Shadow DOM penetration
      if (el.shadowRoot) {
        ensureRedactionStyles(el.shadowRoot);
        observeContainer(el.shadowRoot, options);
        scanContainer(el.shadowRoot, options);
      }

      // 2. Same-origin iframe penetration
      if (el.tagName === 'IFRAME') {
        try {
          const iframeDoc = (el as HTMLIFrameElement).contentDocument;
          if (iframeDoc && iframeDoc.body) {
            ensureRedactionStyles(iframeDoc);
            observeContainer(iframeDoc.body, options);
            scanContainer(iframeDoc.body, options);
          }
        } catch {
          // Cross-origin iframe protected by browser CORS
        }
      }

      // 3. Inputs, textareas, or regular elements
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        checkAndBlurInput(el, options);
      } else if (isRevenueTableCell(el)) {
        if (options.blurRevenue) {
          blurElement(el);
        }
      } else {
        checkAndBlurElement(el, options);
      }
    }
  } catch (err) {
    console.warn('[SmoothStudio Privacy] Error during container scan:', err);
  }
}

function observeContainer(target: Node, options: Partial<PrivacyOptions>) {
  // Avoid duplicate observers on the same target
  if ((target as any).__smoothstudio_observed) return;
  (target as any).__smoothstudio_observed = true;

  const obs = new MutationObserver((mutations) => {
    let hasRelevantChanges = false;
    for (const m of mutations) {
      if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        hasRelevantChanges = true;
        break;
      }
      if (m.type === 'characterData') {
        hasRelevantChanges = true;
        break;
      }
      if (m.type === 'attributes' && (m.attributeName === 'value' || m.attributeName === 'class')) {
        hasRelevantChanges = true;
        break;
      }
    }

    if (hasRelevantChanges) {
      if (!mutationTimeout) {
        mutationTimeout = setTimeout(() => {
          mutationTimeout = null;
          scanContainer(target as any, options);
        }, 30);
      }
    }
  });

  obs.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['value', 'class']
  });
  activeObservers.push(obs);
}

export function applyAutoRedaction(options: Partial<PrivacyOptions> = { blurEmails: true, blurRevenue: true, blurApiKeys: true }): number {
  if (!document?.body) return 0;

  ensureRedactionStyles(document);
  observeContainer(document.body, options);
  scanContainer(document.body, options);

  return blurredElements.size;
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
    target.classList.remove('smoothstudio-blur-redacted');
    target.removeAttribute('data-smoothstudio-redacted');
    target.style.filter = '';
    target.style.outline = '';
    blurredElements.delete(target);
  } else {
    blurElement(target);
    target.style.outline = '';
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

  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
    mutationTimeout = null;
  }

  for (const obs of activeObservers) {
    try { obs.disconnect(); } catch {}
  }
  activeObservers = [];

  for (const el of blurredElements) {
    try {
      el.classList.remove('smoothstudio-blur-redacted');
      el.removeAttribute('data-smoothstudio-redacted');
      el.style.filter = '';
      el.style.outline = '';
    } catch {}
  }
  blurredElements.clear();

  // Restore the original text of every masked node and drop the markers.
  for (const [node, tracked] of textNodeOriginals.entries()) {
    try {
      node.nodeValue = tracked.original;
    } catch {
      // Node may no longer be attached to the document
    }
  }
  textNodeOriginals.clear();

  try {
    document.querySelectorAll('[data-redacted="true"]').forEach(el => el.removeAttribute('data-redacted'));
    document.querySelectorAll('#smoothstudio-redaction-styles').forEach(s => s.remove());
  } catch {}
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
      const count = applyAutoRedaction(message.options || {});
      sendResponse({ status: 'applied', count });
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

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
// The nodes the observers were attached to, so a reset can clear the
// "already observed" marker and the observers can be re-attached with the
// current options.
let observedTargets: Node[] = [];
let mutationTimeout: any = null;
// The inline `filter` (value + priority) each blurred element had BEFORE the
// shield touched it, so a reset restores the page's own styling exactly.
// The shield is visual-only (spec item 5): the page's text is never rewritten.
let previousInlineFilter: Map<HTMLElement, { value: string; priority: string }> = new Map();
// QA-018: a sensitive text node that sits DIRECTLY in <body>/<html> cannot be
// covered by blurring its parent (that would blur the whole page and the HUD).
// It is moved, unchanged (same Text node, same value), into an inert inline
// <span> that is blurred instead. A reset puts the node back where it was.
let bodyLevelWrappers: Set<HTMLSpanElement> = new Set();
// Elements the user blurred by hand with the interactive picker. They are not
// part of the category options, so re-applying the options must never undo
// them (only a full reset, or a second picker click, does).
let manualBlurElements: Set<HTMLElement> = new Set();

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

/**
 * Pure string scrubber for the EXPORTED assets (SOP guide, HTML widget).
 * It is never applied to the live page: the page itself is only ever blurred.
 */
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
    previousInlineFilter.set(el, {
      value: el.style.getPropertyValue('filter'),
      priority: el.style.getPropertyPriority('filter')
    });
    el.classList.add('smoothstudio-blur-redacted');
    el.setAttribute('data-smoothstudio-redacted', 'true');
    // Inline filter as well as the class: inline styling survives pages that
    // strip injected stylesheets, and it is what the picker toggles back off.
    el.style.filter = 'blur(8px)';
    blurredElements.add(el);
  }
}

/** Undoes blurElement: the element gets back exactly the inline filter it had. */
function unblurElement(el: HTMLElement) {
  el.classList.remove('smoothstudio-blur-redacted');
  el.removeAttribute('data-smoothstudio-redacted');
  const prev = previousInlineFilter.get(el);
  if (prev && prev.value) {
    el.style.setProperty('filter', prev.value, prev.priority);
  } else {
    el.style.removeProperty('filter');
  }
  previousInlineFilter.delete(el);
  blurredElements.delete(el);
}

// Blurs the element that holds a sensitive substring of a text node.
// The text node itself is NEVER modified: `textContent` stays exactly what the
// page wrote, so forms still post the original values and copy/paste still
// yields the original text.
function blurSensitiveTextNodes(root: Node, options: Partial<PrivacyOptions>): number {
  let blurred = 0;
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  const bodyLevel: Text[] = [];

  while ((node = walker.nextNode() as Text | null)) {
    const value = node.nodeValue;
    if (!value || !node.parentElement) continue;

    const parent = node.parentElement;
    // Never touch code, styles, form controls (they are handled by value), the
    // document root, or the in-page recording HUD.
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) continue;
    if (parent.closest('#smoothstudio-floating-hud')) continue;

    const sensitive =
      (options.blurEmails && EMAIL_DETECT.test(value)) ||
      (options.blurRevenue && REVENUE_DETECT.test(value)) ||
      (options.blurApiKeys && API_KEY_DETECT.test(value));
    if (!sensitive) continue;

    if (parent.tagName === 'BODY' || parent.tagName === 'HTML') {
      bodyLevel.push(node);
      continue;
    }
    if (!blurredElements.has(parent)) blurred++;
    blurElement(parent);
  }

  // Wrap after the walk so the walker never sees a moving node.
  for (const textNode of bodyLevel) {
    const parent = textNode.parentNode;
    if (!parent) continue;
    const wrapper = doc.createElement('span');
    wrapper.setAttribute('data-smoothstudio-wrapper', 'true');
    wrapper.style.display = 'inline';
    parent.insertBefore(wrapper, textNode);
    wrapper.appendChild(textNode); // the same Text node: its value is untouched
    bodyLevelWrappers.add(wrapper);
    blurElement(wrapper);
    blurred++;
  }

  return blurred;
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
  // Credentials are always covered. Key/token/secret fields belong to the
  // "API Keys & Secrets" category, so switching that category OFF restores them.
  if (/(password|passwd|credit[_-]?card|cvv|cvc)/i.test(nameOrId)) {
    shouldBlur = true;
  }
  if (options.blurApiKeys && /(secret|api[_-]?key|token)/i.test(nameOrId)) {
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

    // 0. Blur the element that holds a sensitive substring of a text node.
    //    The page's own text is never rewritten (spec item 5).
    blurSensitiveTextNodes(root, options);

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
  observedTargets.push(target);

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

  // The picker's blurs are the user's explicit choices and are not part of the
  // options: keep the elements that are still in the page and restore them
  // after the scan (the restore + re-mask happen in the same task, so the
  // browser never paints an unredacted frame in between).
  const manual: HTMLElement[] = [];
  for (const el of Array.from(manualBlurElements)) {
    if (el.isConnected) manual.push(el);
    else manualBlurElements.delete(el);
  }

  // Restore whatever was redacted before and re-apply with the CURRENT
  // options. Without this, switching a category OFF leaves the previously
  // masked text masked: the user could never read the value again.
  resetRedactions({ keepPicker: true });

  ensureRedactionStyles(document);
  observeContainer(document.body, options);
  scanContainer(document.body, options);

  for (const el of manual) {
    if (el.isConnected) blurElement(el);
  }

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
    unblurElement(target);
    manualBlurElements.delete(target);
    target.style.outline = '';
  } else {
    blurElement(target);
    manualBlurElements.add(target);
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

export function resetRedactions(opts: { keepPicker?: boolean } = {}): void {
  if (!opts.keepPicker) {
    stopElementPicker();
    // A full reset means "shield off": the manual choices go too. When this
    // is only a re-apply (keepPicker), they are restored afterwards.
    manualBlurElements.clear();
  }

  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
    mutationTimeout = null;
  }

  for (const obs of activeObservers) {
    try { obs.disconnect(); } catch {}
  }
  activeObservers = [];

  // Clear the "already observed" marker so a later applyAutoRedaction() can
  // attach fresh observers that use the current options.
  for (const target of observedTargets) {
    try { delete (target as any).__smoothstudio_observed; } catch {}
  }
  observedTargets = [];

  for (const el of Array.from(blurredElements)) {
    try {
      unblurElement(el);
      el.style.outline = '';
    } catch {}
  }
  blurredElements.clear();
  previousInlineFilter.clear();

  // Put body-level text nodes back exactly where they were (QA-018).
  for (const wrapper of bodyLevelWrappers) {
    try {
      const parent = wrapper.parentNode;
      if (parent) {
        while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
        parent.removeChild(wrapper);
      }
    } catch {}
  }
  bodyLevelWrappers.clear();

  try {
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

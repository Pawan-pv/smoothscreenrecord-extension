import {
  redactTextString,
  EMAIL_DETECT,
  REVENUE_DETECT,
  API_KEY_DETECT,
  PrivacyOptions
} from '../content/privacy-redactor';

/**
 * Shared safety helpers for the exported assets (SOP guide, HTML widget).
 *
 * The SOP/widget exporters build text and HTML from page-controlled strings
 * (titles, element labels, typed text) and embed the step list as JSON inside a
 * <script> tag. Both need the same small, testable primitives:
 *
 *  - HTML escaping for text interpolated into markup;
 *  - JSON escaping for data embedded in an inline script (a `</script>` inside
 *    a label must not terminate the block, and U+2028/U+2029 are line
 *    terminators to JavaScript);
 *  - a guarded percent conversion so a missing viewport size yields no NaN;
 *  - a bounded nearest-snapshot lookup so a step cannot borrow a screenshot
 *    from minutes away;
 *  - object-URL revocation that waits long enough for the download to start;
 *  - sensitive string masking respecting category blur options.
 *
 * Pure module: the only DOM touch is the optional pagehide listener.
 */

/** A step may only use a snapshot within this distance of its own timestamp. */
export const SNAPSHOT_MAX_DISTANCE_MS = 3000;

/** Browsers can abandon a download if its object URL is revoked too early. */
export const OBJECT_URL_REVOKE_DELAY_MS = 60_000;

export type BlurOptions = Partial<PrivacyOptions>;

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escapes a value for interpolation into HTML text or an attribute. */
export function escapeHtmlText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * JSON for an inline <script>: `<`, `>`, `&`, U+2028 and U+2029 become
 * backslash escapes, so no label can close the script block or inject markup.
 */
export function serializeForInlineScript(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Percentage of `total`, clamped to 0..100.
 * Supports dual-mode coordinates: if `value` is in 0..1, it represents a normalized
 * capture coordinate and is converted directly to percentage (0..100%).
 * A legacy pixel value is divided by `total`.
 * A zero, negative or missing total with legacy coordinates falls back to `fallback` (50)
 * so the hotspot stays centred instead of becoming NaN.
 */
export function toPercent(value: number, total: number, fallback = 50): string {
  const safeFallback = Number.isFinite(fallback) ? fallback : 50;
  if (!Number.isFinite(value)) {
    return safeFallback.toFixed(1);
  }
  // Dual-mode coordinate support:
  // If value is in 0..1, it is already a normalized capture coordinate.
  if (value >= 0 && value <= 1.0) {
    return (value * 100).toFixed(1);
  }
  // Legacy pixel coordinates require total (viewport width/height).
  if (!Number.isFinite(total) || total <= 0) {
    return safeFallback.toFixed(1);
  }
  const percent = (value / total) * 100;
  return Math.min(100, Math.max(0, percent)).toFixed(1);
}

/**
 * Nearest snapshot within `maxDistanceMs`, or undefined. The old widget fell
 * back to the globally nearest snapshot, which could be minutes away and show
 * an unrelated screen next to the step.
 */
export function findNearestSnapshot<T extends { timestamp: number }>(
  snapshots: readonly T[],
  timestamp: number,
  maxDistanceMs = SNAPSHOT_MAX_DISTANCE_MS
): T | undefined {
  if (!snapshots || snapshots.length === 0 || !Number.isFinite(timestamp)) {
    return undefined;
  }
  let best: T | undefined;
  let bestDelta = Infinity;
  for (const snapshot of snapshots) {
    if (!snapshot || !Number.isFinite(snapshot.timestamp)) continue;
    const delta = Math.abs(snapshot.timestamp - timestamp);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = snapshot;
    }
  }
  return best && bestDelta <= maxDistanceMs ? best : undefined;
}

/**
 * Revokes an object URL after 60 s, or immediately on pagehide (whichever
 * comes first). The old 1-5 s timers could revoke the URL while the browser
 * was still starting a large download.
 */
export function scheduleObjectUrlRevoke(
  url: string,
  delayMs = OBJECT_URL_REVOKE_DELAY_MS
): void {
  if (typeof window === 'undefined') return;
  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Already revoked: nothing to do.
    }
  };
  let timer: number | undefined;
  const onPageHide = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    window.removeEventListener?.('pagehide', onPageHide);
    revoke();
  };
  timer = window.setTimeout(() => {
    window.removeEventListener?.('pagehide', onPageHide);
    revoke();
  }, delayMs);
  window.addEventListener?.('pagehide', onPageHide, { once: true });
}

/**
 * Masks a string ONLY when it is actually sensitive.
 * Sensitive means: the source already flagged it as a hidden input, or the
 * text matches the email / API key / revenue patterns, or contains credentials.
 * Respects category blur options.
 */
export function maskIfSensitive(
  text: string | undefined,
  alreadyHidden = false,
  blur: BlurOptions = { blurEmails: true, blurRevenue: true, blurApiKeys: true }
): { text: string; hidden: boolean } {
  if (!text) return { text: '', hidden: false };
  if (alreadyHidden || text === '[hidden input]') {
    return { text: '[hidden input]', hidden: true };
  }
  const isPasswordOrSecret = /(password|passwd|secret|api[_-]?key|token|sk_live_|bearer\s+)/i.test(text);
  const patternHit =
    Boolean(blur.blurEmails && EMAIL_DETECT.test(text)) ||
    Boolean(blur.blurRevenue && REVENUE_DETECT.test(text)) ||
    Boolean(blur.blurApiKeys && API_KEY_DETECT.test(text)) ||
    isPasswordOrSecret;

  if (patternHit) {
    if (isPasswordOrSecret) {
      return { text: '[hidden input]', hidden: true };
    }
    const redacted = redactTextString(text, blur);
    return { text: (redacted.includes('••••') || redacted.includes('$••,•••')) ? '[hidden input]' : redacted, hidden: true };
  }
  return { text, hidden: false };
}

const SENSITIVE_URL_KEY = /(token|key|secret|passw|auth|session|sig(nature)?$|jwt|bearer|credential|code$|otp)/i;

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A recorded page's URL is page-controlled text and routinely carries secrets
 * (`?token=`, `#access_token=`, `user:pass@host`, an email in a path). When the
 * privacy shield is active the URL printed in a guide must not give them away.
 * With every category off the URL is returned untouched.
 */
export function redactUrlForExport(
  url: string | undefined,
  blur: BlurOptions = { blurEmails: true, blurRevenue: true, blurApiKeys: true }
): string | undefined {
  if (!url) return url;
  if (!(blur.blurEmails || blur.blurRevenue || blur.blurApiKeys)) return url;
  const MASK = 'REDACTED';
  const maskValue = (key: string, value: string): string => {
    if (!value) return value;
    if (SENSITIVE_URL_KEY.test(key)) return MASK;
    return maskIfSensitive(decodeURIComponentSafe(value), false, blur).hidden ? MASK : value;
  };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return maskIfSensitive(url, false, blur).hidden ? MASK : url;
  }
  parsed.username = '';
  parsed.password = '';
  parsed.pathname = parsed.pathname
    .split('/')
    .map((segment) => (segment && maskIfSensitive(decodeURIComponentSafe(segment), false, blur).hidden ? MASK : segment))
    .join('/');
  const redactedQuery = new URLSearchParams();
  new URLSearchParams(parsed.search).forEach((value, key) => redactedQuery.append(key, maskValue(key, value)));
  parsed.search = redactedQuery.toString();
  if (parsed.hash.includes('=')) {
    const redactedHash = new URLSearchParams();
    new URLSearchParams(parsed.hash.slice(1)).forEach((value, key) => redactedHash.append(key, maskValue(key, value)));
    parsed.hash = redactedHash.toString();
  } else if (parsed.hash && maskIfSensitive(decodeURIComponentSafe(parsed.hash.slice(1)), false, blur).hidden) {
    parsed.hash = MASK;
  }
  return parsed.toString();
}


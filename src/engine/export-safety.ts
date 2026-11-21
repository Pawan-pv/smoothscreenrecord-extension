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
 * Percentage of `total`, clamped to 0..100. A zero, negative or missing total
 * (a telemetry file recorded without viewport metadata) falls back to 50 so
 * the hotspot stays centred instead of becoming NaN.
 */
export function toPercent(value: number, total: number, fallback = 50): string {
  const safeFallback = Number.isFinite(fallback) ? fallback : 50;
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
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


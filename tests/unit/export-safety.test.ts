import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeHtmlText,
  serializeForInlineScript,
  toPercent,
  findNearestSnapshot,
  scheduleObjectUrlRevoke,
  maskIfSensitive,
  SNAPSHOT_MAX_DISTANCE_MS,
  OBJECT_URL_REVOKE_DELAY_MS
} from '../../src/engine/export-safety';

describe('export-safety', () => {
  describe('constants', () => {
    it('defines max distance cap of 3000ms and revoke delay of 60000ms', () => {
      expect(SNAPSHOT_MAX_DISTANCE_MS).toBe(3000);
      expect(OBJECT_URL_REVOKE_DELAY_MS).toBe(60_000);
    });
  });

  describe('escapeHtmlText', () => {
    it('escapes &, <, >, ", and \'', () => {
      const input = '<div class="alert" data-val=\'test\'>Rock & Roll</div>';
      const expected = '&lt;div class=&quot;alert&quot; data-val=&#39;test&#39;&gt;Rock &amp; Roll&lt;/div&gt;';
      expect(escapeHtmlText(input)).toBe(expected);
    });

    it('handles null, undefined, empty string, and numbers', () => {
      expect(escapeHtmlText(null)).toBe('');
      expect(escapeHtmlText(undefined)).toBe('');
      expect(escapeHtmlText('')).toBe('');
      expect(escapeHtmlText(12345)).toBe('12345');
    });

    it('preserves clean alphanumeric text without alteration', () => {
      const clean = 'SmoothStudio Interactive Walkthrough 2026';
      expect(escapeHtmlText(clean)).toBe(clean);
    });
  });

  describe('serializeForInlineScript', () => {
    it('escapes <, >, and & to prevent script tag injection and XML decoding', () => {
      const malicious = {
        title: '</script><script>alert("pwned")</script>',
        entity: 'foo & bar'
      };
      const serialized = serializeForInlineScript(malicious);

      expect(serialized).not.toContain('</script>');
      expect(serialized).not.toContain('<script>');
      expect(serialized).toContain('\\u003c/script\\u003e\\u003cscript\\u003e');
      expect(serialized).toContain('foo \\u0026 bar');
    });

    it('escapes JavaScript line terminators U+2028 and U+2029', () => {
      const payload = {
        text: 'line1\u2028line2\u2029line3'
      };
      const serialized = serializeForInlineScript(payload);
      expect(serialized).toContain('\\u2028');
      expect(serialized).toContain('\\u2029');
      expect(serialized).not.toContain('\u2028');
      expect(serialized).not.toContain('\u2029');
    });

    it('serializes undefined or null as "null"', () => {
      expect(serializeForInlineScript(null)).toBe('null');
      expect(serializeForInlineScript(undefined)).toBe('null');
    });

    it('produces valid JSON when parsed by standard JSON parser (after unicode unescaping)', () => {
      const data = { steps: [{ id: 1, label: '<button & "click">' }] };
      const serialized = serializeForInlineScript(data);
      const parsed = JSON.parse(serialized);
      expect(parsed).toEqual(data);
    });
  });

  describe('toPercent', () => {
    it('calculates standard percentages clamped to 0..100 with 1 decimal place', () => {
      expect(toPercent(25, 100)).toBe('25.0');
      expect(toPercent(0, 100)).toBe('0.0');
      expect(toPercent(100, 100)).toBe('100.0');
      expect(toPercent(480, 1920)).toBe('25.0');
      expect(toPercent(540, 1080)).toBe('50.0');
    });

    it('clamps negative values to 0.0 and overflow values to 100.0', () => {
      expect(toPercent(-20, 100)).toBe('0.0');
      expect(toPercent(150, 100)).toBe('100.0');
      expect(toPercent(2500, 1920)).toBe('100.0');
    });

    it('guards against zero, negative, NaN, or non-finite totals (prevents NaN/Infinity)', () => {
      expect(toPercent(100, 0)).toBe('50.0');
      expect(toPercent(100, -50)).toBe('50.0');
      expect(toPercent(100, NaN)).toBe('50.0');
      expect(toPercent(100, Infinity)).toBe('50.0');
      expect(toPercent(NaN, 100)).toBe('50.0');
      expect(toPercent(Infinity, 100)).toBe('50.0');
    });

    it('accepts custom fallback percentage', () => {
      expect(toPercent(100, 0, 33.3)).toBe('33.3');
      expect(toPercent(NaN, 100, 75)).toBe('75.0');
    });
  });

  describe('findNearestSnapshot', () => {
    const snapshots = [
      { timestamp: 1000, dataUrl: 'snap-1' },
      { timestamp: 5000, dataUrl: 'snap-5' },
      { timestamp: 10000, dataUrl: 'snap-10' }
    ];

    it('returns nearest snapshot within default 3000ms distance cap', () => {
      const snap = findNearestSnapshot(snapshots, 4200);
      expect(snap).toBeDefined();
      expect(snap?.dataUrl).toBe('snap-5');
    });

    it('returns undefined if closest snapshot exceeds 3000ms distance cap', () => {
      // 15000ms is 5000ms away from snap-10 (exceeds 3000ms cap)
      const snap = findNearestSnapshot(snapshots, 15000);
      expect(snap).toBeUndefined();
    });

    it('returns undefined for empty snapshot list or invalid timestamp', () => {
      expect(findNearestSnapshot([], 1000)).toBeUndefined();
      expect(findNearestSnapshot(snapshots, NaN)).toBeUndefined();
      expect(findNearestSnapshot(snapshots, Infinity)).toBeUndefined();
    });

    it('respects custom maxDistanceMs parameter', () => {
      // At distance 1500ms, cap of 1000ms should reject it
      expect(findNearestSnapshot(snapshots, 2500, 1000)).toBeUndefined();
      // Cap of 2000ms should accept it
      expect(findNearestSnapshot(snapshots, 2500, 2000)?.dataUrl).toBe('snap-1');
    });
  });

  describe('scheduleObjectUrlRevoke', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('revokes URL after delay (default 60s)', () => {
      const revokeMock = vi.fn();
      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = revokeMock;

      try {
        scheduleObjectUrlRevoke('blob:test-url', 60_000);
        expect(revokeMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(59_999);
        expect(revokeMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(revokeMock).toHaveBeenCalledTimes(1);
        expect(revokeMock).toHaveBeenCalledWith('blob:test-url');
      } finally {
        URL.revokeObjectURL = origRevoke;
      }
    });

    it('revokes immediately on pagehide event and clears timer', () => {
      const revokeMock = vi.fn();
      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = revokeMock;

      try {
        scheduleObjectUrlRevoke('blob:test-url-2', 60_000);
        expect(revokeMock).not.toHaveBeenCalled();

        // Dispatch pagehide
        window.dispatchEvent(new Event('pagehide'));
        expect(revokeMock).toHaveBeenCalledTimes(1);
        expect(revokeMock).toHaveBeenCalledWith('blob:test-url-2');

        // Advance timer to 60s — revokeObjectURL should not be called a second time
        vi.advanceTimersByTime(60_000);
        expect(revokeMock).toHaveBeenCalledTimes(1);
      } finally {
        URL.revokeObjectURL = origRevoke;
      }
    });
  });

  describe('maskIfSensitive', () => {
    it('masks email when blurEmails is active', () => {
      const res = maskIfSensitive('Contact user.name@domain.co.uk now', false, { blurEmails: true });
      expect(res.hidden).toBe(true);
      expect(res.text).toBe('[hidden input]');
    });

    it('does not mask email when blurEmails is disabled', () => {
      const res = maskIfSensitive('user@domain.com', false, { blurEmails: false, blurRevenue: true, blurApiKeys: true });
      expect(res.hidden).toBe(false);
      expect(res.text).toBe('user@domain.com');
    });

    it('masks revenue figures when blurRevenue is active', () => {
      const res = maskIfSensitive('Revenue is $1,250,000 ARR', false, { blurRevenue: true });
      expect(res.hidden).toBe(true);
      expect(res.text).toBe('[hidden input]');
    });

    it('does not mask revenue figures when blurRevenue is disabled', () => {
      const res = maskIfSensitive('$1,250,000 ARR', false, { blurRevenue: false, blurEmails: true, blurApiKeys: true });
      expect(res.hidden).toBe(false);
      expect(res.text).toBe('$1,250,000 ARR');
    });

    it('masks API keys when blurApiKeys is active', () => {
      const res = maskIfSensitive('sk\u005flive_1234567890abcdef1234', false, { blurApiKeys: true });
      expect(res.hidden).toBe(true);
      expect(res.text).toBe('[hidden input]');
    });

    it('always masks passwords, credentials, and alreadyHidden inputs', () => {
      const options = { blurEmails: false, blurRevenue: false, blurApiKeys: false };
      expect(maskIfSensitive('my-secret-password', false, options).hidden).toBe(true);
      expect(maskIfSensitive('bearer token1234567890', false, options).hidden).toBe(true);
      expect(maskIfSensitive('normal-text', true, options).hidden).toBe(true);
      expect(maskIfSensitive('[hidden input]', false, options).hidden).toBe(true);
    });

    it('leaves ordinary non-sensitive text unmasked', () => {
      const res = maskIfSensitive('Click the Save Changes button', false, { blurEmails: true, blurRevenue: true, blurApiKeys: true });
      expect(res.hidden).toBe(false);
      expect(res.text).toBe('Click the Save Changes button');
    });
  });
});

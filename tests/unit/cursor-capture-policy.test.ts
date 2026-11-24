import { describe, expect, it } from 'vitest';
import { shouldEnableCustomCursor } from '../../src/engine/screen-recorder';

describe('native cursor capture policy', () => {
  // Chromium reports 'motion' for a tab capture even when 'never' was requested
  // (measured on Chrome 157), so 'motion' must NOT turn the smooth cursor off.
  it.each([
    ['always', 'browser', false],
    ['motion', 'browser', true],
    ['never', 'browser', true],
    ['unknown', 'browser', true],
  ] as const)('browser tab with DOM telemetry, native setting %s', (nativeCursor, surface, expected) => {
    expect(shouldEnableCustomCursor(nativeCursor, surface, true)).toBe(expected);
  });

  it('a browser tab whose surface is not reported is treated like a tab', () => {
    expect(shouldEnableCustomCursor('motion', undefined, true)).toBe(true);
    expect(shouldEnableCustomCursor('always', undefined, true)).toBe(false);
  });

  it.each(['always', 'motion', 'never', 'unknown'] as const)(
    'no DOM mouse telemetry means there is nothing to draw: off (native %s)',
    (nativeCursor) => {
      expect(shouldEnableCustomCursor(nativeCursor, 'browser', false)).toBe(false);
      expect(shouldEnableCustomCursor(nativeCursor, undefined, false)).toBe(false);
    }
  );

  it('never enables the vector cursor for a window or monitor capture, whatever the setting', () => {
    for (const native of ['always', 'motion', 'never', 'unknown'] as const) {
      for (const surface of ['window', 'monitor']) {
        expect(shouldEnableCustomCursor(native, surface, true)).toBe(false);
        expect(shouldEnableCustomCursor(native, surface, false)).toBe(false);
      }
    }
  });
});

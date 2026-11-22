import { describe, expect, it } from 'vitest';
import { shouldEnableCustomCursor } from '../../src/engine/screen-recorder';

describe('native cursor capture policy', () => {
  it.each([
    ['always', 'browser', false],
    ['motion', 'browser', false],
    ['never', 'browser', true],
    ['unknown', 'browser', true],
  ] as const)('gates the vector cursor from native setting %s', (nativeCursor, surface, expected) => {
    expect(shouldEnableCustomCursor(nativeCursor, surface, true)).toBe(expected);
  });

  it('uses the window/monitor fallback when native cursor support is unknown and DOM telemetry is absent', () => {
    expect(shouldEnableCustomCursor('unknown', 'window', false)).toBe(false);
    expect(shouldEnableCustomCursor('unknown', 'monitor', false)).toBe(false);
    expect(shouldEnableCustomCursor('unknown', 'browser', false)).toBe(true);
  });
});

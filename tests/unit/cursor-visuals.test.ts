import { describe, expect, it } from 'vitest';
import { normalizeCursorStyle } from '../../src/content/dom-tracker';
import { getPressScale } from '../../src/engine/cursor-spline';

describe('Smooth Cursor visual state', () => {
  it.each([
    ['default', 'default'],
    ['pointer', 'pointer'],
    ['text', 'text'],
    ['grab', 'grab'],
    ['grabbing', 'grabbing'],
    ['not-allowed', 'not-allowed'],
    ['crosshair', 'crosshair'],
    ['url(cursor.png), auto', 'default'],
  ] as const)('normalizes CSS cursor %s to %s', (raw, expected) => {
    expect(normalizeCursorStyle(raw)).toBe(expected);
  });

  it('returns a smooth 0.85x press squish that recovers to 1x', () => {
    expect(getPressScale(0)).toBeCloseTo(0.85, 3);
    expect(getPressScale(0.5)).toBeGreaterThan(0.85);
    expect(getPressScale(0.5)).toBeLessThan(1);
    expect(getPressScale(1)).toBeCloseTo(1, 3);
  });
});

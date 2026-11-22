import { describe, expect, it } from 'vitest';
import { resolveBackgroundLayer } from '../../src/engine/renderer';

describe('background layer precedence', () => {
  it('uses the newest explicit background choice', () => {
    expect(resolveBackgroundLayer(null, null)).toBe('mesh');
    expect(resolveBackgroundLayer(null, '#101010')).toBe('solid');
    expect(resolveBackgroundLayer({} as CanvasImageSource, '#101010')).toBe('image');
  });
});

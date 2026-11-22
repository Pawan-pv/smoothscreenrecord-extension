import { describe, expect, it } from 'vitest';
import {
  computeFrameLayout,
  computeFrameVisualStyle,
  ensureEvenDimensions,
  projectSourceToCanvas,
  unprojectCanvasToSource,
} from '../../src/engine/framing-math';
import { AspectRatioType } from '../../src/types/telemetry';

describe('framing math', () => {
  it('forces every native and export dimension to a positive even integer', () => {
    const aspects: AspectRatioType[] = ['16:9', '9:16', '1:1', '4:3', '4:5'];
    const widths = [1365, 1280, 1920, 3840, 640, 720, 840];
    for (const width of widths) {
      for (const aspect of aspects) {
        const rawHeight = aspect === '16:9' ? width * 9 / 16
          : aspect === '9:16' ? width * 16 / 9
          : aspect === '1:1' ? width
          : aspect === '4:3' ? width * 3 / 4
          : width * 5 / 4;
        const dims = ensureEvenDimensions(width, rawHeight);
        expect(dims.width % 2).toBe(0);
        expect(dims.height % 2).toBe(0);
        expect(dims.width).toBeGreaterThanOrEqual(2);
        expect(dims.height).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it.each([
    ['16:9', 'fit'],
    ['9:16', 'fit'],
    ['9:16', 'smart-fill'],
    ['4:5', 'smart-fill'],
  ] as const)('round-trips source coordinates at 2.2x for %s %s', (aspectRatio, framingMode) => {
    const layout = computeFrameLayout({
      canvasW: aspectRatio === '16:9' ? 1920 : 1080,
      canvasH: aspectRatio === '16:9' ? 1080 : aspectRatio === '9:16' ? 1920 : 1350,
      sourceW: 1920,
      sourceH: 1080,
      aspectRatio,
      framingMode,
      framePadding: 0.2,
      cameraX: 0.5,
      cameraY: 0.5,
      cameraScale: 2.2,
      introScale: 1,
    });
    const source = { x: 0.5, y: 0.5 };
    const projected = projectSourceToCanvas(source.x, source.y, layout);
    const roundTrip = unprojectCanvasToSource(projected.x, projected.y, layout);
    expect(roundTrip.x).toBeCloseTo(source.x, 5);
    expect(roundTrip.y).toBeCloseTo(source.y, 5);
  });

  it('fills portrait canvases in smart-fill while retaining a letterboxed fit mode', () => {
    const smart = computeFrameLayout({
      canvasW: 1080,
      canvasH: 1920,
      sourceW: 1920,
      sourceH: 1080,
      aspectRatio: '9:16',
      framingMode: 'smart-fill',
      framePadding: 0,
    });
    const fit = computeFrameLayout({
      canvasW: 1080,
      canvasH: 1920,
      sourceW: 1920,
      sourceH: 1080,
      aspectRatio: '9:16',
      framingMode: 'fit',
      framePadding: 0,
    });
    expect(smart.window.width).toBe(1080);
    expect(smart.window.height).toBe(1920);
    expect(fit.window.height).toBeLessThan(smart.window.height);
  });

  it('scales frame styling and suppresses frame chrome at zero padding', () => {
    const hd = computeFrameVisualStyle({ canvasW: 1280, canvasH: 720, framePadding: 0.08, borderRadius: 24, shadowBlur: 48 });
    const uhd = computeFrameVisualStyle({ canvasW: 3840, canvasH: 2160, framePadding: 0.08, borderRadius: 24, shadowBlur: 48 });
    const edge = computeFrameVisualStyle({ canvasW: 1920, canvasH: 1080, framePadding: 0, borderRadius: 24, shadowBlur: 48 });
    expect(uhd.radius).toBeCloseTo(hd.radius * 3);
    expect(uhd.shadowBlur).toBeCloseTo(hd.shadowBlur * 3);
    expect(edge.radius).toBe(0);
    expect(edge.shadowBlur).toBe(0);
    expect(edge.outerBorderWidth).toBe(0);
    expect(edge.shadowEnabled).toBe(false);
  });

  it('supports an explicitly disabled or subtle shadow mode', () => {
    const none = computeFrameVisualStyle({ canvasW: 1920, canvasH: 1080, framePadding: 0.08, borderRadius: 18, shadowBlur: 40, shadowMode: 'none' });
    const subtle = computeFrameVisualStyle({ canvasW: 1920, canvasH: 1080, framePadding: 0.08, borderRadius: 18, shadowBlur: 40, shadowMode: 'subtle' });
    expect(none.shadowEnabled).toBe(false);
    expect(none.shadowBlur).toBe(0);
    expect(subtle.shadowBlur).toBe(18);
  });
});

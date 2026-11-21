import { describe, it, expect } from 'vitest';
import {
  getAspectDimensions,
  computeCoverFit
} from '../../src/engine/renderer';
import type { AspectRatioType } from '../../src/types/telemetry';

describe('Framing Polish & Aspect Ratio Upgrades', () => {
  describe('Aspect Ratio 4:5 Dimensions (Instagram/LinkedIn)', () => {
    it('computes exact 4:5 dimensions for 1920 target base', () => {
      const dims = getAspectDimensions('4:5', 1920);
      expect(dims.width).toBe(1536);
      expect(dims.height).toBe(1920);
      expect(dims.width / dims.height).toBeCloseTo(4 / 5, 5);
      // Both dimensions are even for hardware video encoders
      expect(dims.width % 2).toBe(0);
      expect(dims.height % 2).toBe(0);
    });

    it('computes exact 4:5 dimensions for 1080 target base', () => {
      const dims = getAspectDimensions('4:5', 1080);
      expect(dims.width).toBe(864);
      expect(dims.height).toBe(1080);
      expect(dims.width / dims.height).toBeCloseTo(4 / 5, 5);
      expect(dims.width % 2).toBe(0);
      expect(dims.height % 2).toBe(0);
    });

    it('handles all 5 supported aspect ratio presets', () => {
      const ratios: AspectRatioType[] = ['16:9', '9:16', '1:1', '4:3', '4:5'];
      for (const ratio of ratios) {
        const dims = getAspectDimensions(ratio, 1920);
        expect(dims.width).toBeGreaterThan(0);
        expect(dims.height).toBeGreaterThan(0);
        expect(Number.isInteger(dims.width)).toBe(true);
        expect(Number.isInteger(dims.height)).toBe(true);
      }
    });
  });

  describe('Aspect-Ratio Cover Fit Image Math (computeCoverFit)', () => {
    it('correctly crops horizontal sides when image is wider than destination canvas', () => {
      // 1920x1080 (16:9 = 1.777) image on a 1000x1000 (1:1 = 1.0) canvas
      const fit = computeCoverFit(1920, 1080, 1000, 1000);

      // Height should be fully used
      expect(fit.sh).toBe(1080);
      expect(fit.sy).toBe(0);

      // Width should be cropped to match 1:1 aspect (1080)
      expect(fit.sw).toBe(1080);
      // Centered crop: (1920 - 1080) / 2 = 420
      expect(fit.sx).toBe(420);

      // Destination should cover whole target canvas
      expect(fit.dx).toBe(0);
      expect(fit.dy).toBe(0);
      expect(fit.dw).toBe(1000);
      expect(fit.dh).toBe(1000);
    });

    it('correctly crops vertical top/bottom when image is taller than destination canvas', () => {
      // 1080x1920 (9:16 = 0.5625) portrait image on a 1920x1080 (16:9 = 1.777) canvas
      const fit = computeCoverFit(1080, 1920, 1920, 1080);

      // Width should be fully used
      expect(fit.sw).toBe(1080);
      expect(fit.sx).toBe(0);

      // Height should be cropped to match 16:9 aspect: 1080 / (16/9) = 607.5 => 608
      expect(fit.sh).toBe(608);
      // Centered vertical crop
      expect(fit.sy).toBe(Math.round((1920 - 608) / 2));

      expect(fit.dw).toBe(1920);
      expect(fit.dh).toBe(1080);
    });

    it('preserves full image without crop when aspect ratios match', () => {
      // 3840x2160 (16:9) image on a 1920x1080 (16:9) canvas
      const fit = computeCoverFit(3840, 2160, 1920, 1080);

      expect(fit.sx).toBe(0);
      expect(fit.sy).toBe(0);
      expect(fit.sw).toBe(3840);
      expect(fit.sh).toBe(2160);
      expect(fit.dw).toBe(1920);
      expect(fit.dh).toBe(1080);
    });

    it('safeguards against zero or negative source dimensions', () => {
      const fit = computeCoverFit(0, 0, 1920, 1080);
      expect(fit.sw).toBeGreaterThan(0);
      expect(fit.sh).toBeGreaterThan(0);
      expect(Number.isFinite(fit.sx)).toBe(true);
      expect(Number.isFinite(fit.sy)).toBe(true);
    });
  });

  describe('Dynamic Frame Padding Geometry & Click Inversion', () => {
    function computeWindowAndInversion(
      canvasW: number,
      canvasH: number,
      sourceW: number,
      sourceH: number,
      framePadding: number,
      clickCanvasX: number,
      clickCanvasY: number
    ) {
      const padFraction = Math.max(0, Math.min(0.2, framePadding));
      const paddingX = canvasW * padFraction;
      const paddingY = canvasH * padFraction;
      const availW = canvasW - paddingX * 2;
      const availH = canvasH - paddingY * 2;
      const videoAspect = sourceW / sourceH;

      let windowW = availW;
      let windowH = availW / videoAspect;
      if (windowH > availH) {
        windowH = availH;
        windowW = availH * videoAspect;
      }
      const windowX = (canvasW - windowW) / 2;
      const windowY = (canvasH - windowH) / 2;

      const normX = Math.max(0.1, Math.min(0.9, (clickCanvasX - windowX) / windowW));
      const normY = Math.max(0.1, Math.min(0.9, (clickCanvasY - windowY) / windowH));

      return { windowW, windowH, windowX, windowY, normX, normY };
    }

    it('scales available frame window proportionally with 0% padding (full edge-to-edge)', () => {
      const geom = computeWindowAndInversion(1920, 1080, 1920, 1080, 0.0, 960, 540);
      expect(geom.windowW).toBe(1920);
      expect(geom.windowH).toBe(1080);
      expect(geom.windowX).toBe(0);
      expect(geom.windowY).toBe(0);
      // Center click inversions maps exactly to 0.5
      expect(geom.normX).toBeCloseTo(0.5, 4);
      expect(geom.normY).toBeCloseTo(0.5, 4);
    });

    it('scales window correctly with default 8% padding', () => {
      const geom = computeWindowAndInversion(1920, 1080, 1920, 1080, 0.08, 960, 540);
      const expectedAvailW = 1920 * (1 - 0.16); // 1612.8
      const expectedAvailH = 1080 * (1 - 0.16); // 907.2

      expect(geom.windowW).toBeCloseTo(expectedAvailW, 1);
      expect(geom.windowH).toBeCloseTo(expectedAvailH, 1);
      expect(geom.normX).toBeCloseTo(0.5, 4);
      expect(geom.normY).toBeCloseTo(0.5, 4);
    });

    it('scales window correctly with max 20% padding and adjusts click coordinates', () => {
      const geom = computeWindowAndInversion(1920, 1080, 1920, 1080, 0.20, 960, 540);
      const expectedAvailW = 1920 * 0.6; // 1152
      const expectedAvailH = 1080 * 0.6; // 648

      expect(geom.windowW).toBeCloseTo(expectedAvailW, 1);
      expect(geom.windowH).toBeCloseTo(expectedAvailH, 1);
      expect(geom.windowX).toBeCloseTo((1920 - 1152) / 2, 1);
      expect(geom.windowY).toBeCloseTo((1080 - 648) / 2, 1);

      // Click at the left edge of the padded window
      const leftEdgeGeom = computeWindowAndInversion(1920, 1080, 1920, 1080, 0.20, geom.windowX, 540);
      // Clamped to 0.1
      expect(leftEdgeGeom.normX).toBe(0.1);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { getAspectDimensions, VIBE_PRESETS } from '../../src/engine/renderer';
import { AspectRatioType, VibePresetId } from '../../src/types/telemetry';

describe('Frame Composer: Aspect Ratios, Viewport Constraints, & Background Presets', () => {
  describe('1. Aspect Ratio Switching Constraints & Programmatic Dimensions', () => {
    it('computes exact un-squeezed 16:9 YouTube cinematic resolution (1920x1080)', () => {
      const dimensions = getAspectDimensions('16:9', 1920);
      expect(dimensions.width).toBe(1920);
      expect(dimensions.height).toBe(1080);
      expect(dimensions.width / dimensions.height).toBeCloseTo(16 / 9, 3);
    });

    it('computes vertical 9:16 TikTok / Instagram Reels format (1080x1920) without content distortion', () => {
      const dimensions = getAspectDimensions('9:16', 1920);
      // In 9:16 mode, height is the reference target (1920) and width is 1080
      expect(dimensions.height).toBe(1920);
      expect(dimensions.width).toBe(1080);
      expect(dimensions.width / dimensions.height).toBeCloseTo(9 / 16, 3);
    });

    it('computes 1:1 X / LinkedIn square format (1920x1920) maintaining symmetric boundary constraints', () => {
      const dimensions = getAspectDimensions('1:1', 1920);
      expect(dimensions.width).toBe(1920);
      expect(dimensions.height).toBe(1920);
      expect(dimensions.width).toBe(dimensions.height);
    });

    it('computes traditional 4:3 presentation format (1920x1440) accurately', () => {
      const dimensions = getAspectDimensions('4:3', 1920);
      expect(dimensions.width).toBe(1920);
      expect(dimensions.height).toBe(1440);
      expect(dimensions.width / dimensions.height).toBeCloseTo(4 / 3, 3);
    });

    it('handles responsive dynamic base widths smoothly without rounding drift', () => {
      const widths = [1280, 2560, 3840]; // 720p, 1440p, 4K
      for (const w of widths) {
        const dim16_9 = getAspectDimensions('16:9', w);
        expect(dim16_9.width).toBe(w);
        expect(dim16_9.height).toBe(Math.round((w * 9) / 16));

        const dimSquare = getAspectDimensions('1:1', w);
        expect(dimSquare.width).toBe(w);
        expect(dimSquare.height).toBe(w);
      }
    });
  });

  describe('2. Frame Background Padding, Corner Rounding, & Drop Shadows', () => {
    it('defines distinct corner rounding, shadow depth, and gradient matrices across presets', () => {
      const presetIds: VibePresetId[] = ['keynote-pro', 'stripe-mesh', 'linear-cosmic', 'linear-dark'];

      for (const id of presetIds) {
        const preset = VIBE_PRESETS[id];
        expect(preset).toBeDefined();

        // Corner rounding constraint: must have positive border radius for modern card styling
        expect(preset.borderRadius).toBeGreaterThanOrEqual(12);
        expect(preset.borderRadius).toBeLessThanOrEqual(24);

        // Shadow blur constraint: high-depth soft shadow
        expect(preset.shadowBlur).toBeGreaterThanOrEqual(40);

        // Color stops array: must have at least 2 gradient stops
        expect(preset.gradientColors.length).toBeGreaterThanOrEqual(2);
        for (const color of preset.gradientColors) {
          expect(color).toMatch(/^#[0-9A-Fa-f]{6}$|^rgba?\(/);
        }
      }
    });

    it('validates Keynote Pro studio lighting drop-shadow vignette parameters', () => {
      const keynote = VIBE_PRESETS['keynote-pro'];
      expect(keynote.borderRadius).toBe(20);
      expect(keynote.shadowBlur).toBe(60);
      expect(keynote.shadowColor).toBe('rgba(0, 0, 0, 0.88)');
      expect(keynote.backdrop.presetType).toBe('keynote-pro');
      expect(keynote.backdrop.vignetteStrength).toBe(75);
      expect(keynote.backdrop.illumination).toBe(85);
    });

    it('validates Stripe Mesh flowing multi-stop gradient array attributes', () => {
      const stripe = VIBE_PRESETS['stripe-mesh'];
      expect(stripe.gradientColors.length).toBe(5);
      expect(stripe.backdrop.presetType).toBe('stripe-mesh');
      expect(stripe.backdrop.flowSpeed).toBe(60);
      expect(stripe.backdrop.gradientAngle).toBe(135);
    });

    it('validates Linear Cosmic geometric starfield and coordinate matrix grid parameters', () => {
      const cosmic = VIBE_PRESETS['linear-cosmic'];
      expect(cosmic.backdrop.presetType).toBe('linear-cosmic');
      expect(cosmic.backdrop.gridIntensity).toBe(45);
      expect(cosmic.cursorRingColor).toBe('#818CF8');
    });

    it('attaches programmatic canvas styling attributes without mutating external DOM structure', () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx).toBeDefined();

      if (ctx) {
        const preset = VIBE_PRESETS['keynote-pro'];
        ctx.shadowColor = preset.shadowColor;
        ctx.shadowBlur = preset.shadowBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 16;

        expect(ctx.shadowColor).toBe('rgba(0, 0, 0, 0.88)');
        expect(ctx.shadowBlur).toBe(60);
        expect(ctx.shadowOffsetY).toBe(16);
      }
    });
  });
});

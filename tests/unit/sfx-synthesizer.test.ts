import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SfxSynthesizer, sfxSynthesizer } from '../../src/engine/sfx-synthesizer';

describe('SfxSynthesizer Engine', () => {
  let synth: SfxSynthesizer;

  beforeEach(() => {
    synth = new SfxSynthesizer(true);
  });

  it('initializes with enabled state', () => {
    expect(synth.isEnabled()).toBe(true);

    synth.setEnabled(false);
    expect(synth.isEnabled()).toBe(false);
  });

  it('safely handles dispose when audio context is uninitialized', () => {
    expect(() => synth.dispose()).not.toThrow();
  });

  it('handles synthesis gracefully when Web Audio API is unavailable in headless runtime', () => {
    // In headless test environments where AudioContext is undefined, methods should not throw
    expect(() => synth.playMechanicalThock()).not.toThrow();
    expect(() => synth.playUiClick()).not.toThrow();
    expect(() => synth.playCameraWhoosh(2.5)).not.toThrow();
  });

  it('exports a singleton sfxSynthesizer instance', () => {
    expect(sfxSynthesizer).toBeDefined();
    expect(sfxSynthesizer.isEnabled()).toBe(true);
  });
});

// Zero-dependency procedural Web Audio API synthesizer engine.
// Generates asset-free, studio-grade audio feedback ($0 bandwidth/hosting cost).
// Provides native AudioContext oscillators, biquad filters, and custom gain envelope curves.

export interface SfxOptions {
  volume?: number;
  timeOffset?: number; // Timing offset in seconds (or ms if > 10)
  speed?: number;      // For dynamic camera whoosh (scales filter sweep with spring physics speed)
}

export class SfxSynthesizer {
  private audioCtx: AudioContext | null = null;
  private cachedNoiseBuffer: AudioBuffer | null = null;
  private enabled: boolean = true;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Release the shared AudioContext and clear cached buffers. Safe to call multiple times.
   */
  public dispose(): void {
    try {
      if (this.audioCtx) {
        if (this.audioCtx.state !== 'closed') {
          void this.audioCtx.close();
        }
        this.audioCtx = null;
      }
      this.cachedNoiseBuffer = null;
    } catch {
      // AudioContext already closed or unreachable
    }
  }

  /**
   * Lazily retrieve or reinitialize the shared AudioContext.
   */
  private getAudioContext(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) return null;
        this.audioCtx = new AudioCtxClass();
        this.cachedNoiseBuffer = null;
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  /**
   * Generates a reusable 1.0-second white noise AudioBuffer to prevent main thread GC thrashing
   * and thread contention during rapid 60 FPS playback loops.
   */
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.cachedNoiseBuffer && this.cachedNoiseBuffer.sampleRate === ctx.sampleRate) {
      return this.cachedNoiseBuffer;
    }
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * 1.0);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channelData[i] = Math.random() * 2 - 1;
    }
    this.cachedNoiseBuffer = buffer;
    return buffer;
  }

  /**
   * Normalizes timing offset into seconds.
   * If offset > 10, interprets as milliseconds (e.g. 25ms -> 0.025s).
   */
  private normalizeTimeOffset(offset?: number): number {
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) {
      return 0;
    }
    return offset > 10 ? offset / 1000 : offset;
  }

  /**
   * Parses flexible arguments: either positional (volume, timeOffset) or an options object.
   */
  private parseOptions(
    arg1?: number | SfxOptions,
    defaultVolume = 0.3,
    arg2?: number,
    arg3?: number
  ): { volume: number; timeOffsetSec: number; speed: number } {
    if (typeof arg1 === 'object' && arg1 !== null) {
      return {
        volume: typeof arg1.volume === 'number' && Number.isFinite(arg1.volume) ? arg1.volume : defaultVolume,
        timeOffsetSec: this.normalizeTimeOffset(arg1.timeOffset),
        speed: typeof arg1.speed === 'number' && Number.isFinite(arg1.speed) ? arg1.speed : 1.0
      };
    }
    const volume = typeof arg1 === 'number' && Number.isFinite(arg1) ? arg1 : defaultVolume;
    const secondArg = typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined;
    const thirdArg = typeof arg3 === 'number' && Number.isFinite(arg3) ? arg3 : undefined;

    return {
      volume,
      timeOffsetSec: this.normalizeTimeOffset(thirdArg !== undefined ? thirdArg : secondArg),
      speed: secondArg !== undefined && thirdArg !== undefined ? secondArg : 1.0
    };
  }

  // =========================================================================
  // PROFILE 1: Mechanical Keyboard Thock
  // Low-frequency sine/triangle wave blend with an extremely sharp exponential decay.
  // =========================================================================

  /**
   * Plays a physical mechanical keyboard bottom-out "thock":
   * - Sine wave fundamental (115Hz -> 46Hz) for low-end physical weight
   * - Triangle wave harmonic overtone (138Hz -> 54Hz) for tactile casing resonance
   * - Resonant lowpass biquad filter sculpting chassis acoustics
   * - Custom exponential decay gain envelope curve
   *
   * @param volumeOrOpts Volume (0..1) or options object
   * @param timeOffset Optional playhead time offset (seconds or ms)
   */
  public playMechanicalThock(volumeOrOpts?: number | SfxOptions, timeOffset?: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const { volume, timeOffsetSec } = this.parseOptions(volumeOrOpts, 0.3, timeOffset);
      const startTime = Math.max(ctx.currentTime, ctx.currentTime + timeOffsetSec);
      const duration = 0.065; // 65ms total duration

      // 1. Fundamental low-frequency sine oscillator
      const oscSine = ctx.createOscillator();
      oscSine.type = 'sine';
      oscSine.frequency.setValueAtTime(115, startTime);
      oscSine.frequency.exponentialRampToValueAtTime(46, startTime + duration * 0.75);

      const sineGain = ctx.createGain();
      sineGain.gain.setValueAtTime(0.65, startTime);

      // 2. Low-frequency triangle oscillator for tactile switch housing resonance
      const oscTri = ctx.createOscillator();
      oscTri.type = 'triangle';
      oscTri.frequency.setValueAtTime(138, startTime);
      oscTri.frequency.exponentialRampToValueAtTime(54, startTime + duration * 0.7);

      const triGain = ctx.createGain();
      triGain.gain.setValueAtTime(0.45, startTime);

      // 3. Resonant lowpass filter to emulate the keyboard case enclosure
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520, startTime);
      filter.frequency.exponentialRampToValueAtTime(180, startTime + duration);
      filter.Q.setValueAtTime(2.8, startTime);

      // 4. Custom Gain Envelope: Extremely sharp exponential decay curve
      const sampleCount = 64;
      const thockCurve = new Float32Array(sampleCount);
      const attackSamples = 3; // ~3ms fast non-clicking attack
      for (let i = 0; i < attackSamples; i++) {
        thockCurve[i] = (i / attackSamples) * volume;
      }
      for (let i = attackSamples; i < sampleCount; i++) {
        const progress = (i - attackSamples) / (sampleCount - attackSamples);
        thockCurve[i] = volume * Math.exp(-8.2 * progress);
      }
      thockCurve[sampleCount - 1] = 0;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueCurveAtTime(thockCurve, startTime, duration);

      // 5. Subtle micro-contact noise burst for keycap bottom-out leaf snap
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.getNoiseBuffer(ctx);
      noiseSource.loop = true;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(1600, startTime);
      noiseFilter.Q.setValueAtTime(3.0, startTime);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * 0.18, startTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.012);

      // Connect node graph
      oscSine.connect(sineGain);
      oscTri.connect(triGain);
      sineGain.connect(filter);
      triGain.connect(filter);
      filter.connect(masterGain);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);

      masterGain.connect(ctx.destination);

      // Start sources
      oscSine.start(startTime);
      oscTri.start(startTime);
      noiseSource.start(startTime, Math.random() * 0.5);

      // Stop sources
      oscSine.stop(startTime + duration + 0.005);
      oscTri.stop(startTime + duration + 0.005);
      noiseSource.stop(startTime + 0.015);

      // Clean up node references to avoid thread contention
      const cleanup = () => {
        try {
          oscSine.disconnect();
          oscTri.disconnect();
          sineGain.disconnect();
          triGain.disconnect();
          noiseSource.disconnect();
          noiseFilter.disconnect();
          noiseGain.disconnect();
          filter.disconnect();
          masterGain.disconnect();
        } catch {
          // Context already released
        }
      };
      oscSine.onended = cleanup;
      setTimeout(cleanup, Math.ceil((duration + timeOffsetSec + 0.1) * 1000));
    } catch {
      // Audio autoplay policy fallback
    }
  }

  // Alias for backward compatibility with EditorStudio & tests
  public playKeyThock(volumeOrOpts?: number | SfxOptions, timeOffset?: number): void {
    this.playMechanicalThock(volumeOrOpts, timeOffset);
  }

  // =========================================================================
  // PROFILE 2: UI Interaction Click
  // High-frequency, tight noise-burst impulse.
  // =========================================================================

  /**
   * Plays a crisp high-frequency UI interaction click:
   * - High-frequency noise burst filtered with highpass / resonant bandpass (4.5 kHz)
   * - Blended transient micro-tone (2.9 kHz -> 1.2 kHz) for tactile haptic definition
   * - Custom ultra-tight impulse gain envelope curve (14ms)
   *
   * @param volumeOrOpts Volume (0..1) or options object
   * @param timeOffset Optional playhead time offset (seconds or ms)
   */
  public playUiClick(volumeOrOpts?: number | SfxOptions, timeOffset?: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const { volume, timeOffsetSec } = this.parseOptions(volumeOrOpts, 0.35, timeOffset);
      const startTime = Math.max(ctx.currentTime, ctx.currentTime + timeOffsetSec);
      const duration = 0.015; // 15ms tight impulse duration

      // 1. High-frequency noise burst source
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.getNoiseBuffer(ctx);
      noiseSource.loop = true;

      // 2. High-frequency resonant filter (4.5kHz bandpass)
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(4500, startTime);
      filter.Q.setValueAtTime(3.8, startTime);

      // 3. High-frequency micro-tone transient tick
      const tickOsc = ctx.createOscillator();
      tickOsc.type = 'triangle';
      tickOsc.frequency.setValueAtTime(2900, startTime);
      tickOsc.frequency.exponentialRampToValueAtTime(1100, startTime + 0.008);

      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0.25, startTime);

      // 4. Custom Gain Envelope: Tight noise-burst impulse curve
      const sampleCount = 32;
      const impulseCurve = new Float32Array(sampleCount);
      impulseCurve[0] = 0;
      impulseCurve[1] = volume;
      for (let i = 2; i < sampleCount; i++) {
        const progress = (i - 1) / (sampleCount - 1);
        impulseCurve[i] = volume * Math.exp(-9.5 * progress);
      }
      impulseCurve[sampleCount - 1] = 0;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueCurveAtTime(impulseCurve, startTime, duration);

      // Connect node graph
      noiseSource.connect(filter);
      tickOsc.connect(tickGain);
      tickGain.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Start & stop sources
      noiseSource.start(startTime, Math.random() * 0.5);
      tickOsc.start(startTime);

      noiseSource.stop(startTime + duration + 0.002);
      tickOsc.stop(startTime + 0.009);

      // Clean up nodes
      const cleanup = () => {
        try {
          noiseSource.disconnect();
          tickOsc.disconnect();
          tickGain.disconnect();
          filter.disconnect();
          masterGain.disconnect();
        } catch {
          // Context already released
        }
      };
      noiseSource.onended = cleanup;
      setTimeout(cleanup, Math.ceil((duration + timeOffsetSec + 0.05) * 1000));
    } catch {
      // Audio autoplay policy fallback
    }
  }

  // Alias for backward compatibility with EditorStudio & tests
  public playClickPop(volumeOrOpts?: number | SfxOptions, timeOffset?: number): void {
    this.playUiClick(volumeOrOpts, timeOffset);
  }

  // =========================================================================
  // PROFILE 3: Camera Dynamic Whoosh
  // Smoothly modulated bandpass filter sweep tied directly to the speed of your spring-physics translations.
  // =========================================================================

  /**
   * Plays a cinematic camera zoom whoosh:
   * - Modulated bandpass filter sweep directly tied to translation speed
   * - Higher speed translates to a wider, higher frequency sweep and punchier duration
   * - Custom smooth bell-shaped envelope curve
   *
   * @param volumeOrOpts Volume (0..1) or options object
   * @param speed Spring physics translation speed factor (e.g. 0.5..3.5)
   * @param timeOffset Optional playhead time offset (seconds or ms)
   */
  public playCameraWhoosh(
    volumeOrOpts?: number | SfxOptions,
    speed?: number,
    timeOffset?: number
  ): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const { volume, timeOffsetSec, speed: parsedSpeed } = this.parseOptions(
        volumeOrOpts,
        0.25,
        speed,
        timeOffset
      );
      const clampedSpeed = Math.max(0.2, Math.min(4.5, parsedSpeed));
      const startTime = Math.max(ctx.currentTime, ctx.currentTime + timeOffsetSec);

      // Duration scales dynamically with translation speed (faster motion = snappier whoosh)
      const duration = Math.max(0.18, Math.min(0.42, 0.32 / Math.pow(clampedSpeed, 0.35)));

      // 1. Noise source
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.getNoiseBuffer(ctx);
      noiseSource.loop = true;

      // 2. Smoothly modulated bandpass filter sweep tied directly to spring translation speed
      const startFreq = Math.max(90, 130 * Math.sqrt(clampedSpeed));
      const peakFreq = Math.min(3200, 420 + 680 * clampedSpeed);
      const endFreq = Math.max(100, 160 * Math.sqrt(clampedSpeed));
      const qVal = 2.2 + Math.min(2.5, clampedSpeed * 0.8);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(qVal, startTime);
      filter.frequency.setValueAtTime(startFreq, startTime);
      filter.frequency.exponentialRampToValueAtTime(peakFreq, startTime + duration * 0.42);
      filter.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

      // 3. Custom Gain Envelope: Smooth Gaussian swell & decay envelope curve
      const sampleCount = 64;
      const whooshCurve = new Float32Array(sampleCount);
      const effectiveVol = volume * (0.8 + 0.25 * Math.min(2.5, clampedSpeed));

      for (let i = 0; i < sampleCount; i++) {
        const t = i / (sampleCount - 1);
        const x = (t - 0.42) / 0.26;
        whooshCurve[i] = effectiveVol * Math.exp(-0.5 * x * x);
      }
      whooshCurve[0] = 0;
      whooshCurve[sampleCount - 1] = 0;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueCurveAtTime(whooshCurve, startTime, duration);

      // Connect node graph
      noiseSource.connect(filter);
      filter.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Start & stop source
      noiseSource.start(startTime, Math.random() * 0.5);
      noiseSource.stop(startTime + duration + 0.015);

      // Clean up nodes
      const cleanup = () => {
        try {
          noiseSource.disconnect();
          filter.disconnect();
          masterGain.disconnect();
        } catch {
          // Context already released
        }
      };
      noiseSource.onended = cleanup;
      setTimeout(cleanup, Math.ceil((duration + timeOffsetSec + 0.1) * 1000));
    } catch {
      // Audio autoplay policy fallback
    }
  }

  // Alias for backward compatibility with EditorStudio & tests
  public playZoomWhoosh(
    volumeOrOpts?: number | SfxOptions,
    speed?: number,
    timeOffset?: number
  ): void {
    this.playCameraWhoosh(volumeOrOpts, speed, timeOffset);
  }
}

export default SfxSynthesizer;

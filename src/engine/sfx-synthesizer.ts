// Zero-dependency procedural UI sound effects synthesizer using the native Web Audio API.
// No external audio files are required; all sounds are generated at runtime ($0 cost).

export class SfxSynthesizer {
  private audioCtx: AudioContext | null = null;
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

  // Release the shared AudioContext. Safe to call multiple times.
  public dispose(): void {
    try {
      if (this.audioCtx) {
        void this.audioCtx.close();
        this.audioCtx = null;
      }
    } catch {
      // Context already closed
    }
  }

  private getAudioContext(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.audioCtx) {
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) return null;
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  // Crisp, subtle 40ms sine/triangle pitch-drop pop for click ripples
  public playClickPop(volume: number = 0.35): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.035);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.045);
    } catch {
      // Audio autoplay policy fallback
    }
  }

  // Soft filtered noise + low-frequency thock for keyboard shortcut badges
  public playKeyThock(volume: number = 0.3): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.05);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(300, now);
      filter.Q.setValueAtTime(3.5, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      // Low-frequency thock
      const thock = ctx.createOscillator();
      const thockGain = ctx.createGain();
      thock.type = 'sine';
      thock.frequency.setValueAtTime(110, now);
      thock.frequency.exponentialRampToValueAtTime(60, now + 0.06);
      thockGain.gain.setValueAtTime(volume * 0.6, now);
      thockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      thock.connect(thockGain);
      thockGain.connect(ctx.destination);

      noise.start(now);
      noise.stop(now + 0.055);
      thock.start(now);
      thock.stop(now + 0.09);
    } catch {
      // Audio autoplay policy fallback
    }
  }

  // Gentle band-pass filtered noise sweep for zoom pill transitions
  public playZoomWhoosh(volume: number = 0.25): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const duration = 0.32;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(150, now);
      filter.frequency.exponentialRampToValueAtTime(720, now + duration * 0.5);
      filter.frequency.exponentialRampToValueAtTime(190, now + duration);
      filter.Q.setValueAtTime(2.4, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volume, now + duration * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(now);
      noise.stop(now + duration + 0.02);
    } catch {
      // Audio autoplay policy fallback
    }
  }
}

export default SfxSynthesizer;
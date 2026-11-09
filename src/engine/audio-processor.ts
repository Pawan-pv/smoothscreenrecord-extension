import { SilenceSegment, ClickEvent, KeystrokeEvent } from '../types/telemetry';

export class AudioProcessor {
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // Decodes audio from recorded video blob and detects pauses > 1.2s
  public async analyzeSilences(
    videoBlob: Blob,
    clicks: ClickEvent[] = [],
    keystrokes: KeystrokeEvent[] = [],
    dbThreshold = -42,
    minSilenceDurationMs = 1200
  ): Promise<SilenceSegment[]> {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const ctx = this.getAudioContext();

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      console.warn('[SmoothStudio Audio] Could not decode audio track, assuming no silence segments.');
      return [];
    }

    const channelData = audioBuffer.getChannelData(0); // primary channel
    const sampleRate = audioBuffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.05); // 50ms window
    const totalWindows = Math.floor(channelData.length / windowSize);

    const silences: SilenceSegment[] = [];
    let silenceStartMs: number | null = null;

    for (let w = 0; w < totalWindows; w++) {
      const startIdx = w * windowSize;
      let sumSquares = 0;

      for (let i = 0; i < windowSize; i++) {
        const val = channelData[startIdx + i];
        sumSquares += val * val;
      }

      const rms = Math.sqrt(sumSquares / windowSize);
      const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
      const currentMs = (w * windowSize * 1000) / sampleRate;

      if (db < dbThreshold) {
        if (silenceStartMs === null) {
          silenceStartMs = currentMs;
        }
      } else {
        if (silenceStartMs !== null) {
          const duration = currentMs - silenceStartMs;
          if (duration >= minSilenceDurationMs) {
            // Check if user was clicking or typing during this pause
            const hasActivity =
              clicks.some((c) => c.t >= silenceStartMs! && c.t <= currentMs) ||
              keystrokes.some((k) => k.t >= silenceStartMs! && k.t <= currentMs);

            if (!hasActivity) {
              silences.push({
                id: 'silence_' + Math.round(silenceStartMs),
                startTime: Math.round(silenceStartMs),
                endTime: Math.round(currentMs),
                duration: Math.round(duration),
                markedForCut: true
              });
            }
          }
          silenceStartMs = null;
        }
      }
    }

    // Flush trailing silence
    if (silenceStartMs !== null) {
      const duration = (audioBuffer.duration * 1000) - silenceStartMs;
      if (duration >= minSilenceDurationMs) {
        silences.push({
          id: 'silence_' + Math.round(silenceStartMs),
          startTime: Math.round(silenceStartMs),
          endTime: Math.round(audioBuffer.duration * 1000),
          duration: Math.round(duration),
          markedForCut: true
        });
      }
    }

    return silences;
  }

  // PROCEDURAL SOUND DESIGN ($0 Server / Asset Cost)

  // 1. Soft Mouse Click Pop
  public playClickPop(volume = 0.35) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Pitch drop from 750Hz down to 220Hz in 30ms
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.035);

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

  // 2. Mechanical Keyboard Thock
  public playKeyboardThock(volume = 0.3) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      // Noise burst for key click
      const bufferSize = ctx.sampleRate * 0.04;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      // Resonant bandpass filter
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320, now);
      filter.Q.setValueAtTime(4.0, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(now);
      noise.stop(now + 0.05);
    } catch {
      // Audio autoplay policy fallback
    }
  }

  // 3. Cinematic Camera Zoom Whoosh
  public playCameraWhoosh(volume = 0.25) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const duration = 0.32;

      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(140, now);
      filter.frequency.exponentialRampToValueAtTime(750, now + duration * 0.5);
      filter.frequency.exponentialRampToValueAtTime(180, now + duration);
      filter.Q.setValueAtTime(2.5, now);

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

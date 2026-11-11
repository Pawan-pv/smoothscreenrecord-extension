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

  /**
   * Decodes the audio track of a recording blob.
   * Returns null when the recording carries no decodable audio (for example a
   * screen capture recorded without a microphone).
   */
  public async decodeAudioBuffer(videoBlob: Blob): Promise<AudioBuffer | null> {
    if (!videoBlob || videoBlob.size === 0) return null;
    try {
      const arrayBuffer = await videoBlob.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) return null;
      const ctx = this.getAudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (!decoded || decoded.numberOfChannels === 0 || decoded.length === 0) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Builds a real amplitude envelope from the recorded audio track.
   * Returns an empty array when the recording has no audio, so the UI can
   * truthfully render "No audio" instead of invented bars.
   */
  public async buildWaveformPeaks(videoBlob: Blob, buckets = 160): Promise<number[]> {
    const audioBuffer = await this.decodeAudioBuffer(videoBlob);
    if (!audioBuffer) {
      console.log('[SmoothStudio Audio] No decodable audio track: waveform will not be drawn.');
      return [];
    }
    const channelData = audioBuffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channelData.length / buckets));
    const peaks: number[] = [];
    let maxAbs = 0;
    for (let b = 0; b < buckets; b++) {
      const start = b * bucketSize;
      const end = Math.min(channelData.length, start + bucketSize);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(channelData[i]);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
      if (peak > maxAbs) maxAbs = peak;
    }
    if (maxAbs > 0) {
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] = peaks[i] / maxAbs;
      }
    }
    console.log(`[SmoothStudio Audio] Waveform built from ${audioBuffer.duration.toFixed(2)}s of real audio: ${peaks.length} buckets.`);
    return peaks;
  }

  // Decodes audio from recorded video blob and detects pauses > 1.2s
  public async analyzeSilences(
    videoBlob: Blob,
    clicks: ClickEvent[] = [],
    keystrokes: KeystrokeEvent[] = [],
    dbThreshold = -42,
    minSilenceDurationMs = 1200,
    videoDurationMs = 10000
  ): Promise<SilenceSegment[]> {
    try {
      if (!videoBlob || videoBlob.size === 0) {
        return [];
      }

      const arrayBuffer = await videoBlob.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        return [];
      }

      const ctx = this.getAudioContext();

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } catch {
        console.log('[SmoothStudio Audio] No audio track detected or decode failed. Auto-cut disabled (0 cuts).');
        return [];
      }

      if (!audioBuffer || audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
        console.log('[SmoothStudio Audio] AudioBuffer has 0 channels or empty audio. Auto-cut disabled (0 cuts).');
        return [];
      }

      const channelData = audioBuffer.getChannelData(0); // primary channel
      const silences = detectSilenceSegments(
        channelData, audioBuffer.sampleRate, clicks, keystrokes, dbThreshold, minSilenceDurationMs
      );

      return silences;
    } catch (err) {
      console.warn('[SmoothStudio Audio] Silence analysis exception caught, returning empty silences:', err);
      return [];
    }
  }

  // Activity gap fallback when audio track is silent, unrecorded, or missing
  public detectActivityGapSilences(
    clicks: ClickEvent[] = [],
    keystrokes: KeystrokeEvent[] = [],
    durationMs = 10000,
    minSilenceDurationMs = 1200
  ): SilenceSegment[] {
    const silences: SilenceSegment[] = [];
    const eventTimes = [
      ...clicks.map((c) => c.t),
      ...keystrokes.map((k) => k.t)
    ].sort((a, b) => a - b);

    if (eventTimes.length === 0) {
      if (durationMs > minSilenceDurationMs * 2) {
        const midStart = Math.round(durationMs * 0.35);
        const midEnd = Math.round(durationMs * 0.55);
        silences.push({
          id: 'silence_' + midStart,
          startTime: midStart,
          endTime: midEnd,
          duration: midEnd - midStart,
          markedForCut: true
        });
      }
      return silences;
    }

    let prevTime = 0;
    for (const t of eventTimes) {
      const gap = t - prevTime;
      if (gap >= minSilenceDurationMs) {
        const start = Math.round(prevTime + 200);
        const end = Math.round(t - 200);
        if (end - start >= minSilenceDurationMs) {
          silences.push({
            id: 'silence_' + start,
            startTime: start,
            endTime: end,
            duration: end - start,
            markedForCut: true
          });
        }
      }
      prevTime = t;
    }

    if (durationMs - prevTime >= minSilenceDurationMs) {
      const start = Math.round(prevTime + 200);
      const end = Math.round(durationMs - 100);
      if (end - start >= minSilenceDurationMs) {
        silences.push({
          id: 'silence_' + start,
          startTime: start,
          endTime: end,
          duration: end - start,
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

/**
 * Pure silence detector over one channel of PCM: pauses of at least
 * `minSilenceDurationMs` during which the user neither clicked nor typed.
 *
 * QA-021: a REAL microphone in a real room never delivers digital silence: the
 * AGC lifts the room noise, so the pauses of a voice-over sit 20-25 dB under
 * the speech but well above a fixed -42 dBFS (measured: speech -15 dBFS,
 * pauses -33..-41 dBFS). The threshold therefore adapts to the recording: it is
 * the midpoint between the recording's speech level (90th percentile of the
 * 50 ms windows) and its quiet level (10th percentile) whenever the two differ
 * by at least 12 dB, and never stricter than `dbThreshold`. Without that
 * contrast (nobody speaks) the fixed `dbThreshold` applies, so room noise alone
 * is never cut. A single blip of up to 100 ms does not end a pause.
 */
export function detectSilenceSegments(
  channelData: Float32Array,
  sampleRate: number,
  clicks: ClickEvent[] = [],
  keystrokes: KeystrokeEvent[] = [],
  dbThreshold = -42,
  minSilenceDurationMs = 1200
): SilenceSegment[] {
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms window
  const totalWindows = Math.floor(channelData.length / windowSize);
  const totalMs = (channelData.length * 1000) / sampleRate;
  const windowMs = (windowSize * 1000) / sampleRate;
  const MIN_CONTRAST_DB = 12;
  const MAX_BLIP_WINDOWS = 2; // 100 ms

  const levels = new Float32Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    const startIdx = w * windowSize;
    let sumSquares = 0;
    for (let i = 0; i < windowSize; i++) {
      const val = channelData[startIdx + i];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    levels[w] = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
  }

  let threshold = dbThreshold;
  if (totalWindows >= 20) {
    const sorted = Array.from(levels).sort((x, y) => x - y);
    const quiet = sorted[Math.floor(sorted.length * 0.1)];
    const speech = sorted[Math.floor(sorted.length * 0.9)];
    if (speech - quiet >= MIN_CONTRAST_DB) {
      threshold = Math.max(dbThreshold, (quiet + speech) / 2);
    }
  }

  const silences: SilenceSegment[] = [];
  const push = (startMs: number, endMs: number) => {
    const duration = endMs - startMs;
    if (duration < minSilenceDurationMs) return;
    // Check if user was clicking or typing during this pause
    const hasActivity =
      clicks.some((c) => c.t >= startMs && c.t <= endMs) ||
      keystrokes.some((k) => k.t >= startMs && k.t <= endMs);
    if (hasActivity) return;
    silences.push({
      id: 'silence_' + Math.round(startMs),
      startTime: Math.round(startMs),
      endTime: Math.round(endMs),
      duration: Math.round(duration),
      markedForCut: true
    });
  };

  let silenceStartW: number | null = null;
  let loudRun = 0;
  for (let w = 0; w < totalWindows; w++) {
    if (levels[w] < threshold) {
      if (silenceStartW === null) silenceStartW = w;
      loudRun = 0;
    } else if (silenceStartW !== null) {
      loudRun++;
      if (loudRun > MAX_BLIP_WINDOWS) {
        // the pause ended where the loud run began
        push(silenceStartW * windowMs, (w - loudRun + 1) * windowMs);
        silenceStartW = null;
        loudRun = 0;
      }
    }
  }

  // Flush trailing silence
  if (silenceStartW !== null) {
    const endMs = loudRun > 0 ? (totalWindows - loudRun) * windowMs : totalMs;
    push(silenceStartW * windowMs, endMs);
  }

  return silences;
}

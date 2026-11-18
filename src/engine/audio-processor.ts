import { SilenceSegment, ClickEvent, KeystrokeEvent } from '../types/telemetry';
import { readWebmAudioStartMs } from './webm-timestamps';

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
      // QA-011: the container may start the audio track later than the video.
      // decodeAudioData drops that offset; put the samples back on the media
      // timeline so waveform, silence detection and cuts line up with clicks.
      const audioStartMs = await readWebmAudioStartMs(videoBlob);
      return this.alignDecodedBuffer(ctx, decoded, audioStartMs);
    } catch {
      return null;
    }
  }

  /** Prepends the missing track-start span (capped) without touching the samples. */
  private alignDecodedBuffer(ctx: AudioContext, decoded: AudioBuffer, startTimeMs: number): AudioBuffer {
    if (!Number.isFinite(startTimeMs) || startTimeMs <= 0) return decoded;
    const capped = Math.min(startTimeMs, 60_000);
    const pad = Math.round((capped / 1000) * decoded.sampleRate);
    if (pad <= 0) return decoded;
    const out = ctx.createBuffer(decoded.numberOfChannels, decoded.length + pad, decoded.sampleRate);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      out.getChannelData(c).set(decoded.getChannelData(c), pad);
    }
    return out;
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
 * QA-021: a REAL microphone in a real room never delivers digital silence. The
 * pauses of a voice-over sit well under the speech but on top of room noise,
 * and that noise floor moves during a recording (a fan, a road, AGC). A single
 * global midpoint therefore fails twice: it cannot separate speech from a
 * continuous fan that is only ~9 dB under the voice, and it misses pauses after
 * the noise floor has risen.
 *
 * Per window the threshold is therefore the lower of:
 *  - the local noise floor (10th percentile of the surrounding 4 s) + 8 dB,
 *    never below the absolute `dbThreshold`, and
 *  - the speech peak of the surroundings and of the whole recording, minus 6 dB.
 *
 * The second term is what protects quiet speech: a syllable dip is brief, and a
 * sustained 6 dB drop below everything the speaker produced nearby is a pause,
 * not articulation. Adaptation only happens when the recording shows at least
 * 6 dB of contrast, so steady room noise or music is never cut. A single blip of
 * up to 100 ms does not end a pause.
 *
 * Two guards keep the result honest:
 *  - a recording whose loudest window is below `dbThreshold` has no audible
 *    content at all; tightening it would delete the whole timeline, so it is
 *    returned unchanged;
 *  - a pause only starts after 300 ms of *uninterrupted* quiet, so a 50 ms
 *    syllable dip just before a pause cannot drag the cut into the speaker's
 *    last syllable (and symmetrically at the end).
 */
export function detectSilenceSegments(
  channelData: Float32Array,
  sampleRate: number,
  clicks: ClickEvent[] = [],
  keystrokes: KeystrokeEvent[] = [],
  dbThreshold = -42,
  minSilenceDurationMs = 1200
): SilenceSegment[] {
  // A decoder that reports no usable sample rate cannot be analysed; return a
  // safe no-op instead of allocating an Infinity-sized levels array.
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  if (!channelData || channelData.length === 0) return [];

  const windowSize = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms window
  const totalWindows = Math.floor(channelData.length / windowSize);
  const totalMs = (channelData.length * 1000) / sampleRate;
  const windowMs = (windowSize * 1000) / sampleRate;
  const MIN_CONTRAST_DB = 6;
  const FLOOR_MARGIN_DB = 8;
  const DROP_BELOW_SPEECH_DB = 6;
  const MAX_BLIP_WINDOWS = 2; // 100 ms
  /** 300 ms of uninterrupted quiet: enough to exclude a syllable dip. */
  const CORE_WINDOWS = Math.max(1, Math.ceil(300 / windowMs));
  /** 2 s of context on each side: a 2 s pause still shows speech in the window. */
  const LOCAL_RADIUS_WINDOWS = Math.max(4, Math.round(2000 / windowMs));
  const thresholdDb = Number.isFinite(dbThreshold) ? dbThreshold : -42;
  const minPauseMs = Number.isFinite(minSilenceDurationMs) && minSilenceDurationMs >= 0
    ? minSilenceDurationMs
    : 1200;

  const levels = new Float32Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    const startIdx = w * windowSize;
    let sumSquares = 0;
    let invalid = false;
    for (let i = 0; i < windowSize; i++) {
      const val = channelData[startIdx + i];
      if (!Number.isFinite(val)) { invalid = true; break; }
      sumSquares += val * val;
    }
    // Never cut a window we could not analyse: treat it as full-scale.
    const rms = invalid ? 1 : Math.sqrt(sumSquares / windowSize);
    levels[w] = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
  }

  const percentile = (sorted: number[], p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];

  const sortedLevels = Array.from(levels).sort((x, y) => x - y);
  const globalQuiet = percentile(sortedLevels, 0.1);
  const globalSpeech = percentile(sortedLevels, 0.9);
  // Nothing in this recording reaches the absolute silence threshold, so there
  // is no audible speech to tighten. Cutting it would delete every frame.
  if (sortedLevels[sortedLevels.length - 1] < thresholdDb) return [];
  const adaptive = totalWindows >= 20 && globalSpeech - globalQuiet >= MIN_CONTRAST_DB;

  /** Silence threshold for one window, in dBFS. */
  const thresholdFor = (w: number): number => {
    if (!adaptive) return thresholdDb;
    const start = Math.max(0, w - LOCAL_RADIUS_WINDOWS);
    const end = Math.min(totalWindows, w + LOCAL_RADIUS_WINDOWS + 1);
    const local = Array.from(levels.subarray(start, end)).sort((x, y) => x - y);
    const localFloor = percentile(local, 0.1);
    const localPeak = percentile(local, 0.9);
    const floorThreshold = Math.max(thresholdDb, localFloor + FLOOR_MARGIN_DB);
    const dropThreshold = Math.max(localPeak, globalSpeech) - DROP_BELOW_SPEECH_DB;
    return Math.min(floorThreshold, dropThreshold);
  };
  const thresholds = new Float32Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) thresholds[w] = thresholdFor(w);

  const silences: SilenceSegment[] = [];
  const push = (startMs: number, endMs: number) => {
    const duration = endMs - startMs;
    if (duration < minPauseMs) return;
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

  /** First window of the earliest uninterrupted quiet core, or the raw start. */
  const quietCoreStart = (startW: number, endW: number): number => {
    for (let s = startW; s + CORE_WINDOWS <= endW; s++) {
      let quiet = true;
      for (let k = 0; k < CORE_WINDOWS; k++) {
        if (!(levels[s + k] < thresholds[s + k])) { quiet = false; break; }
      }
      if (quiet) return s;
    }
    return startW;
  };

  /** Last window of the latest uninterrupted quiet core, or the raw end. */
  const quietCoreEnd = (startW: number, endW: number): number => {
    for (let e = endW; e - CORE_WINDOWS >= startW; e--) {
      let quiet = true;
      for (let k = e - CORE_WINDOWS; k < e; k++) {
        if (!(levels[k] < thresholds[k])) { quiet = false; break; }
      }
      if (quiet) return e;
    }
    return endW;
  };

  const pushRun = (startW: number, endW: number) => {
    const s = quietCoreStart(startW, endW);
    const e = quietCoreEnd(s, endW);
    push(s * windowMs, e * windowMs);
  };

  let silenceStartW: number | null = null;
  let loudRun = 0;
  for (let w = 0; w < totalWindows; w++) {
    if (levels[w] < thresholds[w]) {
      if (silenceStartW === null) silenceStartW = w;
      loudRun = 0;
    } else if (silenceStartW !== null) {
      loudRun++;
      if (loudRun > MAX_BLIP_WINDOWS) {
        // the pause ended where the loud run began
        pushRun(silenceStartW, w - loudRun + 1);
        silenceStartW = null;
        loudRun = 0;
      }
    }
  }

  // Flush trailing silence
  if (silenceStartW !== null) {
    const endW = loudRun > 0 ? totalWindows - loudRun : totalWindows;
    pushRun(silenceStartW, endW);
  }

  // A "pause" that spans (nearly) the whole recording is not a pause: there is
  // no speech left to tighten. Keeping it would export an empty timeline.
  const cutMs = silences.reduce((sum, s) => sum + s.duration, 0);
  if (cutMs >= totalMs * 0.95) return [];

  return silences;
}

// Audio path for MP4 export (C2).
// Rules: no swallowed errors and no substituted audio. If the recording has an
// audio track it must decode and encode, or the export fails with an error.

import { readWebmAudioStartMs } from './webm-timestamps';
import { composeTrimAndCuts, TimeRangeMs } from './export-timeline';
export type { TimeRangeMs };

export interface PcmTrack {
  /** One Float32Array per channel, all the same length. */
  channels: Float32Array[];
  sampleRate: number;
}

/**
 * Largest leading offset we will ever synthesize. A corrupt EBML timestamp must
 * not make the exporter allocate minutes of silence.
 */
const MAX_ALIGNMENT_MS = 60_000;

/**
 * Places decoded PCM on the media timeline (QA-011).
 *
 * `decodeAudioData` returns the audio track from its first sample with time 0,
 * even when the container says the track starts later than the video. Padding
 * the missing leading span makes PCM time equal the video element's
 * `currentTime`, so cuts, silence detection and the muxed MP4 all share one
 * timing reference. Zero/negative offsets are returned unchanged: no invented
 * delay.
 */
export function alignPcmToTimeline(pcm: PcmTrack, startTimeMs: number): PcmTrack {
  if (!Number.isFinite(startTimeMs) || startTimeMs <= 0) return pcm;
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0) return pcm;
  const capped = Math.min(startTimeMs, MAX_ALIGNMENT_MS);
  const padSamples = Math.round((capped / 1000) * pcm.sampleRate);
  if (padSamples <= 0) return pcm;
  const channels = pcm.channels.map((src) => {
    const out = new Float32Array(src.length + padSamples);
    out.set(src, padSamples);
    return out;
  });
  return { channels, sampleRate: pcm.sampleRate };
}




/**
 * True when the WebM container declares an audio track (Opus or Vorbis).
 * The codec ID lives in the Tracks element at the start of the file, so only
 * the first few MB are scanned.
 */
export function webmHasAudioTrack(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 4 * 1024 * 1024);
  const find = (needle: string): boolean => {
    const n = needle.length;
    outer: for (let i = 0; i <= limit - n; i++) {
      for (let j = 0; j < n; j++) {
        if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
      }
      return true;
    }
    return false;
  };
  return find('A_OPUS') || find('A_VORBIS');
}

/**
 * Decodes the recording's audio track. Throws if the audio cannot be decoded:
 * the caller must treat that as a failed export, not as "no audio".
 */
export async function decodeRecordingPcm(blob: Blob): Promise<PcmTrack> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 0 || decoded.length === 0) {
      throw new Error('The recording contains an audio track with no samples.');
    }
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      channels.push(new Float32Array(decoded.getChannelData(c)));
    }
    const audioStartMs = await readWebmAudioStartMs(blob);
    return alignPcmToTimeline({ channels, sampleRate: decoded.sampleRate }, audioStartMs);
  } catch (err: any) {
    throw new Error(`Could not decode the recording's audio track: ${err?.message || err}`);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Length of the PCM track in milliseconds. */
export function pcmDurationMs(pcm: PcmTrack): number {
  const len = pcm.channels.length ? Math.max(...pcm.channels.map((c) => c.length)) : 0;
  if (!pcm.sampleRate || pcm.sampleRate <= 0) return 0;
  return (len * 1000) / pcm.sampleRate;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Complement of the cut ranges inside [trimStartMs, trimEndMs]: the spans that stay in the export. */
export function keepRangesFromCuts(
  cuts: TimeRangeMs[],
  durationMs: number,
  trimStartMs: number = 0,
  trimEndMs?: number
): TimeRangeMs[] {
  return composeTrimAndCuts(cuts, durationMs, trimStartMs, trimEndMs);
}

/**
 * Concatenates the kept spans of the PCM track, so audio is cut at exactly the
 * same places as the video timeline.
 *
 * Throws when the result has no samples: an MP4 with a declared but empty AAC
 * track is a broken export, not "silent audio" (C2: no substituted audio).
 */
export function cutPcmToKeepRanges(pcm: PcmTrack, keep: TimeRangeMs[], fadeMs: number = 15): PcmTrack {
  if (!pcm.channels.length) {
    throw new Error('The recording has no audio channels to cut.');
  }
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0) {
    throw new Error(`The recording's audio has an invalid sample rate (${pcm.sampleRate}).`);
  }
  const totalLen = Math.min(...pcm.channels.map((c) => c.length));
  if (totalLen === 0) {
    throw new Error("The recording's audio track has no samples.");
  }

  const spans: Array<{ from: number; to: number }> = [];
  for (const r of keep) {
    if (!Number.isFinite(r?.startTime) || !Number.isFinite(r?.endTime)) continue;
    const from = clamp(Math.floor((r.startTime / 1000) * pcm.sampleRate), 0, totalLen);
    const to = clamp(Math.floor((r.endTime / 1000) * pcm.sampleRate), 0, totalLen);
    if (to > from) spans.push({ from, to });
  }
  // Merge overlapping spans: the same sample must never be written twice.
  spans.sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) {
      last.to = Math.max(last.to, s.to);
    } else {
      merged.push({ ...s });
    }
  }

  const outLen = merged.reduce((sum, s) => sum + (s.to - s.from), 0);
  if (outLen === 0) {
    throw new Error('The cut ranges removed the whole audio track: the export would have no audio.');
  }

  const targetFadeSamples = Number.isFinite(fadeMs) && fadeMs > 0
    ? Math.round((fadeMs / 1000) * pcm.sampleRate)
    : 0;

  const channels = pcm.channels.map((src) => {
    const out = new Float32Array(outLen);
    let w = 0;
    for (let i = 0; i < merged.length; i++) {
      const s = merged[i];
      const spanLen = s.to - s.from;
      out.set(src.subarray(s.from, s.to), w);

      const fadeSamples = Math.min(targetFadeSamples, Math.floor(spanLen / 2));
      if (fadeSamples > 0) {
        // Apply smooth cosine micro-fade at cut boundaries.
        // Do not fade the very beginning of the recording or the very end unless trimmed.
        const hasFadeIn = i > 0 || s.from > 0;
        const hasFadeOut = i < merged.length - 1 || s.to < totalLen;

        if (hasFadeIn) {
          for (let k = 0; k < fadeSamples; k++) {
            const factor = 0.5 * (1 - Math.cos((Math.PI * k) / fadeSamples));
            out[w + k] *= factor;
          }
        }

        if (hasFadeOut) {
          for (let k = 0; k < fadeSamples; k++) {
            const factor = 0.5 * (1 + Math.cos((Math.PI * (k + 1)) / fadeSamples));
            out[w + spanLen - fadeSamples + k] *= factor;
          }
        }
      }

      w += spanLen;
    }
    return out;
  });
  return { channels, sampleRate: pcm.sampleRate };
}

export const AAC_CODEC = 'mp4a.40.2';
export const AAC_OUTPUT_CHANNELS = 2;
export const AAC_BITRATE = 160_000;
const AAC_FRAME_SAMPLES = 1024;

export interface AacChunk {
  data: Uint8Array;
  type: 'key' | 'delta';
  timestamp: number; // microseconds
  duration: number;  // microseconds
  meta?: EncodedAudioChunkMetadata;
}

/**
 * AAC-LC has no "start at sample 0" concept: the encoder prepends one frame of
 * priming (1024 samples = 21.3 ms at 48 kHz), and an MP4 without an edit list
 * makes every player decode that priming as audio. Measured on the real
 * exporter (QA-011): the exported tone ran 27.6 ms late against the video flash;
 * 21.3 ms of that was the un-compensated priming.
 *
 * The first encoded packet is therefore held back: if more packets follow, it is
 * pure priming and is dropped, and the remaining packets are shifted back by one
 * AAC frame so the first real sample sits at media time 0. A recording shorter
 * than one AAC frame keeps its only packet (nothing to compensate).
 */
function emitWithoutPriming(chunks: AacChunk[], sampleRate: number): AacChunk[] {
  if (chunks.length < 2) return chunks;
  const primingUs = Math.round((AAC_FRAME_SAMPLES / sampleRate) * 1_000_000);
  return chunks.slice(1).map((chunk) => ({
    ...chunk,
    timestamp: Math.max(0, chunk.timestamp - primingUs),
  }));
}

/** Timing helper exposed for the regression tests (see QA-011). */
export const stripAacPriming = emitWithoutPriming;

/**
 * Encodes PCM to AAC-LC. Mono input is duplicated to stereo so every player
 * handles the track. Throws if AAC is not supported or the encoder fails.
 */
export async function encodeAac(pcm: PcmTrack, onChunk: (chunk: AacChunk) => void): Promise<number> {
  const config: AudioEncoderConfig = {
    codec: AAC_CODEC,
    sampleRate: pcm.sampleRate,
    numberOfChannels: AAC_OUTPUT_CHANNELS,
    bitrate: AAC_BITRATE,
  };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`AAC audio encoding (${AAC_CODEC}, ${pcm.sampleRate} Hz) is not supported by this browser. Export aborted.`);
  }

  let encoderError: Error | null = null;
  const encoded: AacChunk[] = [];
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encoded.push({
        data,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? Math.round((AAC_FRAME_SAMPLES / pcm.sampleRate) * 1_000_000),
        meta,
      });
    },
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(config);

  const left = pcm.channels[0];
  const right = pcm.channels[1] ?? pcm.channels[0];
  const total = left.length;
  try {
    // QA-046: Chrome's AAC encoder consumes one frame of input into its priming
    // packet, and emitWithoutPriming drops that packet and shifts every later
    // packet back by one AAC frame. Measured on a real export, that moved the
    // whole track exactly 21.3 ms ahead of the raw recording's media timeline
    // (the recorded stream's 49 ms start was padded, but the encoded content
    // began at 27.7 ms). Feeding one frame of silence first keeps the priming
    // inside that silence, so the kept packets stay where the PCM put them.
    const priming = new AudioData({
      format: 'f32-planar',
      sampleRate: pcm.sampleRate,
      numberOfFrames: AAC_FRAME_SAMPLES,
      numberOfChannels: 2,
      timestamp: 0,
      data: new Float32Array(AAC_FRAME_SAMPLES * 2),
    });
    encoder.encode(priming);
    priming.close();
    for (let start = 0; start < total; start += AAC_FRAME_SAMPLES) {
      if (encoderError) throw encoderError;
      const frames = Math.min(AAC_FRAME_SAMPLES, total - start);
      const planar = new Float32Array(frames * 2);
      planar.set(left.subarray(start, start + frames), 0);
      planar.set(right.subarray(start, start + frames), frames);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: pcm.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round(((start + AAC_FRAME_SAMPLES) / pcm.sampleRate) * 1_000_000),
        data: planar,
      });
      encoder.encode(audioData);
      audioData.close();
      // Backpressure: keep the encoder queue bounded for long recordings.
      while (encoder.encodeQueueSize > 64) {
        await new Promise((r) => setTimeout(r, 2));
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    try { encoder.close(); } catch { /* already closed after error */ }
  }

  const chunks = emitWithoutPriming(encoded, pcm.sampleRate);
  for (const chunk of chunks) onChunk(chunk);
  return chunks.length;
}

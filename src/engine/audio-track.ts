// Audio path for MP4 export (C2).
// Rules: no swallowed errors and no substituted audio. If the recording has an
// audio track it must decode and encode, or the export fails with an error.

export interface PcmTrack {
  /** One Float32Array per channel, all the same length. */
  channels: Float32Array[];
  sampleRate: number;
}

export interface TimeRangeMs {
  startTime: number;
  endTime: number;
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
    return { channels, sampleRate: decoded.sampleRate };
  } catch (err: any) {
    throw new Error(`Could not decode the recording's audio track: ${err?.message || err}`);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Complement of the cut ranges inside [0, durationMs]: the spans that stay in the export. */
export function keepRangesFromCuts(cuts: TimeRangeMs[], durationMs: number): TimeRangeMs[] {
  const sorted = [...cuts].sort((a, b) => a.startTime - b.startTime);
  const keep: TimeRangeMs[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.startTime > cursor) keep.push({ startTime: cursor, endTime: c.startTime });
    cursor = Math.max(cursor, c.endTime);
  }
  if (cursor < durationMs) keep.push({ startTime: cursor, endTime: durationMs });
  return keep;
}

/**
 * Concatenates the kept spans of the PCM track, so audio is cut at exactly the
 * same places as the video timeline.
 */
export function cutPcmToKeepRanges(pcm: PcmTrack, keep: TimeRangeMs[]): PcmTrack {
  const totalLen = pcm.channels[0].length;
  const spans = keep.map((r) => ({
    from: Math.min(totalLen, Math.floor((r.startTime / 1000) * pcm.sampleRate)),
    to: Math.min(totalLen, Math.floor((r.endTime / 1000) * pcm.sampleRate)),
  })).filter((s) => s.to > s.from);
  const outLen = spans.reduce((sum, s) => sum + (s.to - s.from), 0);
  const channels = pcm.channels.map((src) => {
    const out = new Float32Array(outLen);
    let w = 0;
    for (const s of spans) {
      out.set(src.subarray(s.from, s.to), w);
      w += s.to - s.from;
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
  let chunkCount = 0;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      chunkCount++;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      onChunk({
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
        timestamp: Math.round((start / pcm.sampleRate) * 1_000_000),
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
  return chunkCount;
}

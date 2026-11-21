import { describe, it, expect } from 'vitest';
import {
  alignPcmToTimeline,
  cutPcmToKeepRanges,
  keepRangesFromCuts,
  pcmDurationMs,
  stripAacPriming,
  type AacChunk,
  type PcmTrack
} from '../../src/engine/audio-track';

const SR = 48000;

function ramp(start: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = start + i;
  return out;
}

function track(channels: Float32Array[], sampleRate = SR): PcmTrack {
  return { channels, sampleRate };
}

describe('audio track alignment (QA-011 / QA-002)', () => {
  it('pads the missing leading span so PCM time equals media time', () => {
    const pcm = track([ramp(1, 4800)]);
    const aligned = alignPcmToTimeline(pcm, 782);
    // 782 ms at 48 kHz = 37536 samples of leading silence.
    expect(aligned.channels[0].length).toBe(4800 + 37536);
    expect(Array.from(aligned.channels[0].slice(0, 37536)).every((v) => v === 0)).toBe(true);
    expect(aligned.channels[0][37536]).toBe(1);
    expect(pcmDurationMs(aligned)).toBeCloseTo(((4800 + 37536) / SR) * 1000, 3);
  });

  it('pads every channel with the same offset', () => {
    const aligned = alignPcmToTimeline(track([ramp(1, 480), ramp(100, 480)]), 100);
    expect(aligned.channels[0].length).toBe(aligned.channels[1].length);
    expect(aligned.channels[0][4800]).toBe(1);
    expect(aligned.channels[1][4800]).toBe(100);
  });

  it('is a no-op for zero, negative and non-finite offsets (no invented delay)', () => {
    const pcm = track([ramp(1, 480)]);
    expect(alignPcmToTimeline(pcm, 0)).toBe(pcm);
    expect(alignPcmToTimeline(pcm, -50)).toBe(pcm);
    expect(alignPcmToTimeline(pcm, NaN)).toBe(pcm);
  });

  it('caps a corrupt container offset instead of allocating unlimited silence', () => {
    const aligned = alignPcmToTimeline(track([ramp(1, 10)]), 10 * 60_000);
    expect(aligned.channels[0].length).toBe(10 + 60 * SR);
  });

  it('keeps the cut geometry in media time after alignment', () => {
    // 1 s of content that starts at media 782 ms; cut media [0, 500).
    const aligned = alignPcmToTimeline(track([ramp(1, SR)]), 782);
    const keep = keepRangesFromCuts([{ startTime: 0, endTime: 500 }], 1782);
    const cut = cutPcmToKeepRanges(aligned, keep);
    // The first kept span starts at 500 ms, still inside the leading silence.
    expect(cut.channels[0][0]).toBe(0);
    // At media 782 ms the original first sample appears: 282 ms after the cut.
    const index = Math.round(((782 - 500) / 1000) * SR);
    expect(cut.channels[0][index]).toBe(1);
  });

  it('does not truncate audio that outlives the video (QA-002)', () => {
    // 400 ms of audio beyond a 10 s wall-clock/video duration.
    const pcm = alignPcmToTimeline(track([ramp(1, 10_400 * 48)]), 0);
    const exportDuration = Math.ceil(Math.max(10_000, pcmDurationMs(pcm)));
    expect(exportDuration).toBe(10_400);
    const cut = cutPcmToKeepRanges(pcm, keepRangesFromCuts([], exportDuration));
    expect(pcmDurationMs(cut)).toBeCloseTo(10_400, 3);
  });

  it('handles a zero-length track without inventing samples', () => {
    expect(pcmDurationMs(track([new Float32Array(0)]))).toBe(0);
  });
});

describe('AAC encoder priming compensation (QA-011)', () => {
  const packet = (timestamp: number): AacChunk => ({
    data: new Uint8Array([1]),
    type: 'delta',
    timestamp,
    duration: 21333,
  });

  it('drops the priming packet and puts the next packet at media time 0', () => {
    const out = stripAacPriming([packet(0), packet(21333), packet(42666)], SR);
    expect(out.map((c) => c.timestamp)).toEqual([0, 21333]);
    expect(out).toHaveLength(2);
  });

  it('never produces a negative timestamp', () => {
    const out = stripAacPriming([packet(0), packet(20000)], SR);
    expect(out[0].timestamp).toBe(0);
  });

  it('keeps the only packet of a recording shorter than one AAC frame', () => {
    const out = stripAacPriming([packet(0)], SR);
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe(0);
  });
});

describe('AudioProcessor.analyzeSilences timeline alignment', () => {
  it('uses aligned decoded buffer so silence spans reflect track start offset', async () => {
    const { AudioProcessor } = await import('../../src/engine/audio-processor');
    const processor = new AudioProcessor();

    // Create a mock AudioBuffer: 4 s total, silence from 0.5s to 2.5s (2000 ms silence)
    const sampleRate = 48000;
    const channels = 1;
    const length = 4 * sampleRate;
    const mockChannelData = new Float32Array(length);
    // Fill 0.0s..0.5s with speech (-12 dBFS ~ 0.25)
    for (let i = 0; i < 0.5 * sampleRate; i++) {
      mockChannelData[i] = (i % 2 === 0 ? 1 : -1) * 0.25;
    }
    // 0.5s..2.5s is silence (0.0) -> 2000ms pause
    // 2.5s..4.0s with speech (-12 dBFS ~ 0.25)
    for (let i = Math.round(2.5 * sampleRate); i < length; i++) {
      mockChannelData[i] = (i % 2 === 0 ? 1 : -1) * 0.25;
    }

    const mockBuffer = {
      numberOfChannels: channels,
      sampleRate,
      length,
      duration: 4.0,
      getChannelData: () => mockChannelData,
    } as unknown as AudioBuffer;

    vi.spyOn(processor, 'decodeAudioBuffer').mockResolvedValue(mockBuffer);

    const dummyBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' });
    const silences = await processor.analyzeSilences(dummyBlob);

    expect(processor.decodeAudioBuffer).toHaveBeenCalledWith(dummyBlob);
    expect(silences).toHaveLength(1);
    // The silence should start around 500ms and end around 2500ms (accounting for 300ms core window guard)
    expect(Math.abs(silences[0].startTime - 500)).toBeLessThan(350);
    expect(Math.abs(silences[0].endTime - 2500)).toBeLessThan(350);
  });
});

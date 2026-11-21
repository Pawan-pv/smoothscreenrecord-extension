/**
 * QA-028: the GIF exporter used to allocate `outW * outH * frames * 0.4` bytes
 * with no ceiling (gigabytes for a long 1080p clip) and to accept any
 * maxDimension from the caller. These are the bounded replacements.
 */
import { describe, it, expect } from 'vitest';
import {
  GIF_MAX_BUFFER_BYTES,
  GIF_MAX_DIMENSION,
  GIF_MIN_BUFFER_BYTES,
  GIF_MIN_DIMENSION,
  assertGifBufferHasRoom,
  gifFrameHeadroomBytes,
  planGifBufferBytes,
  resolveGifMaxDimension
} from '../../src/engine/gif-budget';

describe('QA-028 GIF memory budget', () => {
  it('clamps the requested dimension into the supported range', () => {
    expect(resolveGifMaxDimension(640)).toBe(640);
    expect(resolveGifMaxDimension(840)).toBe(840);
    expect(resolveGifMaxDimension(4096)).toBe(GIF_MAX_DIMENSION);
    expect(resolveGifMaxDimension(10)).toBe(GIF_MIN_DIMENSION);
    expect(resolveGifMaxDimension(Number.NaN)).toBe(GIF_MAX_DIMENSION);
    expect(resolveGifMaxDimension(undefined)).toBe(GIF_MAX_DIMENSION);
  });

  it('never allocates less than the minimum or more than the cap', () => {
    const tiny = planGifBufferBytes(64, 36, 1);
    expect(tiny).toBe(GIF_MIN_BUFFER_BYTES);

    const huge = planGifBufferBytes(GIF_MAX_DIMENSION, GIF_MAX_DIMENSION, 100_000);
    expect(huge).toBe(GIF_MAX_BUFFER_BYTES);
  });

  it('scales the allocation with the real frame count', () => {
    const short = planGifBufferBytes(640, 360, 60);
    const long = planGifBufferBytes(640, 360, 600);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(GIF_MAX_BUFFER_BYTES);
  });

  it('reserves worst-case room for one frame', () => {
    const room640 = gifFrameHeadroomBytes(640, 360);
    const room1024 = gifFrameHeadroomBytes(1024, 1024);
    expect(room640).toBeGreaterThan(640 * 360); // more than raw pixels
    expect(room1024).toBeGreaterThan(room640);
  });

  it('allows a frame that fits and throws a clear error when it does not', () => {
    const capacity = 8 * 1024 * 1024;
    const room = 512 * 1024;
    expect(() => assertGifBufferHasRoom(0, capacity, room, 0)).not.toThrow();
    expect(() => assertGifBufferHasRoom(capacity - room, capacity, room, 10)).not.toThrow();
    expect(() => assertGifBufferHasRoom(capacity - room + 1, capacity, room, 11)).toThrow(
      /safety limit \(frame 11\)/
    );
    expect(() => assertGifBufferHasRoom(capacity - room + 1, capacity, room, 11)).toThrow(
      /smaller GIF preset/
    );
  });
});

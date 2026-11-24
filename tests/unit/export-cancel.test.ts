/**
 * Export cancellation and the wording of the export result.
 * The real-browser proof (a GIF/MP4 cancelled mid-way, decoders closed, an
 * immediate re-export succeeds) lives in tests/e2e/tier1-fast.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { HardwareGifExporter } from '../../src/engine/gif-exporter';
import { HardwareMp4Exporter, ExportEncoderInfo } from '../../src/engine/mp4-exporter';
import { createExportAbortError, isExportAbortError } from '../../src/engine/export-safety';
import { describeMp4Export } from '../../src/engine/export-report';
import { CursorSplineEngine } from '../../src/engine/cursor-spline';
import { VIBE_PRESETS } from '../../src/engine/renderer';

const baseOptions = () => ({
  durationMs: 3000,
  aspectRatio: '16:9' as const,
  preset: VIBE_PRESETS[0],
  pills: [],
  silences: [],
  cursorEngine: new CursorSplineEngine(),
  keystrokes: [],
  cutSilences: false,
  showSpotlight: false,
  showCursor: false,
  showHud: false
});

describe('export abort error', () => {
  it('is an AbortError that the editor can tell from a failure', () => {
    const err = createExportAbortError();
    expect(err.name).toBe('AbortError');
    expect(err.message).toBe('The export was cancelled.');
    expect(isExportAbortError(err)).toBe(true);
    expect(isExportAbortError(new Error('encoder failed'))).toBe(false);
    expect(isExportAbortError(null)).toBe(false);
  });
});

describe('GIF export honours an AbortSignal', () => {
  it('rejects with an AbortError, before doing any work, when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const exporter = new HardwareGifExporter(); // its renderer owns a canvas from construction
    const created: string[] = [];
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string, ...rest: any[]) => { created.push(tag); return (realCreate as any)(tag, ...rest); }) as any;
    try {
      await expect(exporter.exportGif({ ...baseOptions(), signal: controller.signal }))
        .rejects.toMatchObject({ name: 'AbortError', message: 'The export was cancelled.' });
    } finally {
      document.createElement = realCreate as any;
    }
    expect(created.filter((t) => t === 'canvas'), 'no canvas may be allocated for a cancelled export').toEqual([]);
  });
});

describe('MP4 export honours an AbortSignal', () => {
  it('rejects with an AbortError when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new HardwareMp4Exporter().exportMp4({ ...baseOptions(), signal: controller.signal } as any))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('describeMp4Export: report what was really exported', () => {
  const info = (over: Partial<ExportEncoderInfo> = {}): ExportEncoderInfo => ({
    codec: 'avc1.640034',
    width: 1920,
    height: 1080,
    requestedWidth: 1920,
    requestedHeight: 1080,
    framerate: 60,
    hardwareAcceleration: 'prefer-hardware',
    downscaled: false,
    ...over
  });
  const opts = { requestedLabel: '1080p', sourceLabel: '720p', upscaled: false };

  it('states size, codec, frame rate and the hardware encoder', () => {
    expect(describeMp4Export(info(), opts)).toBe('1920×1080 H.264 at 60 fps, hardware encoder.');
  });

  it('never claims hardware when the software encoder was used', () => {
    const msg = describeMp4Export(info({ hardwareAcceleration: 'prefer-software' }), opts);
    expect(msg).toContain('software encoder');
    expect(msg).not.toMatch(/hardware/i);
  });

  it('says so when the size was reduced, with both sizes', () => {
    const msg = describeMp4Export(info({ width: 3072, height: 3072, requestedWidth: 3840, requestedHeight: 3840, downscaled: true }), { ...opts, requestedLabel: '4K' });
    expect(msg).toContain('3072×3072');
    expect(msg).toContain('Reduced from 3840×3840');
    expect(msg).not.toContain('4K');
  });

  it('says so when the frame rate fell back to 30', () => {
    expect(describeMp4Export(info({ framerate: 30 }), opts)).toContain('30 fps');
    expect(describeMp4Export(info({ framerate: 30 }), opts)).toContain('frame rate was lowered');
  });

  it('mentions an upscale only when the size was really upscaled and not reduced', () => {
    expect(describeMp4Export(info(), { ...opts, upscaled: true })).toContain('Upscaled from 720p');
    expect(describeMp4Export(info({ downscaled: true, width: 1536, height: 864 }), { ...opts, upscaled: true })).not.toContain('Upscaled');
  });

  it('makes no encoder claim when no encoder was negotiated', () => {
    expect(describeMp4Export(null, opts)).toBe('1080p video downloaded.');
  });
});

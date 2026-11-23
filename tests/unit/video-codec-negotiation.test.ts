import { beforeEach, describe, expect, it, vi } from 'vitest';
import { negotiateVideoEncoderConfig } from '../../src/engine/video-codec-negotiation';

describe('H.264 VideoEncoder negotiation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('tries the complete codec ladder, hardware then software, and falls back to 30fps', async () => {
    const isConfigSupported = vi.fn(async (config: any) => ({
      supported: config.codec === 'avc1.4d002a'
        && config.hardwareAcceleration === 'prefer-software'
        && config.framerate === 30,
      config
    }));
    vi.stubGlobal('VideoEncoder', { isConfigSupported });

    const selected = await negotiateVideoEncoderConfig(1920, 1080);

    expect(selected).toMatchObject({
      codec: 'avc1.4d002a',
      width: 1920,
      height: 1080,
      framerate: 30,
      hardwareAcceleration: 'prefer-software'
    });
    expect(isConfigSupported).toHaveBeenCalled();
    expect(isConfigSupported.mock.calls.some(([config]) => config.codec === 'avc1.640034')).toBe(true);
    expect(isConfigSupported.mock.calls.some(([config]) => config.codec === 'avc1.42002a')).toBe(true);
  });

  it('downscales unsupported extreme dimensions while preserving an even aspect', async () => {
    const isConfigSupported = vi.fn(async (config: any) => ({
      supported: config.width <= 1920 && config.height <= 2400 && config.framerate === 60,
      config
    }));
    vi.stubGlobal('VideoEncoder', { isConfigSupported });

    const selected = await negotiateVideoEncoderConfig(3072, 3840);

    expect(selected.width % 2).toBe(0);
    expect(selected.height % 2).toBe(0);
    expect(selected.width).toBeLessThanOrEqual(1920);
    expect(selected.height).toBeLessThanOrEqual(2400);
    expect(selected.width / selected.height).toBeCloseTo(3072 / 3840, 2);
  });
});

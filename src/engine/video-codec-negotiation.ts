import { ensureEvenDimensions } from './framing-math';

export const H264_CODEC_LADDER = [
  'avc1.640034',
  'avc1.640033',
  'avc1.640032',
  'avc1.64002a',
  'avc1.640028',
  'avc1.4d0033',
  'avc1.4d0032',
  'avc1.4d002a',
  'avc1.42002a'
] as const;

export type H264Codec = typeof H264_CODEC_LADDER[number];
export type HardwareAcceleration = 'prefer-hardware' | 'prefer-software';

export interface NegotiatedVideoEncoderConfig {
  codec: H264Codec;
  width: number;
  height: number;
  bitrate: number;
  framerate: 60 | 30;
  hardwareAcceleration: HardwareAcceleration;
  latencyMode: 'realtime';
}

function bitrateFor(width: number, height: number): number {
  if (width >= 3840 || height >= 2160) return 38_000_000;
  if (width >= 2560 || height >= 1440) return 22_000_000;
  if (width >= 1920 || height >= 1080) return 14_000_000;
  return 6_000_000;
}

function scaleDimensions(width: number, height: number, scale: number): { width: number; height: number } {
  return ensureEvenDimensions(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
}

export async function negotiateVideoEncoderConfig(
  requestedWidth: number,
  requestedHeight: number
): Promise<NegotiatedVideoEncoderConfig> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is unavailable.');
  }

  const requested = ensureEvenDimensions(requestedWidth, requestedHeight);
  const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25];
  const frameRates: Array<60 | 30> = [60, 30];
  const acceleration: HardwareAcceleration[] = ['prefer-hardware', 'prefer-software'];

  for (const scale of scales) {
    const dimensions = scaleDimensions(requested.width, requested.height, scale);
    for (const framerate of frameRates) {
      for (const hardwareAcceleration of acceleration) {
        for (const codec of H264_CODEC_LADDER) {
          const config: NegotiatedVideoEncoderConfig = {
            codec,
            ...dimensions,
            bitrate: bitrateFor(dimensions.width, dimensions.height),
            framerate,
            hardwareAcceleration,
            latencyMode: 'realtime'
          };
          try {
            const support = await VideoEncoder.isConfigSupported(config);
            if (support.supported) {
              console.info('[SmoothStudio MP4 Exporter] Selected H.264 encoder configuration:', config);
              return config;
            }
          } catch {
            // A rejected candidate is expected while walking the ladder.
          }
        }
      }
    }
  }

  throw new Error(`No supported H.264 VideoEncoder configuration for ${requested.width}x${requested.height}.`);
}

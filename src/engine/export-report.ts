import type { ExportEncoderInfo } from './mp4-exporter';

/**
 * Honest wording for the MP4 export result: the size and encoder that were
 * ACTUALLY used, not the ones that were asked for. The encoder negotiation can
 * fall back to a smaller size or to the software encoder, and the user should
 * be told when it did.
 */
export function describeMp4Export(
  info: ExportEncoderInfo | null,
  options: { requestedLabel: string; sourceLabel?: string; upscaled?: boolean }
): string {
  if (!info) {
    // No WebCodecs encoder was negotiated: nothing to claim about it.
    return `${options.requestedLabel} video downloaded.`;
  }
  const encoder = info.hardwareAcceleration === 'prefer-hardware' ? 'hardware' : 'software';
  const size = `${info.width}×${info.height}`;
  const codec = /^avc1/i.test(info.codec) ? 'H.264' : info.codec;
  let message = `${size} ${codec} at ${info.framerate} fps, ${encoder} encoder.`;
  if (info.downscaled) {
    message += ` Reduced from ${info.requestedWidth}×${info.requestedHeight}: the encoder did not accept the full size on this device.`;
  } else if (options.upscaled && options.sourceLabel) {
    message += ` Upscaled from ${options.sourceLabel}.`;
  }
  if (info.framerate < 60) {
    message += ' The frame rate was lowered to what the encoder supports.';
  }
  return message;
}

import { HardwareMp4Exporter } from '../../src/engine/mp4-exporter';
import { HardwareGifExporter } from '../../src/engine/gif-exporter';
import { AudioProcessor } from '../../src/engine/audio-processor';
import { SopGuideExporter } from '../../src/engine/sop-guide-exporter';
import { HtmlWidgetExporter } from '../../src/engine/html-widget-exporter';
import { CursorSplineEngine } from '../../src/engine/cursor-spline';
import { VIBE_PRESETS } from '../../src/engine/renderer';
import {
  applyAutoRedaction,
  redactTextString,
  isSensitiveString,
  resetRedactions
} from '../../src/content/privacy-redactor';

(window as any).__tier1Harness = {
  HardwareMp4Exporter,
  HardwareGifExporter,
  AudioProcessor,
  SopGuideExporter,
  HtmlWidgetExporter,
  CursorSplineEngine,
  VIBE_PRESETS,
  applyAutoRedaction,
  redactTextString,
  isSensitiveString,
  resetRedactions
};

console.log('[Tier1 Harness] Loaded successfully.');

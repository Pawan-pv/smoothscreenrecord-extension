import { AspectRatioType, FramingMode, ShadowMode } from '../types/telemetry';

export type { FramingMode } from '../types/telemetry';

export interface FrameVisualStyle {
  canvasScale: number;
  radius: number;
  shadowBlur: number;
  shadowOffsetY: number;
  outerBorderWidth: number;
  shadowEnabled: boolean;
}

export function computeFrameVisualStyle(options: {
  canvasW: number;
  canvasH: number;
  framePadding: number;
  borderRadius: number;
  shadowBlur: number;
  shadowMode?: ShadowMode;
}): FrameVisualStyle {
  const canvasScale = Math.max(0.5, Math.min(3, Math.min(options.canvasW, options.canvasH) / 1080));
  const padding = Math.max(0, Math.min(0.2, options.framePadding));
  const radius = padding === 0
    ? 0
    : Math.min(Math.max(0, options.borderRadius) * canvasScale, Math.min(options.canvasW, options.canvasH) * 0.5);
  const shadowEnabled = padding > 0 && (options.shadowMode ?? 'studio') !== 'none';
  const shadowFactor = (options.shadowMode ?? 'studio') === 'subtle' ? 0.45 : 1;
  return {
    canvasScale,
    radius,
    shadowBlur: shadowEnabled ? Math.max(0, options.shadowBlur) * canvasScale * shadowFactor : 0,
    shadowOffsetY: shadowEnabled ? 24 * canvasScale * shadowFactor : 0,
    outerBorderWidth: padding > 0 ? Math.max(0.75, canvasScale) : 0,
    shadowEnabled
  };
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameLayout {
  canvasW: number;
  canvasH: number;
  window: FrameRect;
  sourceW: number;
  sourceH: number;
  sourceCrop: FrameRect;
  cameraScale: number;
  clampedCameraX: number;
  clampedCameraY: number;
  introScale: number;
  canvasScale: number;
  framingMode: FramingMode;
}

export interface FrameLayoutOptions {
  canvasW: number;
  canvasH: number;
  sourceW: number;
  sourceH: number;
  aspectRatio: AspectRatioType;
  framingMode?: FramingMode;
  framePadding?: number;
  cameraX?: number;
  cameraY?: number;
  cameraScale?: number;
  introScale?: number;
}

export function ensureEvenDimensions(width: number, height: number): { width: number; height: number } {
  const even = (value: number) => {
    const safe = Number.isFinite(value) ? Math.floor(value) : 2;
    return Math.max(2, safe % 2 === 0 ? safe : safe - 1);
  };
  return { width: even(width), height: even(height) };
}

function coverCrop(sourceW: number, sourceH: number, targetW: number, targetH: number): FrameRect {
  const sourceAspect = sourceW / Math.max(1, sourceH);
  const targetAspect = targetW / Math.max(1, targetH);
  if (sourceAspect > targetAspect) {
    const cropW = sourceH * targetAspect;
    return { x: (sourceW - cropW) / 2, y: 0, width: cropW, height: sourceH };
  }
  const cropH = sourceW / targetAspect;
  return { x: 0, y: (sourceH - cropH) / 2, width: sourceW, height: cropH };
}

function isPortraitOrSquare(aspect: AspectRatioType): boolean {
  return aspect === '9:16' || aspect === '4:5' || aspect === '1:1';
}

export function computeFrameLayout(options: FrameLayoutOptions): FrameLayout {
  const canvasW = Math.max(2, options.canvasW);
  const canvasH = Math.max(2, options.canvasH);
  const sourceW = Math.max(2, options.sourceW);
  const sourceH = Math.max(2, options.sourceH);
  const padding = Math.max(0, Math.min(0.2, options.framePadding ?? 0.08));
  const availableW = canvasW * (1 - padding * 2);
  const availableH = canvasH * (1 - padding * 2);
  const framingMode = options.framingMode || (isPortraitOrSquare(options.aspectRatio) && options.aspectRatio !== '1:1' ? 'smart-fill' : 'fit');
  const sourceAspect = sourceW / sourceH;
  const availableAspect = availableW / availableH;

  let window: FrameRect;
  let sourceCrop: FrameRect;
  if (framingMode === 'smart-fill' && isPortraitOrSquare(options.aspectRatio)) {
    window = { x: canvasW * padding, y: canvasH * padding, width: availableW, height: availableH };
    sourceCrop = coverCrop(sourceW, sourceH, window.width, window.height);
  } else if (sourceAspect > availableAspect) {
    const height = availableW / sourceAspect;
    window = { x: (canvasW - availableW) / 2, y: (canvasH - height) / 2, width: availableW, height };
    sourceCrop = { x: 0, y: 0, width: sourceW, height: sourceH };
  } else {
    const width = availableH * sourceAspect;
    window = { x: (canvasW - width) / 2, y: (canvasH - availableH) / 2, width, height: availableH };
    sourceCrop = { x: 0, y: 0, width: sourceW, height: sourceH };
  }

  const cameraScale = Math.max(1, options.cameraScale ?? 1);
  const halfViewX = 0.5 / cameraScale;
  const halfViewY = 0.5 / cameraScale;
  const clampedCameraX = Math.max(halfViewX, Math.min(1 - halfViewX, options.cameraX ?? 0.5));
  const clampedCameraY = Math.max(halfViewY, Math.min(1 - halfViewY, options.cameraY ?? 0.5));

  return {
    canvasW,
    canvasH,
    window,
    sourceW,
    sourceH,
    sourceCrop,
    cameraScale,
    clampedCameraX,
    clampedCameraY,
    introScale: Math.max(0.01, options.introScale ?? 1),
    canvasScale: Math.min(canvasW, canvasH) / 1080,
    framingMode
  };
}

function sourceToContent(x: number, y: number, layout: FrameLayout): { x: number; y: number } {
  return {
    x: (x * layout.sourceW - layout.sourceCrop.x) / layout.sourceCrop.width,
    y: (y * layout.sourceH - layout.sourceCrop.y) / layout.sourceCrop.height
  };
}

function contentToSource(x: number, y: number, layout: FrameLayout): { x: number; y: number } {
  return {
    x: (layout.sourceCrop.x + x * layout.sourceCrop.width) / layout.sourceW,
    y: (layout.sourceCrop.y + y * layout.sourceCrop.height) / layout.sourceH
  };
}

export function projectSourceToCanvas(sourceX: number, sourceY: number, layout: FrameLayout): { x: number; y: number } {
  const content = sourceToContent(sourceX, sourceY, layout);
  const x = layout.window.x + layout.window.width / 2 +
    (content.x - layout.clampedCameraX) * layout.window.width * layout.cameraScale * layout.introScale;
  const y = layout.window.y + layout.window.height / 2 +
    (content.y - layout.clampedCameraY) * layout.window.height * layout.cameraScale * layout.introScale;
  return { x, y };
}

export function unprojectCanvasToSource(canvasX: number, canvasY: number, layout: FrameLayout): { x: number; y: number } {
  const contentX = layout.clampedCameraX +
    (canvasX - layout.window.x - layout.window.width / 2) /
      (layout.window.width * layout.cameraScale * layout.introScale);
  const contentY = layout.clampedCameraY +
    (canvasY - layout.window.y - layout.window.height / 2) /
      (layout.window.height * layout.cameraScale * layout.introScale);
  return contentToSource(contentX, contentY, layout);
}

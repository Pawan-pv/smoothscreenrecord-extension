import React, { useRef, useEffect, useMemo } from 'react';
import {
  AspectRatioType,
  VibePreset,
  ZoomPill,
  KeystrokeEvent,
  CaptionBlock,
  CaptionStyle,
  CursorTheme,
  BackdropMatrixParams,
  ShadowMode,
  BackgroundLayer,
  ClickEffectStyle
} from '../types/telemetry';
import { StudioRenderer, RenderFrameOptions, getAspectDimensions } from '../engine/renderer';
import { CameraState } from '../engine/spring-physics';
import { buildCameraPath } from '../engine/camera-path';
import { CursorSplineEngine } from '../engine/cursor-spline';
import { computeFrameLayout, projectSourceToCanvas, unprojectCanvasToSource, FrameLayout, FramingMode, cameraViewFraction, mediaSourceSize } from '../engine/framing-math';
import { Play, Pause, RotateCcw } from 'lucide-react';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

interface CanvasPreviewProps {
  video: HTMLVideoElement | HTMLCanvasElement | null;
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  pills: ZoomPill[];
  selectedPillId?: string | null;
  onSelectPill?: (id: string | null) => void;
  onUpdatePill?: (pill: ZoomPill) => void;
  cursorEngine: CursorSplineEngine;
  keystrokes: KeystrokeEvent[];
  preset: VibePreset;
  aspectRatio: AspectRatioType;
  showSpotlight: boolean;
  showCursor: boolean;
  showHud: boolean;
  followCursor: boolean;
  /** Changes whenever the cursor path or its smoothing changes: the camera schedule is rebuilt. */
  cameraCursorKey?: string;
  metadata?: { width: number; height: number };
  cursorTheme?: CursorTheme;
  cursorScale?: number;
  captions?: CaptionBlock[];
  captionStyle?: CaptionStyle;
  captionBackdrop?: number;
  showCaptions?: boolean;
  showIntroCard?: boolean;
  introHeadline?: string;
  introSubheadline?: string;
  showOutroCard?: boolean;
  outroHeadline?: string;
  outroCtaText?: string;
  backdropParams?: BackdropMatrixParams;
  framePadding?: number;
  background?: BackgroundLayer | null;
  framingMode?: FramingMode;
  shadowMode?: ShadowMode;
  /** Studio click-effect style for click ripples (identical for preview and exports). */
  clickEffectStyle?: ClickEffectStyle;
  /** Click ripple accent color; 'auto' uses the cursor theme's ring color. */
  clickColor?: string;
  /** Trim bounds of the timeline being rendered (0 = untrimmed): ripple sources outside are suppressed. */
  trimStartMs?: number;
  trimEndMs?: number;
  onCanvasClickToAddZoom?: (normalizedX: number, normalizedY: number) => void;
}

export function CanvasPreview({
  video,
  currentTimeMs,
  durationMs,
  isPlaying,
  onTogglePlay,
  onRestart,
  pills,
  selectedPillId,
  onSelectPill,
  onUpdatePill,
  cursorEngine,
  keystrokes,
  preset,
  aspectRatio,
  showSpotlight,
  showCursor,
  showHud,
  followCursor,
  cameraCursorKey,
  metadata,
  cursorTheme,
  cursorScale,
  clickEffectStyle,
  clickColor,
  trimStartMs,
  trimEndMs,
  captions,
  captionStyle,
  captionBackdrop,
  showCaptions,
  showIntroCard,
  introHeadline,
  introSubheadline,
  showOutroCard,
  outroHeadline,
  outroCtaText,
  backdropParams,
  framePadding,
  background,
  framingMode,
  shadowMode,
  onCanvasClickToAddZoom
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StudioRenderer>(new StudioRenderer());
  const currentCameraRef = useRef<CameraState>({ x: 0.5, y: 0.5, scale: 1.0, tiltX: 0, tiltY: 0 });
  const isDraggingGizmoRef = useRef<boolean>(false);
  const dragTransformRef = useRef<{
    layout: FrameLayout;
    canvasW: number;
    rect: DOMRect;
  } | null>(null);

  // Memoize aspect dimensions to eliminate GC allocations per render
  const { width: targetWidth, height: targetHeight } = useMemo(
    () => getAspectDimensions(aspectRatio, 1920),
    [aspectRatio]
  );

  // Pre-allocated persistent render options to completely avoid heap garbage collection thrashing at 60fps
  const renderOptionsRef = useRef<RenderFrameOptions>({
    canvas: null as any,
    video: null as any,
    currentTimeMs: 0,
    camera: null as any,
    cursorEngine: null as any,
    keystrokes: [],
    preset: null as any,
    aspectRatio: '16:9',
    showSpotlight: true,
    showCursor: true,
    showHud: true,
    outputFps: 60
  });

  // The camera is a deterministic schedule (zooms + the smoothed cursor path), built
  // once and only rebuilt when one of those changes: scrubbing is a lookup, and the
  // MP4 / GIF exports evaluate the very same schedule.
  const cameraPath = useMemo(
    () => buildCameraPath(pills, {
      followCursor,
      cursorAt: (t) => cursorEngine.getCameraCursorAt(t),
      viewportWidth: metadata?.width || targetWidth,
      viewportHeight: metadata?.height || targetHeight,
      viewFraction: cameraViewFraction({
        canvasW: targetWidth,
        canvasH: targetHeight,
        sourceW: mediaSourceSize(video).width,
        sourceH: mediaSourceSize(video).height,
        aspectRatio,
        framingMode,
        framePadding
      })
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pills, followCursor, cursorEngine, cameraCursorKey, metadata?.width, metadata?.height, targetWidth, targetHeight, video, aspectRatio, framingMode, framePadding]
  );

  // Render preview frame whenever currentTimeMs, preset, or props change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    if (!video) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        rendererRef.current.drawBackdropMatrix(
          ctx,
          targetWidth,
          targetHeight,
          preset,
          currentTimeMs,
          backdropParams
        );
      }
      return;
    }

    // The frame drawn below is the one the video shows right now. While it plays, the
    // camera, cursor and overlays use that frame's time, not the playhead of the last
    // render, so the zoom can never lag behind (or run ahead of) the picture.
    const playingVideo = video instanceof HTMLVideoElement && !video.paused && !video.seeking && video.readyState >= 2;
    const frameTimeMs = playingVideo ? (video as HTMLVideoElement).currentTime * 1000 : currentTimeMs;

    // Direct analytical cinematic camera evaluation: guarantees 100% identical camera
    // framing across 60Hz/120Hz preview, 60fps MP4, and 15fps GIF with zero drift.
    const camera = cameraPath.at(frameTimeMs);
    currentCameraRef.current = camera;

    const activePill = pills.find((p) => frameTimeMs >= p.startTime && frameTimeMs <= p.endTime);

    // Reuse persistent options structure to maintain 0 allocation in 60fps render window
    const opts = renderOptionsRef.current;
    opts.canvas = canvas;
    opts.video = video;
    opts.currentTimeMs = frameTimeMs;
    opts.camera = camera;
    opts.activePill = activePill;
    opts.cursorEngine = cursorEngine;
    opts.keystrokes = keystrokes;
    opts.preset = preset;
    opts.aspectRatio = aspectRatio;
    opts.showSpotlight = showSpotlight;
    opts.showCursor = showCursor;
    opts.outputFps = 60;
    opts.showHud = showHud;
    opts.metadata = metadata;
    opts.cursorTheme = cursorTheme;
    opts.cursorScale = cursorScale;
    opts.clickEffectStyle = clickEffectStyle;
    opts.clickColor = clickColor;
    opts.trimStartMs = trimStartMs;
    opts.trimEndMs = trimEndMs;
    opts.captions = captions;
    opts.captionStyle = captionStyle;
    opts.captionBackdrop = captionBackdrop;
    opts.showCaptions = showCaptions;
    opts.showIntroCard = showIntroCard;
    opts.introHeadline = introHeadline;
    opts.introSubheadline = introSubheadline;
    opts.durationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
    opts.showOutroCard = showOutroCard;
    opts.outroHeadline = outroHeadline;
    opts.outroCtaText = outroCtaText;
    opts.backdropParams = backdropParams;
    opts.framePadding = framePadding;
    opts.background = background;
    opts.framingMode = framingMode;
    opts.shadowMode = shadowMode;

    rendererRef.current.renderFrame(opts);

    // Render interactive focal target crosshair/ring when a pill is selected
    const selectedPill = pills.find((p) => p.id === selectedPillId);
    if (selectedPill) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const padFraction = typeof framePadding === 'number' && Number.isFinite(framePadding)
          ? Math.max(0, Math.min(0.2, framePadding))
          : 0.08;
        const sourceW = (video as HTMLVideoElement)?.videoWidth || (video as HTMLCanvasElement)?.width || 1920;
        const sourceH = (video as HTMLVideoElement)?.videoHeight || (video as HTMLCanvasElement)?.height || 1080;
        const layout = computeFrameLayout({
          canvasW: targetWidth,
          canvasH: targetHeight,
          sourceW,
          sourceH,
          aspectRatio,
          framingMode,
          framePadding: padFraction,
          cameraX: camera.x,
          cameraY: camera.y,
          cameraScale: camera.scale
        });
        const projected = projectSourceToCanvas(selectedPill.targetX, selectedPill.targetY, layout);
        const gizmoCanvasX = projected.x;
        const gizmoCanvasY = projected.y;

        ctx.save();
        ctx.beginPath();
        drawRoundedRect(ctx, layout.window.x, layout.window.y, layout.window.width, layout.window.height, preset.borderRadius);
        ctx.clip();

        // Outer reticle ring with glowing drop shadow
        const ringRadius = 24;
        ctx.beginPath();
        ctx.arc(gizmoCanvasX, gizmoCanvasY, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#60A5FA';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(99, 132, 255, 0.72)';
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(gizmoCanvasX, gizmoCanvasY, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = '#38BDF8';
        ctx.shadowBlur = 8;
        ctx.fill();

        // Crosshair ticks
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#93C5FD';
        ctx.lineWidth = 1.75;
        const tickGap = 28;
        const tickLen = 12;

        ctx.beginPath();
        ctx.moveTo(gizmoCanvasX, gizmoCanvasY - tickGap);
        ctx.lineTo(gizmoCanvasX, gizmoCanvasY - tickGap - tickLen);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(gizmoCanvasX, gizmoCanvasY + tickGap);
        ctx.lineTo(gizmoCanvasX, gizmoCanvasY + tickGap + tickLen);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(gizmoCanvasX - tickGap, gizmoCanvasY);
        ctx.lineTo(gizmoCanvasX - tickGap - tickLen, gizmoCanvasY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(gizmoCanvasX + tickGap, gizmoCanvasY);
        ctx.lineTo(gizmoCanvasX + tickGap + tickLen, gizmoCanvasY);
        ctx.stroke();

        // Badge showing target coordinates
        const badgeText = `Target: (${Math.round(selectedPill.targetX * 100)}%, ${Math.round(selectedPill.targetY * 100)}%)`;
        ctx.font = '600 12px "JetBrains Mono", "Cascadia Code", "SF Mono", ui-monospace, monospace';
        const textMetrics = ctx.measureText(badgeText);
        const badgeW = textMetrics.width + 16;
        const badgeH = 22;
        const badgeX = gizmoCanvasX - badgeW / 2;
        const badgeY = gizmoCanvasY + ringRadius + 14;

        ctx.fillStyle = 'rgba(15, 17, 23, 0.92)';
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#DBEAFE';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, gizmoCanvasX, badgeY + badgeH / 2);

        ctx.restore();
      }
    }
  }, [
    currentTimeMs,
    video,
    preset,
    aspectRatio,
    targetWidth,
    targetHeight,
    pills,
    cameraPath,
    selectedPillId,
    showSpotlight,
    showCursor,
    showHud,
    followCursor,
    cursorEngine,
    keystrokes,
    metadata,
    cursorTheme,
    cursorScale,
    clickEffectStyle,
    clickColor,
    trimStartMs,
    trimEndMs,
    captions,
    captionStyle,
    captionBackdrop,
    showCaptions,
    showIntroCard,
    introHeadline,
    introSubheadline,
    durationMs,
    showOutroCard,
    outroHeadline,
    outroCtaText,
    backdropParams,
    framePadding,
    background,
    framingMode,
    shadowMode
  ]);

  // Support Escape to deselect active pill
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedPillId && onSelectPill) {
          onSelectPill(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPillId, onSelectPill]);

  const updateFocalTargetFromPointer = (clientX: number, clientY: number) => {
    const drag = dragTransformRef.current;
    if (!drag || !selectedPillId || !onUpdatePill) return;
    const selectedPill = pills.find((p) => p.id === selectedPillId);
    if (!selectedPill) return;

    const scaleOnScreen = drag.rect.width / drag.canvasW;
    const clickCanvasX = (clientX - drag.rect.left) / scaleOnScreen;
    const clickCanvasY = (clientY - drag.rect.top) / scaleOnScreen;

    const source = unprojectCanvasToSource(clickCanvasX, clickCanvasY, drag.layout);

    const clampedX = Math.max(0.05, Math.min(0.95, source.x));
    const clampedY = Math.max(0.05, Math.min(0.95, source.y));

    // Moving the target moves a multi-click shot's whole focus path with it (the pan
    // between its clicks is kept), instead of collapsing the shot to one point.
    const dx = clampedX - selectedPill.targetX;
    const dy = clampedY - selectedPill.targetY;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    onUpdatePill({
      ...selectedPill,
      targetX: clampedX,
      targetY: clampedY,
      ...(selectedPill.keyframes
        ? { keyframes: selectedPill.keyframes.map((k) => ({ ...k, x: clamp01(k.x + dx), y: clamp01(k.y + dy) })) }
        : {})
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !video) return;
    const selectedPill = pills.find((p) => p.id === selectedPillId);
    if (!selectedPill || !onUpdatePill) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasW = canvasRef.current.width;
    const canvasH = canvasRef.current.height;
    const padFraction = typeof framePadding === 'number' && Number.isFinite(framePadding)
      ? Math.max(0, Math.min(0.2, framePadding))
      : 0.08;
    const sourceW = (video as HTMLVideoElement)?.videoWidth || (video as HTMLCanvasElement)?.width || 1920;
    const sourceH = (video as HTMLVideoElement)?.videoHeight || (video as HTMLCanvasElement)?.height || 1080;
    const layout = computeFrameLayout({
      canvasW,
      canvasH,
      sourceW,
      sourceH,
      aspectRatio,
      framingMode,
      framePadding: padFraction,
      cameraX: currentCameraRef.current.x,
      cameraY: currentCameraRef.current.y,
      cameraScale: currentCameraRef.current.scale
    });

    // Capture the active camera transform ONCE at pointerdown to eliminate feedback-loop jitter
    dragTransformRef.current = {
      layout,
      canvasW,
      rect
    };
    isDraggingGizmoRef.current = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    updateFocalTargetFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingGizmoRef.current) return;
    updateFocalTargetFromPointer(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDraggingGizmoRef.current) {
      isDraggingGizmoRef.current = false;
      dragTransformRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // When a pill is selected, pointerdown handles updating targetX/targetY;
    // do not create a duplicate pill!
    if (selectedPillId) return;
    if (!canvasRef.current || !onCanvasClickToAddZoom || !video) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const canvasW = canvasRef.current.width;
    const canvasH = canvasRef.current.height;
    const padFraction = typeof framePadding === 'number' && Number.isFinite(framePadding)
      ? Math.max(0, Math.min(0.2, framePadding))
      : 0.08;
    const sourceW = (video as HTMLVideoElement).videoWidth || (video as HTMLCanvasElement).width || 1920;
    const sourceH = (video as HTMLVideoElement).videoHeight || (video as HTMLCanvasElement).height || 1080;
    const layout = computeFrameLayout({
      canvasW,
      canvasH,
      sourceW,
      sourceH,
      aspectRatio,
      framingMode,
      framePadding: padFraction,
      cameraX: currentCameraRef.current.x,
      cameraY: currentCameraRef.current.y,
      cameraScale: currentCameraRef.current.scale
    });

    const scaleOnScreen = rect.width / canvasW;
    const clickCanvasX = clickX / scaleOnScreen;
    const clickCanvasY = clickY / scaleOnScreen;

    const source = unprojectCanvasToSource(clickCanvasX, clickCanvasY, layout);
    const normX = Math.max(0.1, Math.min(0.9, source.x));
    const normY = Math.max(0.1, Math.min(0.9, source.y));

    onCanvasClickToAddZoom(normX, normY);
  };

  return (
    <div className="relative flex-1 bg-[radial-gradient(ellipse_at_center,rgba(66,133,244,0.035)_0%,transparent_72%)] flex items-center justify-center p-6 overflow-hidden">
      {/* 60fps Center Canvas */}
      <div className="relative max-w-full max-h-full flex items-center justify-center border border-studio-border shadow-ss-panel rounded-2xl overflow-hidden group">
        <canvas
          ref={canvasRef}
          width={targetWidth}
          height={targetHeight}
          onClick={handleCanvasClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="max-h-[68vh] max-w-full object-contain cursor-crosshair rounded-2xl"
          title={
            selectedPillId
              ? 'Drag or click anywhere on preview to reposition the selected Zoom Focus focal target (Esc to deselect)'
              : 'Click anywhere on preview to create a custom Zoom Focus at that point'
          }
        />

        {/* Quick Playback Overlay Button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-ss pointer-events-none">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            className="ss-btn ss-btn-primary w-14 h-14 p-0 rounded-full shadow-ss-glow pointer-events-auto backdrop-blur-md"
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" strokeWidth={1.75} />
            ) : (
              <Play className="w-5 h-5 ml-0.5" strokeWidth={1.75} />
            )}
          </button>
        </div>

        {/* Floating Quick Transport Bar */}
        <div className="ss-panel border absolute bottom-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full shadow-ss-panel flex items-center gap-2.5 text-studio-text text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-ss">
          <button
            onClick={onRestart}
            className="ss-btn p-1 rounded-full text-studio-muted hover:text-[#93C5FD]"
            title="Restart"
            aria-label="Restart preview"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
          <button
            onClick={onTogglePlay}
            className="ss-btn p-1 rounded-full text-studio-muted hover:text-[#93C5FD]"
            title="Play/Pause"
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5" strokeWidth={1.75} />
            ) : (
              <Play className="w-3.5 h-3.5" strokeWidth={1.75} />
            )}
          </button>
          <span className="ss-num text-[11px] text-[#A5B4FC]">
            {(currentTimeMs / 1000).toFixed(1)}s / {(durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}

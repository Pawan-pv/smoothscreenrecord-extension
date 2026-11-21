import React, { useRef, useEffect, useMemo } from 'react';
import {
  AspectRatioType,
  VibePreset,
  ZoomPill,
  KeystrokeEvent,
  CaptionBlock,
  CaptionStyle,
  CursorTheme,
  BackdropMatrixParams
} from '../types/telemetry';
import { StudioRenderer, RenderFrameOptions, getAspectDimensions } from '../engine/renderer';
import { computeCinematicCameraState, SpringCameraSolver } from '../engine/spring-physics';
import { CursorSplineEngine } from '../engine/cursor-spline';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface CanvasPreviewProps {
  video: HTMLVideoElement | HTMLCanvasElement | null;
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  pills: ZoomPill[];
  cursorEngine: CursorSplineEngine;
  keystrokes: KeystrokeEvent[];
  preset: VibePreset;
  aspectRatio: AspectRatioType;
  showSpotlight: boolean;
  showCursor: boolean;
  showHud: boolean;
  followCursor: boolean;
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
  backgroundColor?: string | null;
  backgroundImage?: CanvasImageSource | null;
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
  cursorEngine,
  keystrokes,
  preset,
  aspectRatio,
  showSpotlight,
  showCursor,
  showHud,
  followCursor,
  metadata,
  cursorTheme,
  cursorScale,
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
  backgroundColor,
  backgroundImage,
  onCanvasClickToAddZoom
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StudioRenderer>(new StudioRenderer());
  const springCameraRef = useRef<SpringCameraSolver>(new SpringCameraSolver());
  const lastTimeMsRef = useRef<number>(currentTimeMs);

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
    showHud: true
  });

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

    // Compute continuous, buttery-smooth cinematic camera framing and cursor tracking
    const cursor = cursorEngine.getCursorAt(currentTimeMs);
    const targetCamera = computeCinematicCameraState(
      currentTimeMs,
      pills,
      cursor,
      metadata?.width || targetWidth,
      metadata?.height || targetHeight,
      followCursor
    );

    const solver = springCameraRef.current;
    solver.setTarget(targetCamera);

    const deltaMs = Math.abs(currentTimeMs - lastTimeMsRef.current);
    if (!isPlaying) {
      // Paused / scrubbing: snap instantly so the framing tracks the playhead exactly
      solver.snapTo(targetCamera);
    } else {
      // Playing: always advance the physical spring with the clamped frame step.
      const stepDt = Math.min(0.048, Math.max(0.016, deltaMs / 1000));
      solver.update(stepDt);
    }
    lastTimeMsRef.current = currentTimeMs;
    const camera = isPlaying ? solver.getState() : targetCamera;

    const activePill = pills.find((p) => currentTimeMs >= p.startTime && currentTimeMs <= p.endTime);

    // Reuse persistent options structure to maintain 0 allocation in 60fps render window
    const opts = renderOptionsRef.current;
    opts.canvas = canvas;
    opts.video = video;
    opts.currentTimeMs = currentTimeMs;
    opts.camera = camera;
    opts.activePill = activePill;
    opts.cursorEngine = cursorEngine;
    opts.keystrokes = keystrokes;
    opts.preset = preset;
    opts.aspectRatio = aspectRatio;
    opts.showSpotlight = showSpotlight;
    opts.showCursor = showCursor;
    opts.showHud = showHud;
    opts.metadata = metadata;
    opts.cursorTheme = cursorTheme;
    opts.cursorScale = cursorScale;
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
    opts.backgroundColor = backgroundColor;
    opts.backgroundImage = backgroundImage;

    rendererRef.current.renderFrame(opts);
  }, [
    currentTimeMs,
    video,
    preset,
    aspectRatio,
    targetWidth,
    targetHeight,
    pills,
    showSpotlight,
    showCursor,
    showHud,
    followCursor,
    cursorEngine,
    keystrokes,
    metadata,
    cursorTheme,
    cursorScale,
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
    backgroundColor,
    backgroundImage
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !onCanvasClickToAddZoom || !video) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const canvasW = canvasRef.current.width;
    const canvasH = canvasRef.current.height;
    const padFraction = typeof framePadding === 'number' && Number.isFinite(framePadding)
      ? Math.max(0, Math.min(0.2, framePadding))
      : 0.08;
    const paddingX = canvasW * padFraction;
    const paddingY = canvasH * padFraction;
    const availW = canvasW - paddingX * 2;
    const availH = canvasH - paddingY * 2;
    const sourceW = (video as HTMLVideoElement).videoWidth || (video as HTMLCanvasElement).width || 1920;
    const sourceH = (video as HTMLVideoElement).videoHeight || (video as HTMLCanvasElement).height || 1080;
    const videoAspect = sourceW / sourceH;

    let windowW = availW;
    let windowH = availW / videoAspect;
    if (windowH > availH) {
      windowH = availH;
      windowW = availH * videoAspect;
    }
    const windowX = (canvasW - windowW) / 2;
    const windowY = (canvasH - windowH) / 2;

    const scaleOnScreen = rect.width / canvasW;
    const clickCanvasX = clickX / scaleOnScreen;
    const clickCanvasY = clickY / scaleOnScreen;

    const normX = Math.max(0.1, Math.min(0.9, (clickCanvasX - windowX) / windowW));
    const normY = Math.max(0.1, Math.min(0.9, (clickCanvasY - windowY) / windowH));

    onCanvasClickToAddZoom(normX, normY);
  };

  return (
    <div className="relative flex-1 bg-[#0B0C10] flex items-center justify-center p-6 overflow-hidden">
      {/* 60fps Center Canvas */}
      <div className="relative max-w-full max-h-full flex items-center justify-center shadow-2xl rounded-2xl overflow-hidden group">
        <canvas
          ref={canvasRef}
          width={targetWidth}
          height={targetHeight}
          onClick={handleCanvasClick}
          className="max-h-[68vh] max-w-full object-contain cursor-crosshair rounded-2xl"
          title="Click anywhere on preview to create a custom Zoom Focus at that point"
        />

        {/* Quick Playback Overlay Button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            className="p-4 bg-purple-600/80 hover:bg-purple-600 text-white rounded-full shadow-xl pointer-events-auto backdrop-blur-sm transition-transform active:scale-95"
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
        </div>

        {/* Floating Quick Transport Bar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onRestart} className="hover:text-purple-300" title="Restart">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={onTogglePlay} className="hover:text-purple-300" title="Play/Pause">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <span className="font-mono text-[11px] text-gray-300">
            {(currentTimeMs / 1000).toFixed(1)}s / {(durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}

import React, { useRef, useEffect } from 'react';
import {
  AspectRatioType,
  VibePreset,
  ZoomPill,
  KeystrokeEvent
} from '../types/telemetry';
import { StudioRenderer, getAspectDimensions } from '../engine/renderer';
import { computeCinematicCameraState } from '../engine/spring-physics';
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
  onCanvasClickToAddZoom
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StudioRenderer>(new StudioRenderer());

  // Render preview frame whenever currentTimeMs, preset, or props change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;

    const { width: targetW, height: targetH } = getAspectDimensions(aspectRatio, 1920);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    // Compute continuous, buttery-smooth cinematic camera framing and cursor tracking
    const cursor = cursorEngine.getCursorAt(currentTimeMs);
    const camera = computeCinematicCameraState(
      currentTimeMs,
      pills,
      cursor,
      metadata?.width || targetW,
      metadata?.height || targetH,
      followCursor
    );

    const activePill = pills.find((p) => currentTimeMs >= p.startTime && currentTimeMs <= p.endTime);

    rendererRef.current.renderFrame({
      canvas,
      video,
      currentTimeMs,
      camera,
      activePill,
      cursorEngine,
      keystrokes,
      preset,
      aspectRatio,
      showSpotlight,
      showCursor,
      showHud,
      metadata
    });
  }, [
    currentTimeMs,
    video,
    preset,
    aspectRatio,
    pills,
    showSpotlight,
    showCursor,
    showHud,
    followCursor,
    cursorEngine,
    keystrokes,
    metadata
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !onCanvasClickToAddZoom || !video) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const canvasW = canvasRef.current.width;
    const canvasH = canvasRef.current.height;
    const paddingX = canvasW * 0.08;
    const paddingY = canvasH * 0.08;
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

import React, { useRef, useState, useEffect } from 'react';
import { ZoomPill, SilenceSegment, KeystrokeEvent, CaptionBlock } from '../types/telemetry';
import { autoZoomScaleCap } from '../engine/spring-physics';
import { DEFAULT_TRANSITION_MS, ZOOM_SPEEDS } from '../engine/camera-path';
import { AUTO_ZOOM_DEPTHS } from '../engine/spring-physics';
import type { AutoZoomSettings } from './EditorStudio';
import { Scissors, Plus, Trash2, Eye, Box, Sliders, Subtitles, RotateCcw, Sparkles, ZoomIn } from 'lucide-react';

interface MagneticTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
  pills: ZoomPill[];
  selectedPillId?: string | null;
  onSelectPill?: (id: string | null) => void;
  onRedetectZooms?: () => void;
  /** Auto-zoom settings: on/off, depth and speed of every auto zoom. */
  autoZoom?: AutoZoomSettings;
  onChangeAutoZoom?: (change: Partial<AutoZoomSettings>) => void;
  /** Clicks recorded in this recording (shown next to the number of auto zooms). */
  recordedClickCount?: number;
  onUpdatePill: (pill: ZoomPill) => void;
  onDeletePill: (id: string) => void;
  /** Real pixel width of the recording: the inspector warns when a zoom goes past what it shows sharply. */
  sourcePixelWidth?: number;
  onAddPillAtPlayhead: () => void;
  silences: SilenceSegment[];
  onToggleSilenceCut: (id: string) => void;
  onCutAllSilences: () => void;
  autoCutSilences?: boolean;
  onToggleAutoCutSilences?: (val: boolean) => void;
  keystrokes: KeystrokeEvent[];
  /** Real amplitude envelope decoded from the recorded audio track. */
  waveformPeaks?: number[];
  captions?: CaptionBlock[];
  showCaptions?: boolean;
  onAddCaptionAtPlayhead?: () => void;
  onUpdateCaption?: (caption: CaptionBlock) => void;
  onDeleteCaption?: (id: string) => void;
  trimStartMs?: number;
  trimEndMs?: number;
  onUpdateTrim?: (startMs: number, endMs: number) => void;
  onResetTrim?: () => void;
}

export function MagneticTimeline({
  durationMs,
  currentTimeMs,
  isPlaying,
  onTogglePlay,
  onSeek,
  pills,
  selectedPillId,
  onSelectPill,
  onRedetectZooms,
  autoZoom,
  onChangeAutoZoom,
  recordedClickCount,
  onUpdatePill,
  onDeletePill,
  sourcePixelWidth,
  onAddPillAtPlayhead,
  silences,
  onToggleSilenceCut,
  onCutAllSilences,
  autoCutSilences = false,
  onToggleAutoCutSilences,
  keystrokes,
  waveformPeaks = [],
  captions = [],
  showCaptions = false,
  onAddCaptionAtPlayhead,
  onUpdateCaption,
  onDeleteCaption,
  trimStartMs,
  trimEndMs,
  onUpdateTrim,
  onResetTrim
}: MagneticTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  /** Pixel width of the track: narrow zoom pills show a clean duration instead of a clipped label. */
  const [timelineWidth, setTimelineWidth] = useState(0);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const update = () => setTimelineWidth(el.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [internalSelectedPillId, setInternalSelectedPillId] = useState<string | null>(null);
  const currentSelectedPillId = selectedPillId !== undefined ? selectedPillId : internalSelectedPillId;
  const setSelectedPillId = (id: string | null) => {
    setInternalSelectedPillId(id);
    onSelectPill?.(id);
  };
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [resizingPill, setResizingPill] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);
  const [resizingCaption, setResizingCaption] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);
  const [draggingTrim, setDraggingTrim] = useState<'start' | 'end' | null>(null);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);

  const effectiveTrimStart = Math.max(0, Math.min(durationMs, trimStartMs ?? 0));
  const effectiveTrimEnd = Math.max(effectiveTrimStart, Math.min(durationMs, trimEndMs ?? durationMs));
  const isTrimmed = effectiveTrimStart > 0 || (durationMs > 0 && effectiveTrimEnd < durationMs);

  const handleMouseDownResize = (e: React.MouseEvent, pillId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingPill({ id: pillId, edge });
  };

  const handleMouseDownResizeCaption = (e: React.MouseEvent, captionId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingCaption({ id: captionId, edge });
  };

  // Continuous scrubbing, trim dragging, pill resizing, and caption resizing effect
  useEffect(() => {
    if (!resizingPill && !resizingCaption && !isScrubbing && !draggingTrim) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || durationMs <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTimeMs = Math.round(ratio * durationMs);

      if (draggingTrim === 'start') {
        const nextStart = Math.max(0, Math.min(effectiveTrimEnd - 500, targetTimeMs));
        onUpdateTrim?.(nextStart, effectiveTrimEnd);
        return;
      }

      if (draggingTrim === 'end') {
        const nextEnd = Math.max(effectiveTrimStart + 500, Math.min(durationMs, targetTimeMs));
        onUpdateTrim?.(effectiveTrimStart, nextEnd);
        return;
      }

      if (isScrubbing) {
        const clampedSeek = Math.max(effectiveTrimStart, Math.min(effectiveTrimEnd, targetTimeMs));
        onSeek(clampedSeek);
        return;
      }

      if (resizingPill) {
        const targetPill = pills.find((p) => p.id === resizingPill.id);
        if (!targetPill) return;

        if (resizingPill.edge === 'start') {
          const nextStart = Math.min(targetPill.endTime - 600, Math.max(0, targetTimeMs));
          onUpdatePill({ ...targetPill, startTime: nextStart });
        } else {
          const nextEnd = Math.max(targetPill.startTime + 600, Math.min(durationMs, targetTimeMs));
          onUpdatePill({ ...targetPill, endTime: nextEnd });
        }
      }

      if (resizingCaption) {
        const targetCaption = captions.find((c) => c.id === resizingCaption.id);
        if (!targetCaption) return;

        if (resizingCaption.edge === 'start') {
          const nextStart = Math.min(targetCaption.endTime - 400, Math.max(0, targetTimeMs));
          onUpdateCaption?.({ ...targetCaption, startTime: nextStart });
        } else {
          const nextEnd = Math.max(targetCaption.startTime + 400, Math.min(durationMs, targetTimeMs));
          onUpdateCaption?.({ ...targetCaption, endTime: nextEnd });
        }
      }
    };

    const handleMouseUp = () => {
      setResizingPill(null);
      setResizingCaption(null);
      setDraggingTrim(null);
      setIsScrubbing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    resizingPill,
    resizingCaption,
    draggingTrim,
    isScrubbing,
    durationMs,
    effectiveTrimStart,
    effectiveTrimEnd,
    pills,
    captions,
    onUpdatePill,
    onUpdateCaption,
    onUpdateTrim,
    onSeek
  ]);

  const selectedPill = pills.find((p) => p.id === currentSelectedPillId);
  const selectedCaption = captions.find((c) => c.id === selectedCaptionId);

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || durationMs <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const clampedSeek = Math.max(effectiveTrimStart, Math.min(effectiveTrimEnd, Math.round(ratio * durationMs)));
    onSeek(clampedSeek);
    setIsScrubbing(true);
  };

  const getPercent = (timeMs: number) => {
    if (durationMs <= 0) return 0;
    return Math.max(0, Math.min(100, (timeMs / durationMs) * 100));
  };

  return (
    <div className="bg-[#14161D] border-t border-white/10 p-3 select-none">
      {/* Timeline Controls & Quick Actions */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5 text-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onTogglePlay}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 transition-transform active:scale-95"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <span className="font-bold text-xs">❚❚</span>
            ) : (
              <span className="font-bold text-xs ml-0.5">▶</span>
            )}
          </button>

          <span className="font-mono text-purple-300 font-medium text-xs">
            {(currentTimeMs / 1000).toFixed(2)}s / {(durationMs / 1000).toFixed(2)}s
          </span>

          <button
            onClick={onAddPillAtPlayhead}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Zoom Pill
          </button>

          {onRedetectZooms && (
            <button
              onClick={onRedetectZooms}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors text-xs font-medium"
              title="Rebuild one zoom per recorded click"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Re-detect Zooms
            </button>
          )}

          {autoZoom && onChangeAutoZoom && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-300">
              <button
                onClick={() => onChangeAutoZoom({ enabled: !autoZoom.enabled })}
                className={`px-2 py-1 rounded-md border font-medium transition-colors ${
                  autoZoom.enabled
                    ? 'bg-purple-600/30 text-purple-200 border-purple-500/40'
                    : 'bg-white/5 text-gray-400 border-white/10'
                }`}
                title="Zoom in automatically on every click"
              >
                Auto-zoom: {autoZoom.enabled ? 'ON' : 'OFF'}
              </button>
              <select
                value={String(autoZoom.depth)}
                disabled={!autoZoom.enabled}
                onChange={(e) => onChangeAutoZoom({ depth: parseFloat(e.target.value) })}
                className="rounded bg-white/10 px-1 py-1 text-[11px] text-gray-200 focus:outline-none disabled:opacity-40"
                title="How deep every auto zoom goes"
              >
                {AUTO_ZOOM_DEPTHS.map((d) => (
                  <option key={d} value={String(d)} className="bg-[#14161D]">{d}x</option>
                ))}
              </select>
              <select
                value={String(autoZoom.speedMs)}
                disabled={!autoZoom.enabled}
                onChange={(e) => onChangeAutoZoom({ speedMs: parseInt(e.target.value, 10) })}
                className="rounded bg-white/10 px-1 py-1 text-[11px] text-gray-200 focus:outline-none disabled:opacity-40"
                title="How fast auto zooms zoom in, pan and zoom out"
              >
                {ZOOM_SPEEDS.map((s) => (
                  <option key={s.ms} value={String(s.ms)} className="bg-[#14161D]">{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {recordedClickCount !== undefined && (
            <span
              className="font-mono text-[11px] text-gray-400"
              title="Clicks recorded during the recording, and the auto zooms made from them"
            >
              {recordedClickCount} click{recordedClickCount === 1 ? '' : 's'} recorded → {pills.filter((p) => p.autoGenerated).length} auto-zoom{pills.filter((p) => p.autoGenerated).length === 1 ? '' : 's'}
            </span>
          )}

          {showCaptions && onAddCaptionAtPlayhead && (
            <button
              onClick={onAddCaptionAtPlayhead}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors"
            >
              <Subtitles className="w-3.5 h-3.5" />
              Add Caption Block
            </button>
          )}

          {silences.length > 0 && (
            <div className="flex items-center gap-1.5">
              {onToggleAutoCutSilences && (
                <button
                  onClick={() => onToggleAutoCutSilences(!autoCutSilences)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                    autoCutSilences
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                      : 'bg-white/5 hover:bg-white/10 text-gray-400 border-white/10'
                  }`}
                  title="Toggle automatic silence skipping during playback & export"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  Auto-Cut Silences: {autoCutSilences ? 'ON' : 'OFF'}
                </button>
              )}

              <button
                onClick={onCutAllSilences}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 transition-colors"
                title="Mark all detected silences (> 1.2s) for cutting"
              >
                Cut All ({silences.length})
              </button>
            </div>
          )}

          {isTrimmed && onResetTrim && (
            <button
              data-testid="reset-trim-btn"
              onClick={onResetTrim}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors text-xs"
              title="Reset Trim bounds to full recording"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Trim
            </button>
          )}
        </div>

        {selectedPill && (
          <div className="flex items-center gap-4 bg-white/5 px-3 py-1 rounded-lg border border-white/10 text-gray-300">
            <span className="text-[11px] font-semibold text-purple-300 flex items-center gap-1">
              <Sliders className="w-3 h-3" />
              Pill Inspector:
            </span>

            {/* Zoom Slider */}
            <label className="flex items-center gap-1.5 text-[11px]">
              Zoom:
              <input
                type="range"
                min="1.2"
                max="2.8"
                step="0.1"
                value={selectedPill.targetScale}
                onChange={(e) => onUpdatePill({ ...selectedPill, targetScale: parseFloat(e.target.value) })}
                className="w-16 accent-purple-500"
              />
              <span className="font-mono text-purple-300">{selectedPill.targetScale.toFixed(1)}x</span>
              {selectedPill.targetScale > autoZoomScaleCap(sourcePixelWidth) + 1e-6 && (
                <span
                  data-testid="sharpness-warning"
                  className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200"
                  title={`This recording is ${sourcePixelWidth}px wide; zooming past ${autoZoomScaleCap(sourcePixelWidth)}x shows softness.`}
                >
                  Soft above {autoZoomScaleCap(sourcePixelWidth)}x
                </span>
              )}
            </label>

            {/* Transition speed: how long the camera takes to move into this zoom */}
            <label className="flex items-center gap-1.5 text-[11px]">
              Speed:
              <select
                data-testid="transition-speed"
                value={String(selectedPill.transitionDuration ?? DEFAULT_TRANSITION_MS)}
                onChange={(e) => onUpdatePill({ ...selectedPill, transitionDuration: parseInt(e.target.value, 10) })}
                className="rounded bg-white/10 px-1 py-0.5 text-[11px] text-gray-200 focus:outline-none"
                title="How fast the camera zooms in, pans and zooms out for this zoom"
              >
                {!ZOOM_SPEEDS.some((s) => s.ms === (selectedPill.transitionDuration ?? DEFAULT_TRANSITION_MS)) && (
                  <option value={String(selectedPill.transitionDuration)} className="bg-[#14161D]">
                    {selectedPill.transitionDuration}ms
                  </option>
                )}
                {ZOOM_SPEEDS.map((s) => (
                  <option key={s.ms} value={String(s.ms)} className="bg-[#14161D]">{s.label}</option>
                ))}
              </select>
            </label>

            {/* 3D Isometric Tilt Toggle */}
            <button
              onClick={() => {
                const nextTilt = selectedPill.tiltX !== 0 ? 0 : 4;
                onUpdatePill({ ...selectedPill, tiltX: nextTilt, tiltY: nextTilt !== 0 ? -6 : 0 });
              }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                selectedPill.tiltX !== 0
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/10 text-gray-400 hover:text-white'
              }`}
            >
              <Box className="w-3 h-3" />
              3D Tilt
            </button>

            {/* Spotlight Toggle */}
            <button
              onClick={() => onUpdatePill({ ...selectedPill, spotlight: !selectedPill.spotlight })}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                selectedPill.spotlight
                  ? 'bg-amber-600 text-white'
                  : 'bg-white/10 text-gray-400 hover:text-white'
              }`}
            >
              <Eye className="w-3 h-3" />
              Spotlight Dimming
            </button>

            <button
              onClick={() => onDeletePill(selectedPill.id)}
              className="p-1 hover:text-red-400 transition-colors"
              title="Delete Zoom Pill"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {selectedCaption && (
          <div className="flex items-center gap-3 bg-amber-500/10 px-3 py-1 rounded-lg border border-amber-500/20 text-gray-300">
            <span className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
              <Subtitles className="w-3 h-3" />
              Caption:
            </span>
            <input
              type="text"
              value={selectedCaption.text}
              onChange={(e) => {
                const newText = e.target.value;
                const dur = selectedCaption.endTime - selectedCaption.startTime;
                const words = newText.split(' ').map((w, idx, arr) => ({
                  word: w,
                  startTime: selectedCaption.startTime + (idx / Math.max(1, arr.length)) * dur,
                  endTime: selectedCaption.startTime + ((idx + 1) / Math.max(1, arr.length)) * dur
                }));
                onUpdateCaption?.({ ...selectedCaption, text: newText, words });
              }}
              className="bg-black/50 border border-amber-500/30 rounded px-2 py-0.5 text-xs text-white w-48 focus:outline-none focus:border-amber-400 font-sans"
              placeholder="Edit subtitle text..."
            />
            {onDeleteCaption && (
              <button
                onClick={() => {
                  onDeleteCaption(selectedCaption.id);
                  setSelectedCaptionId(null);
                }}
                className="p-1 hover:text-red-400 transition-colors"
                title="Delete Caption Block"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Multi-Track Magnetic Timeline */}
      <div
        ref={timelineRef}
        onMouseDown={(e) => {
          handleTimelineMouseDown(e);
          setSelectedPillId(null);
          setSelectedCaptionId(null);
        }}
        className={`relative ${showCaptions ? 'h-36' : 'h-24'} bg-[#0B0C10] rounded-xl border border-white/10 overflow-hidden cursor-pointer transition-all`}
      >
        {/* Track 1: Audio Waveform & Silences & Keystrokes */}
        <div className={`absolute top-0 left-0 right-0 ${showCaptions ? 'h-8' : 'h-10'} border-b border-white/5 flex items-center px-2`}>
          {/* Real waveform: drawn only from the decoded audio track of the recording */}
          {waveformPeaks.length > 0 ? (
            <div className="w-full h-5 flex items-center gap-[1px] opacity-70" data-waveform="real">
              {waveformPeaks.map((peak, i) => (
                <div
                  key={i}
                  className="flex-1 bg-purple-400 rounded-full"
                  style={{ height: `${Math.max(4, peak * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="w-full h-5 flex items-center justify-center" data-waveform="none">
              <span className="text-[9px] font-mono text-gray-500 tracking-wider">NO AUDIO</span>
            </div>
          )}

          {/* Subtle Red/Amber Hatched Silence Regions */}
          {silences.map((silence) => {
            const left = getPercent(silence.startTime);
            const width = Math.max(1.2, getPercent(silence.endTime) - left);
            const isCutActive = silence.markedForCut && autoCutSilences;
            return (
              <div
                key={silence.id}
                data-silence-id={silence.id}
                data-cut-active={isCutActive ? 'true' : 'false'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSilenceCut(silence.id);
                }}
                className={`silence-cut-region absolute top-0 bottom-0 flex items-center justify-center transition-all cursor-pointer group/silence ${
                  isCutActive
                    ? 'border-x border-dashed border-amber-400/70 hover:brightness-125'
                    : 'border-x border-white/10 opacity-40 hover:opacity-80'
                }`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundImage: isCutActive
                    ? 'repeating-linear-gradient(-45deg, rgba(239, 68, 68, 0.35), rgba(239, 68, 68, 0.35) 6px, rgba(245, 158, 11, 0.22) 6px, rgba(245, 158, 11, 0.22) 12px)'
                    : 'repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.06) 6px, rgba(255, 255, 255, 0.02) 6px, rgba(255, 255, 255, 0.02) 12px)'
                }}
                title={`Silence gap (${(silence.duration / 1000).toFixed(1)}s) - Click to ${isCutActive ? 'keep' : 'cut'}`}
              >
                <span className={`text-[9px] font-mono font-medium truncate px-1 flex items-center gap-1 ${
                  isCutActive ? 'text-amber-200 bg-black/60 rounded px-1 py-0.5 border border-amber-500/30' : 'text-gray-400'
                }`}>
                  {isCutActive ? `✂ ${(silence.duration / 1000).toFixed(1)}s` : 'Keep'}
                </span>
              </div>
            );
          })}

          {/* Keystroke badges on track 1 */}
          {keystrokes.map((k, i) => {
            const left = getPercent(k.t);
            return (
              <div
                key={i}
                data-keystroke-badge={k.combo}
                data-keystroke-time={k.t}
                className="absolute top-1 -translate-x-1/2 px-1.5 py-0.5 bg-white/20 border border-white/30 rounded text-[9px] font-mono text-white pointer-events-none"
                style={{ left: `${left}%` }}
              >
                {k.combo}
              </div>
            );
          })}
        </div>

        {/* Track 2 (Conditional): Auto-Captions Subtitle Track */}
        {showCaptions && (
          <div className="absolute top-[32px] left-0 right-0 h-10 border-b border-white/5 flex items-center px-2">
            {captions.map((cap) => {
              const left = getPercent(cap.startTime);
              const width = Math.max(2, getPercent(cap.endTime) - left);
              const isSelected = cap.id === selectedCaptionId;

              return (
                <div
                  key={cap.id}
                  data-caption-id={cap.id}
                  data-caption-text={cap.text}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCaptionId(cap.id);
                    setSelectedPillId(null);
                  }}
                  className={`group absolute h-7 rounded-md flex items-center justify-between px-2 cursor-pointer transition-all shadow-sm ${
                    isSelected
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black font-semibold border-2 border-white ring-2 ring-amber-400/40 z-10'
                      : 'bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/30 text-amber-200'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {/* Left Drag Resize Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDownResizeCaption(e, cap.id, 'start')}
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/40 hover:bg-white rounded-l-md transition-opacity"
                    title="Drag to adjust caption start"
                  />

                  <div className="flex items-center gap-1.5 truncate">
                    <Subtitles className="w-3 h-3 shrink-0" />
                    <span className="text-[10px] truncate max-w-[180px]">
                      {cap.text}
                    </span>
                  </div>

                  <span className="text-[8px] font-mono opacity-80 ml-1 shrink-0">
                    {((cap.endTime - cap.startTime) / 1000).toFixed(1)}s
                  </span>

                  {/* Right Drag Resize Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDownResizeCaption(e, cap.id, 'end')}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/40 hover:bg-white rounded-r-md transition-opacity"
                    title="Drag to adjust caption end"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Track 3: Zoom Pills (Magnetic Blocks) */}
        <div className={`absolute bottom-0 left-0 right-0 ${showCaptions ? 'h-12' : 'h-14'} flex items-center px-2`}>
          {pills.map((pill) => {
            const left = getPercent(pill.startTime);
            const width = Math.max(2, getPercent(pill.endTime) - left);
            const isSelected = pill.id === currentSelectedPillId;
            const durationLabel = `${((pill.endTime - pill.startTime) / 1000).toFixed(1)}s`;
            const fullLabel = pill.label || `Zoom ${pill.targetScale.toFixed(1)}x`;
            // A narrow pill shows a clean duration (and a zoom glyph when it fits) instead
            // of a clipped "Clic..." label; the full label stays in the tooltip/inspector.
            const pillPx = timelineWidth > 0 ? (width / 100) * timelineWidth : Infinity;
            const showLabel = pillPx >= 110;
            const showGlyph = pillPx >= 70;

            return (
              <div
                key={pill.id}
                data-zoom-pill={pill.id}
                data-start-time={pill.startTime}
                data-end-time={pill.endTime}
                title={`${fullLabel} · ${durationLabel}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPillId(pill.id);
                  setSelectedCaptionId(null);
                }}
                className={`group absolute h-9 rounded-lg flex items-center justify-between px-2 cursor-pointer transition-all shadow-md ${
                  isSelected
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 border-2 border-white ring-2 ring-purple-500/40 z-10'
                    : 'bg-purple-900/60 hover:bg-purple-800/80 border border-purple-500/30'
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                {/* Left Drag Resize Handle */}
                <div
                  onMouseDown={(e) => handleMouseDownResize(e, pill.id, 'start')}
                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/30 hover:bg-white rounded-l-md transition-opacity"
                  title="Drag to adjust start time"
                />

                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  {showLabel ? (
                    <>
                      <span className="text-[11px] font-semibold text-white truncate">{fullLabel}</span>
                      {pill.tiltX !== 0 && <Box className="w-3 h-3 shrink-0 text-purple-200" />}
                      {pill.spotlight && <Eye className="w-3 h-3 shrink-0 text-amber-300" />}
                    </>
                  ) : showGlyph ? (
                    <ZoomIn className="w-3 h-3 shrink-0 text-purple-200" />
                  ) : null}
                </div>

                <span className="text-[9px] font-mono text-purple-200/80 ml-1 shrink-0">
                  {durationLabel}
                </span>

                {/* Right Drag Resize Handle */}
                <div
                  onMouseDown={(e) => handleMouseDownResize(e, pill.id, 'end')}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/30 hover:bg-white rounded-r-md transition-opacity"
                  title="Drag to adjust end time"
                />
              </div>
            );
          })}
        </div>

        {/* Scrubbing Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-white via-purple-400 to-white shadow-[0_0_12px_rgba(255,255,255,0.9)] pointer-events-none z-30"
          style={{ left: `${getPercent(currentTimeMs)}%` }}
        >
          <div className="w-3 h-3 bg-white rounded-full -translate-x-[5px] -translate-y-1 shadow-lg border border-purple-600" />
        </div>

        {/* Shaded Trim Out Regions */}
        {effectiveTrimStart > 0 && (
          <div
            data-testid="trim-shade-left"
            className="absolute top-0 bottom-0 left-0 bg-black/60 backdrop-blur-[1px] pointer-events-none z-20 border-r border-amber-400/50"
            style={{ width: `${getPercent(effectiveTrimStart)}%` }}
          />
        )}
        {effectiveTrimEnd < durationMs && (
          <div
            data-testid="trim-shade-right"
            className="absolute top-0 bottom-0 right-0 bg-black/60 backdrop-blur-[1px] pointer-events-none z-20 border-l border-amber-400/50"
            style={{ width: `${100 - getPercent(effectiveTrimEnd)}%` }}
          />
        )}

        {/* Draggable Trim Handles */}
        <div
          data-testid="trim-handle-start"
          onMouseDown={(e) => {
            e.stopPropagation();
            setDraggingTrim('start');
          }}
          className="absolute top-0 bottom-0 w-3 -translate-x-1.5 cursor-ew-resize z-25 flex flex-col items-center justify-center group"
          style={{ left: `${getPercent(effectiveTrimStart)}%` }}
          title="Drag to trim start (In)"
        >
          <div className="w-1.5 h-full bg-amber-400 group-hover:bg-amber-300 rounded-full shadow-[0_0_8px_rgba(251,191,36,0.6)] flex items-center justify-center">
            <div className="w-0.5 h-4 bg-black/60 rounded" />
          </div>
        </div>

        <div
          data-testid="trim-handle-end"
          onMouseDown={(e) => {
            e.stopPropagation();
            setDraggingTrim('end');
          }}
          className="absolute top-0 bottom-0 w-3 -translate-x-1.5 cursor-ew-resize z-25 flex flex-col items-center justify-center group"
          style={{ left: `${getPercent(effectiveTrimEnd)}%` }}
          title="Drag to trim end (Out)"
        >
          <div className="w-1.5 h-full bg-amber-400 group-hover:bg-amber-300 rounded-full shadow-[0_0_8px_rgba(251,191,36,0.6)] flex items-center justify-center">
            <div className="w-0.5 h-4 bg-black/60 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

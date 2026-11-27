import React, { useRef, useState, useEffect } from 'react';
import { ZoomPill, SilenceSegment, KeystrokeEvent, CaptionBlock } from '../types/telemetry';
import { autoZoomScaleCap } from '../engine/spring-physics';
import { DEFAULT_TRANSITION_MS, ZOOM_SPEEDS } from '../engine/camera-path';
import { AUTO_ZOOM_DEPTHS } from '../engine/spring-physics';
import type { AutoZoomSettings } from './EditorStudio';
import { StudioSlider } from './ui-primitives';
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
    <div className="ss-panel border-t p-3 select-none">
      {/* Timeline Controls & Quick Actions */}
      <div className="flex flex-wrap items-center gap-y-2 justify-between pb-2 mb-2 border-b border-studio-border text-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onTogglePlay}
            className="ss-btn ss-btn-primary w-8 h-8 p-0"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <span className="font-bold text-xs">❚❚</span>
            ) : (
              <span className="font-bold text-xs ml-0.5">▶</span>
            )}
          </button>

          <span className="ss-num text-[#A5B4FC] font-medium text-xs">
            {(currentTimeMs / 1000).toFixed(2)}s / {(durationMs / 1000).toFixed(2)}s
          </span>

          <button
            onClick={onAddPillAtPlayhead}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#6366F1]/18 hover:bg-[#6366F1]/28 text-[#A5B4FC] border border-[#6366F1]/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
            Add Zoom Pill
          </button>

          {onRedetectZooms && (
            <button
              onClick={onRedetectZooms}
              className="ss-btn ss-btn-secondary px-2.5 py-1.5"
              title="Rebuild one zoom per recorded click"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
              Re-detect Zooms
            </button>
          )}

          {autoZoom && onChangeAutoZoom && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#CBD5E1]">
              <button
                onClick={() => onChangeAutoZoom({ enabled: !autoZoom.enabled })}
                className={`px-2 py-1 rounded-md border font-medium transition-colors ${
                  autoZoom.enabled
                    ? 'ss-chip ss-chip-active text-studio-text'
                    : 'ss-chip'
                }`}
                title="Zoom in automatically on every click"
              >
                Auto-zoom: {autoZoom.enabled ? 'ON' : 'OFF'}
              </button>
              <select
                value={String(autoZoom.depth)}
                disabled={!autoZoom.enabled}
                onChange={(e) => onChangeAutoZoom({ depth: parseFloat(e.target.value) })}
                className="rounded bg-white/10 px-1 py-1 text-[11px] text-[#E2E8F0] focus:outline-none disabled:opacity-40"
                title="How deep every auto zoom goes"
              >
                {AUTO_ZOOM_DEPTHS.map((d) => (
                  <option key={d} value={String(d)} className="bg-studio-panel">{d}x</option>
                ))}
              </select>
              <select
                value={String(autoZoom.speedMs)}
                disabled={!autoZoom.enabled}
                onChange={(e) => onChangeAutoZoom({ speedMs: parseInt(e.target.value, 10) })}
                className="rounded bg-white/10 px-1 py-1 text-[11px] text-[#E2E8F0] focus:outline-none disabled:opacity-40"
                title="How fast auto zooms zoom in, pan and zoom out"
              >
                {ZOOM_SPEEDS.map((s) => (
                  <option key={s.ms} value={String(s.ms)} className="bg-studio-panel">{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {recordedClickCount !== undefined && (
            <span
              className="ss-num text-[11px] text-studio-muted"
              title="Clicks recorded during the recording, and the auto zooms made from them"
            >
              {recordedClickCount} click{recordedClickCount === 1 ? '' : 's'} recorded → {pills.filter((p) => p.autoGenerated).length} auto-zoom{pills.filter((p) => p.autoGenerated).length === 1 ? '' : 's'}
            </span>
          )}

          {showCaptions && onAddCaptionAtPlayhead && (
            <button
              onClick={onAddCaptionAtPlayhead}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FBBF24]/15 hover:bg-[#FBBF24]/30 text-[#FCD34D] border border-[#FBBF24]/30 transition-colors"
            >
              <Subtitles className="w-3.5 h-3.5" strokeWidth={1.75} />
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
                      ? 'bg-[#FBBF24]/15 hover:bg-[#FBBF24]/30 text-[#FCD34D] border-[#FBBF24]/40 shadow-sm shadow-amber-500/20'
                      : 'bg-studio-card hover:bg-studio-cardHover text-studio-muted border-studio-border'
                  }`}
                  title="Toggle automatic silence skipping during playback & export"
                >
                  <Scissors className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Auto-Cut Silences: {autoCutSilences ? 'ON' : 'OFF'}
                </button>
              )}

              <button
                onClick={onCutAllSilences}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#FB7185]/12 hover:bg-[#FB7185]/22 text-[#FDA4AF] border border-[#FB7185]/25 transition-colors"
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
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#FBBF24]/12 hover:bg-[#FBBF24]/25 text-[#FCD34D] border border-[#FBBF24]/30 transition-colors text-xs"
              title="Reset Trim bounds to full recording"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
              Reset Trim
            </button>
          )}
        </div>

        {selectedPill && (
          <div className="ss-panel flex items-center gap-4 px-3 py-1.5 rounded-lg">
            <span className="text-[11px] font-semibold text-[#A5B4FC] flex items-center gap-1">
              <Sliders className="w-3 h-3" strokeWidth={1.75} />
              Pill Inspector:
            </span>

            {/* Zoom Slider */}
            <label className="flex items-center gap-1.5 text-[11px]">
              Zoom:
              <StudioSlider
                min={1.2}
                max={2.8}
                step={0.1}
                className="!w-16"
                value={selectedPill.targetScale}
                onChange={(v) => onUpdatePill({ ...selectedPill, targetScale: v })}
              />
              <span className="ss-num text-[#A5B4FC]">{selectedPill.targetScale.toFixed(1)}x</span>
              {selectedPill.targetScale > autoZoomScaleCap(sourcePixelWidth) + 1e-6 && (
                <span
                  data-testid="sharpness-warning"
                  className="rounded bg-[#FBBF24]/15 px-1.5 py-0.5 text-[10px] text-[#FDE68A]"
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
                className="rounded bg-white/10 px-1 py-0.5 text-[11px] text-[#E2E8F0] focus:outline-none"
                title="How fast the camera zooms in, pans and zooms out for this zoom"
              >
                {!ZOOM_SPEEDS.some((s) => s.ms === (selectedPill.transitionDuration ?? DEFAULT_TRANSITION_MS)) && (
                  <option value={String(selectedPill.transitionDuration)} className="bg-studio-panel">
                    {selectedPill.transitionDuration}ms
                  </option>
                )}
                {ZOOM_SPEEDS.map((s) => (
                  <option key={s.ms} value={String(s.ms)} className="bg-studio-panel">{s.label}</option>
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
                  ? 'ss-chip ss-chip-active text-studio-text'
                  : 'bg-white/10 text-studio-muted hover:text-studio-text'
              }`}
            >
              <Box className="w-3 h-3" strokeWidth={1.75} />
              3D Tilt
            </button>

            {/* Spotlight Toggle */}
            <button
              onClick={() => onUpdatePill({ ...selectedPill, spotlight: !selectedPill.spotlight })}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
                selectedPill.spotlight
                  ? 'ss-chip border border-[#FBBF24]/40 bg-[#FBBF24]/18 text-studio-text'
                  : 'bg-white/10 text-studio-muted hover:text-studio-text'
              }`}
            >
              <Eye className="w-3 h-3" strokeWidth={1.75} />
              Spotlight Dimming
            </button>

            <button
              onClick={() => onDeletePill(selectedPill.id)}
              className="p-1 hover:text-[#FB7185] transition-colors"
              title="Delete Zoom Pill"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {selectedCaption && (
          <div className="flex items-center gap-3 bg-[#FBBF24]/10 px-3 py-1 rounded-lg border border-[#FBBF24]/20 text-[#CBD5E1]">
            <span className="text-[11px] font-semibold text-[#FCD34D] flex items-center gap-1">
              <Subtitles className="w-3 h-3" strokeWidth={1.75} />
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
              className="bg-black/50 border border-[#FBBF24]/30 rounded px-2 py-0.5 text-xs text-studio-text w-48 focus:outline-none focus:border-amber-400 font-sans"
              placeholder="Edit subtitle text..."
            />
            {onDeleteCaption && (
              <button
                onClick={() => {
                  onDeleteCaption(selectedCaption.id);
                  setSelectedCaptionId(null);
                }}
                className="p-1 hover:text-[#FB7185] transition-colors"
                title="Delete Caption Block"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
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
        className={`relative ${showCaptions ? 'h-36' : 'h-24'} bg-studio-canvas rounded-xl border border-studio-border overflow-hidden cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all`}
      >
        {/* Track 1: Audio Waveform & Silences & Keystrokes */}
        <div className={`absolute top-0 left-0 right-0 ${showCaptions ? 'h-8' : 'h-10'} border-b border-studio-border flex items-center px-2`}>
          {/* Real waveform: drawn only from the decoded audio track of the recording */}
          {waveformPeaks.length > 0 ? (
            <div className="w-full h-5 flex items-center gap-[1px] opacity-70" data-waveform="real">
              {waveformPeaks.map((peak, i) => (
                <div
                  key={i}
                  className="flex-1 ss-waveform-bar rounded-full"
                  style={{ height: `${Math.max(4, peak * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="w-full h-5 flex items-center justify-center" data-waveform="none">
              <span className="text-[9px] ss-num text-studio-meta tracking-wider">NO AUDIO</span>
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
                    : 'border-x border-studio-border opacity-40 hover:opacity-80'
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
                <span className={`text-[9px] ss-num font-medium truncate px-1 flex items-center gap-1 ${
                  isCutActive ? 'text-[#FDE68A] bg-black/60 rounded px-1 py-0.5 border border-[#FBBF24]/30' : 'text-studio-muted'
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
                className="absolute top-1 -translate-x-1/2 ss-status-badge text-studio-text border-white/20 bg-white/10 pointer-events-none"
                style={{ left: `${left}%` }}
              >
                {k.combo}
              </div>
            );
          })}
        </div>

        {/* Track 2 (Conditional): Auto-Captions Subtitle Track */}
        {showCaptions && (
          <div className="absolute top-[32px] left-0 right-0 h-10 border-b border-studio-border flex items-center px-2">
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
                      ? 'bg-gradient-to-r from-[#FBBF24] to-[#FCD34D] text-[#1A1206] font-semibold border border-[#FDE68A] ring-2 ring-[#FBBF24]/35 z-10 shadow-[0_4px_16px_-6px_rgba(251,191,36,0.7)]'
                      : 'bg-[#FBBF24]/25 hover:bg-[#FBBF24]/40 border border-amber-400/30 text-[#FDE68A]'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {/* Left Drag Resize Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDownResizeCaption(e, cap.id, 'start')}
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/25 hover:bg-white/60 rounded-l-md transition-opacity"
                    title="Drag to adjust caption start"
                  />

                  <div className="flex items-center gap-1.5 truncate">
                    <Subtitles className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                    <span className="text-[10px] truncate max-w-[180px]">
                      {cap.text}
                    </span>
                  </div>

                  <span className="text-[8px] ss-num opacity-80 ml-1 shrink-0">
                    {((cap.endTime - cap.startTime) / 1000).toFixed(1)}s
                  </span>

                  {/* Right Drag Resize Handle */}
                  <div
                    onMouseDown={(e) => handleMouseDownResizeCaption(e, cap.id, 'end')}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/25 hover:bg-white/60 rounded-r-md transition-opacity"
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
                    : 'ss-chip border-[#818CF8]/25 bg-[#6366F1]/12 hover:bg-[#6366F1]/22 text-[#C7D2FE]'
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                {/* Left Drag Resize Handle */}
                <div
                  onMouseDown={(e) => handleMouseDownResize(e, pill.id, 'start')}
                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/25 hover:bg-white/60 rounded-l-md transition-opacity"
                  title="Drag to adjust start time"
                />

                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  {showLabel ? (
                    <>
                      <span className="text-[11px] font-semibold text-studio-text truncate">{fullLabel}</span>
                      {pill.tiltX !== 0 && <Box className="w-3 h-3 shrink-0 text-[#C7D2FE]" strokeWidth={1.75} />}
                      {pill.spotlight && <Eye className="w-3 h-3 shrink-0 text-[#FCD34D]" strokeWidth={1.75} />}
                    </>
                  ) : showGlyph ? (
                    <ZoomIn className="w-3 h-3 shrink-0 text-[#C7D2FE]" strokeWidth={1.75} />
                  ) : null}
                </div>

                <span className="text-[9px] ss-num text-[#C7D2FE]/80 ml-1 shrink-0">
                  {durationLabel}
                </span>

                {/* Right Drag Resize Handle */}
                <div
                  onMouseDown={(e) => handleMouseDownResize(e, pill.id, 'end')}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/25 hover:bg-white/60 rounded-r-md transition-opacity"
                  title="Drag to adjust end time"
                />
              </div>
            );
          })}
        </div>

        {/* Scrubbing Playhead */}
        <div
          className="ss-playhead absolute top-0 bottom-0 w-[2px] pointer-events-none z-30"
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
          <div className="w-1.5 h-full ss-trim-handle group-hover:brightness-110 rounded-full flex items-center justify-center">
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
          <div className="w-1.5 h-full ss-trim-handle group-hover:brightness-110 rounded-full flex items-center justify-center">
            <div className="w-0.5 h-4 bg-black/60 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useRef, useState, useEffect } from 'react';
import { ZoomPill, SilenceSegment, KeystrokeEvent } from '../types/telemetry';
import { Scissors, Plus, Trash2, Eye, Box, Sliders } from 'lucide-react';

interface MagneticTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
  pills: ZoomPill[];
  onUpdatePill: (pill: ZoomPill) => void;
  onDeletePill: (id: string) => void;
  onAddPillAtPlayhead: () => void;
  silences: SilenceSegment[];
  onToggleSilenceCut: (id: string) => void;
  onCutAllSilences: () => void;
  keystrokes: KeystrokeEvent[];
}

export function MagneticTimeline({
  durationMs,
  currentTimeMs,
  isPlaying,
  onTogglePlay,
  onSeek,
  pills,
  onUpdatePill,
  onDeletePill,
  onAddPillAtPlayhead,
  silences,
  onToggleSilenceCut,
  onCutAllSilences,
  keystrokes
}: MagneticTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [selectedPillId, setSelectedPillId] = useState<string | null>(null);
  const [resizingPill, setResizingPill] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);

  const handleMouseDownResize = (e: React.MouseEvent, pillId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingPill({ id: pillId, edge });
  };

  useEffect(() => {
    if (!resizingPill) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || durationMs <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTimeMs = Math.round(ratio * durationMs);

      const targetPill = pills.find((p) => p.id === resizingPill.id);
      if (!targetPill) return;

      if (resizingPill.edge === 'start') {
        const nextStart = Math.min(targetPill.endTime - 600, Math.max(0, targetTimeMs));
        onUpdatePill({ ...targetPill, startTime: nextStart });
      } else {
        const nextEnd = Math.max(targetPill.startTime + 600, Math.min(durationMs, targetTimeMs));
        onUpdatePill({ ...targetPill, endTime: nextEnd });
      }
    };

    const handleMouseUp = () => {
      setResizingPill(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingPill, durationMs, pills, onUpdatePill]);

  const selectedPill = pills.find((p) => p.id === selectedPillId);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || durationMs <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * durationMs);
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

          {silences.length > 0 && (
            <button
              onClick={onCutAllSilences}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 transition-colors"
              title="Auto-tighten timeline by removing pauses > 1.2s"
            >
              <Scissors className="w-3.5 h-3.5" />
              1-Click Remove Silences ({silences.length} pauses)
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
      </div>

      {/* Main Multi-Track Magnetic Timeline */}
      <div
        ref={timelineRef}
        onClick={handleTimelineClick}
        className="relative h-24 bg-[#0B0C10] rounded-xl border border-white/10 overflow-hidden cursor-pointer"
      >
        {/* Track 1: Audio Waveform & Silences */}
        <div className="absolute top-0 left-0 right-0 h-10 border-b border-white/5 flex items-center px-2">
          {/* Simulated Waveform bars */}
          <div className="w-full h-5 flex items-center gap-[2px] opacity-40">
            {Array.from({ length: 80 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-purple-400 rounded-full"
                style={{ height: `${20 + Math.sin(i * 0.4) * 30 + ((i % 4) * 10)}%` }}
              />
            ))}
          </div>

          {/* Shaded Red Silence Blocks */}
          {silences.map((silence) => {
            const left = getPercent(silence.startTime);
            const width = getPercent(silence.endTime) - left;
            return (
              <div
                key={silence.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSilenceCut(silence.id);
                }}
                className={`absolute top-0 bottom-0 flex items-center justify-center transition-all ${
                  silence.markedForCut
                    ? 'bg-red-500/25 border-x border-red-500/50'
                    : 'bg-white/5 border-x border-white/10 opacity-50'
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`Silence pause (${(silence.duration / 1000).toFixed(1)}s) - Click to toggle cut`}
              >
                <span className="text-[9px] text-red-300 font-mono font-medium truncate px-1">
                  {silence.markedForCut ? '✂ Cut' : 'Keep'}
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
                className="absolute top-1 -translate-x-1/2 px-1.5 py-0.5 bg-white/20 border border-white/30 rounded text-[9px] font-mono text-white pointer-events-none"
                style={{ left: `${left}%` }}
              >
                {k.combo}
              </div>
            );
          })}
        </div>

        {/* Track 2: Zoom Pills (Magnetic Blocks) */}
        <div className="absolute bottom-0 left-0 right-0 h-14 flex items-center px-2">
          {pills.map((pill) => {
            const left = getPercent(pill.startTime);
            const width = Math.max(2, getPercent(pill.endTime) - left);
            const isSelected = pill.id === selectedPillId;

            return (
              <div
                key={pill.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPillId(pill.id);
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

                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-[11px] font-semibold text-white truncate">
                    {pill.label || `Zoom ${pill.targetScale.toFixed(1)}x`}
                  </span>
                  {pill.tiltX !== 0 && <Box className="w-3 h-3 text-purple-200" />}
                  {pill.spotlight && <Eye className="w-3 h-3 text-amber-300" />}
                </div>

                <span className="text-[9px] font-mono text-purple-200/80 ml-1">
                  {((pill.endTime - pill.startTime) / 1000).toFixed(1)}s
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
      </div>
    </div>
  );
}

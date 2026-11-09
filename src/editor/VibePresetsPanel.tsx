import React from 'react';
import {
  AspectRatioType,
  VibePreset,
  VibePresetId,
  RecordingMetadata
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { Palette, Volume2, Sparkles, Monitor, Smartphone, Square, Tv } from 'lucide-react';

interface VibePresetsPanelProps {
  currentPreset: VibePreset;
  onSelectPreset: (preset: VibePreset) => void;
  aspectRatio: AspectRatioType;
  onChangeAspectRatio: (aspect: AspectRatioType) => void;
  metadata?: RecordingMetadata;
  showSpotlight: boolean;
  onToggleSpotlight: (val: boolean) => void;
  showCursor: boolean;
  onToggleCursor: (val: boolean) => void;
  showHud: boolean;
  onToggleHud: (val: boolean) => void;
  soundEnabled: boolean;
  onToggleSound: (val: boolean) => void;
  onUpdatePresetBorderRadius: (radius: number) => void;
}

export function VibePresetsPanel({
  currentPreset,
  onSelectPreset,
  aspectRatio,
  onChangeAspectRatio,
  metadata,
  showSpotlight,
  onToggleSpotlight,
  showCursor,
  onToggleCursor,
  showHud,
  onToggleHud,
  soundEnabled,
  onToggleSound,
  onUpdatePresetBorderRadius
}: VibePresetsPanelProps) {
  const handleMatchBrand = () => {
    if (!metadata?.brandColors) return;
    const { primary, secondary, background } = metadata.brandColors;
    const brandPreset: VibePreset = {
      id: 'custom',
      name: 'Website Brand',
      gradientColors: [background || '#0B0C10', primary || '#8B5CF6', secondary || '#6366F1'],
      borderRadius: 18,
      shadowBlur: 50,
      shadowColor: 'rgba(0, 0, 0, 0.85)',
      cursorRingColor: primary || '#8B5CF6',
      keycapTheme: 'glass'
    };
    onSelectPreset(brandPreset);
  };

  return (
    <aside className="w-72 bg-[#14161D] border-r border-white/10 p-4 flex flex-col gap-5 overflow-y-auto select-none">
      {/* Aspect Ratio Switcher */}
      <div>
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2.5 block">
          Aspect Ratio
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onChangeAspectRatio('16:9')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '16:9'
                ? 'bg-purple-600 text-white font-medium shadow-md shadow-purple-600/30'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            16:9 (YouTube/X)
          </button>

          <button
            onClick={() => onChangeAspectRatio('9:16')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '9:16'
                ? 'bg-purple-600 text-white font-medium shadow-md shadow-purple-600/30'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            9:16 (Shorts/TikTok)
          </button>

          <button
            onClick={() => onChangeAspectRatio('1:1')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '1:1'
                ? 'bg-purple-600 text-white font-medium shadow-md shadow-purple-600/30'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            1:1 (LinkedIn)
          </button>

          <button
            onClick={() => onChangeAspectRatio('4:3')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '4:3'
                ? 'bg-purple-600 text-white font-medium shadow-md shadow-purple-600/30'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            4:3 (Classic)
          </button>
        </div>
      </div>

      {/* Vibe Presets */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-purple-400" />
            Vibe Presets
          </label>
        </div>

        <div className="space-y-1.5">
          {(Object.keys(VIBE_PRESETS) as VibePresetId[])
            .filter((id) => id !== 'custom')
            .map((id) => {
              const preset = VIBE_PRESETS[id];
              const isSelected = currentPreset.id === id;

              return (
                <button
                  key={id}
                  onClick={() => onSelectPreset(preset)}
                  className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs transition-all ${
                    isSelected
                      ? 'bg-purple-600/20 border-purple-500 text-white'
                      : 'bg-white/5 border-white/5 hover:bg-white/10 text-gray-300'
                  }`}
                >
                  <span className="font-medium">{preset.name}</span>
                  <div className="flex items-center gap-1">
                    <div
                      className="w-3 h-3 rounded-full border border-white/20"
                      style={{ backgroundColor: preset.gradientColors[1] }}
                    />
                    <div
                      className="w-3 h-3 rounded-full border border-white/20"
                      style={{ backgroundColor: preset.gradientColors[2] }}
                    />
                  </div>
                </button>
              );
            })}
        </div>

        {/* Match Website Brand Button */}
        {metadata?.brandColors && (
          <button
            onClick={handleMatchBrand}
            className="w-full mt-2 py-2 px-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-600/25 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-200" />
            Match Website Brand Colors
          </button>
        )}
      </div>

      {/* Window Corner Radius Slider */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5 text-gray-300">
          <span>Window Corner Radius</span>
          <span className="font-mono text-purple-400">{currentPreset.borderRadius}px</span>
        </div>
        <input
          type="range"
          min="8"
          max="32"
          value={currentPreset.borderRadius}
          onChange={(e) => onUpdatePresetBorderRadius(parseInt(e.target.value))}
          className="w-full accent-purple-500"
        />
      </div>

      {/* Visual & Sound Superpowers Toggles */}
      <div className="pt-2 border-t border-white/10 space-y-2.5">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider block">
          Visual & Audio Effects
        </label>

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span>Spotlight Dimming Mode</span>
          <input
            type="checkbox"
            checked={showSpotlight}
            onChange={(e) => onToggleSpotlight(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span>Vector 4K Cursor & Blur</span>
          <input
            type="checkbox"
            checked={showCursor}
            onChange={(e) => onToggleCursor(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span>3D Keystroke HUD (Cmd+K)</span>
          <input
            type="checkbox"
            checked={showHud}
            onChange={(e) => onToggleHud(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-purple-400" />
            Procedural Sound Effects
          </span>
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(e) => onToggleSound(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </label>
      </div>
    </aside>
  );
}

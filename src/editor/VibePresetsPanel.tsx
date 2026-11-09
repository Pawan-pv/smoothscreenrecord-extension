import React from 'react';
import {
  AspectRatioType,
  VibePreset,
  VibePresetId,
  RecordingMetadata,
  CursorTheme,
  CaptionStyle
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { Palette, Volume2, Sparkles, Monitor, Smartphone, Square, Tv, MousePointer, Subtitles, Scissors } from 'lucide-react';

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
  followCursor: boolean;
  onToggleFollowCursor: (val: boolean) => void;
  soundEnabled: boolean;
  onToggleSound: (val: boolean) => void;
  autoCutSilences?: boolean;
  onToggleAutoCutSilences?: (val: boolean) => void;
  onUpdatePresetBorderRadius: (radius: number) => void;
  cursorTheme: CursorTheme;
  onChangeCursorTheme: (theme: CursorTheme) => void;
  cursorScale: number;
  onChangeCursorScale: (scale: number) => void;
  showCaptions: boolean;
  onToggleCaptions: (val: boolean) => void;
  captionStyle: CaptionStyle;
  onChangeCaptionStyle: (style: CaptionStyle) => void;
  showIntroCard?: boolean;
  onToggleIntroCard?: (val: boolean) => void;
  introHeadline?: string;
  onChangeIntroHeadline?: (val: string) => void;
  introSubheadline?: string;
  onChangeIntroSubheadline?: (val: string) => void;
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
  followCursor,
  onToggleFollowCursor,
  soundEnabled,
  onToggleSound,
  autoCutSilences = true,
  onToggleAutoCutSilences,
  onUpdatePresetBorderRadius,
  cursorTheme,
  onChangeCursorTheme,
  cursorScale,
  onChangeCursorScale,
  showCaptions,
  onToggleCaptions,
  captionStyle,
  onChangeCaptionStyle,
  showIntroCard,
  onToggleIntroCard,
  introHeadline,
  onChangeIntroHeadline,
  introSubheadline,
  onChangeIntroSubheadline
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

      {/* Cursor Theme & Scale Customizer */}
      <div className="pt-2 border-t border-white/10 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-300 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <MousePointer className="w-3.5 h-3.5 text-purple-400" />
            Vector Cursor Styling
          </span>
          <span className="font-mono text-purple-400 text-[11px]">{cursorScale.toFixed(1)}x</span>
        </div>

        {/* Theme pills */}
        <div className="grid grid-cols-3 gap-1 text-[11px]">
          <button
            onClick={() => onChangeCursorTheme('mac-obsidian')}
            className={`p-1.5 rounded-lg border text-center transition-colors ${
              cursorTheme === 'mac-obsidian'
                ? 'bg-purple-600/25 border-purple-500 text-white font-medium'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            Obsidian
          </button>
          <button
            onClick={() => onChangeCursorTheme('neon-glow')}
            className={`p-1.5 rounded-lg border text-center transition-colors ${
              cursorTheme === 'neon-glow'
                ? 'bg-purple-600/25 border-purple-500 text-purple-200 font-medium'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            Neon Glow
          </button>
          <button
            onClick={() => onChangeCursorTheme('minimal-white')}
            className={`p-1.5 rounded-lg border text-center transition-colors ${
              cursorTheme === 'minimal-white'
                ? 'bg-purple-600/25 border-purple-500 text-white font-medium'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            Clean White
          </button>
        </div>

        {/* Cursor Scale Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>Pointer Size</span>
          </div>
          <input
            type="range"
            min="0.8"
            max="2.0"
            step="0.1"
            value={cursorScale}
            onChange={(e) => onChangeCursorScale(parseFloat(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>
      </div>

      {/* TikTok / Reels Auto-Captions */}
      <div className="pt-2 border-t border-white/10 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-300 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <Subtitles className="w-3.5 h-3.5 text-amber-400" />
            Viral Auto-Captions
          </span>
          <input
            type="checkbox"
            checked={showCaptions}
            onChange={(e) => onToggleCaptions(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </div>

        {showCaptions && (
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <button
              onClick={() => onChangeCaptionStyle('tiktok-bold')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'tiktok-bold'
                  ? 'bg-amber-500/25 border-amber-500 text-amber-200 font-medium'
                  : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
              }`}
            >
              TikTok Bold (Yellow)
            </button>
            <button
              onClick={() => onChangeCaptionStyle('apple-keynote')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'apple-keynote'
                  ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-medium'
                  : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Apple Keynote (Glass)
            </button>
            <button
              onClick={() => onChangeCaptionStyle('minimal-pill')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'minimal-pill'
                  ? 'bg-purple-600/25 border-purple-500 text-purple-200 font-medium'
                  : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Minimal Pill
            </button>
            <button
              onClick={() => onChangeCaptionStyle('classic-sub')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'classic-sub'
                  ? 'bg-white/20 border-white/40 text-white font-medium'
                  : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Classic Sub
            </button>
          </div>
        )}
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
          <span>Camera Dynamic Follow (Cursor)</span>
          <input
            type="checkbox"
            checked={followCursor}
            onChange={(e) => onToggleFollowCursor(e.target.checked)}
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

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span className="flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            Auto-Cut Silences (&gt;1.2s)
          </span>
          <input
            type="checkbox"
            checked={!!autoCutSilences}
            onChange={(e) => onToggleAutoCutSilences?.(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-amber-500 focus:ring-0"
          />
        </label>
      </div>

      {/* Built-In Intro Title Hook Cards */}
      <div className="pt-2 border-t border-white/10 space-y-2.5">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center justify-between">
          <span>Intro Title Hook Card</span>
          <span className="text-[10px] text-purple-400 font-mono">1.5s 3D Zoom</span>
        </label>

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span>Enable Intro Title Card</span>
          <input
            type="checkbox"
            checked={!!showIntroCard}
            onChange={(e) => onToggleIntroCard?.(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </label>

        {showIntroCard && (
          <div className="space-y-2.5 pt-1">
            <div>
              <span className="text-[10px] text-gray-400 uppercase font-medium block mb-1">Headline</span>
              <input
                type="text"
                value={introHeadline || ''}
                onChange={(e) => onChangeIntroHeadline?.(e.target.value)}
                placeholder="e.g. Introducing SmoothStudio 2.0"
                className="w-full bg-black/50 border border-white/15 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none"
              />
            </div>

            <div>
              <span className="text-[10px] text-gray-400 uppercase font-medium block mb-1">Subheadline</span>
              <input
                type="text"
                value={introSubheadline || ''}
                onChange={(e) => onChangeIntroSubheadline?.(e.target.value)}
                placeholder="e.g. Cinematic screen demos in seconds"
                className="w-full bg-black/50 border border-white/15 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none"
              />
            </div>

            {/* Quick Title Hook Templates */}
            <div className="flex flex-wrap gap-1 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  onChangeIntroHeadline?.('Introducing SmoothStudio 2.0');
                  onChangeIntroSubheadline?.('Cinematic screen demos in seconds');
                }}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-purple-300 transition-colors"
              >
                Launch
              </button>
              <button
                type="button"
                onClick={() => {
                  onChangeIntroHeadline?.('New Feature Walkthrough');
                  onChangeIntroSubheadline?.('See what is possible with local hardware acceleration');
                }}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-purple-300 transition-colors"
              >
                Feature
              </button>
              <button
                type="button"
                onClick={() => {
                  onChangeIntroHeadline?.('Quick Step-by-Step Guide');
                  onChangeIntroSubheadline?.('Everything you need to know in 60 seconds');
                }}
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-purple-300 transition-colors"
              >
                Guide
              </button>
            </div>

            <p className="text-[10px] text-gray-400 leading-tight">
              Animate hook title over brand mesh gradient before 3D spring zoom into recording.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

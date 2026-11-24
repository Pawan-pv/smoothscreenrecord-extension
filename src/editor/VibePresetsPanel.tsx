import React from 'react';
import {
  AspectRatioType,
  VibePreset,
  VibePresetId,
  RecordingMetadata,
  CursorTheme,
  CapturedNativeCursor,
  CaptionStyle,
  BackdropMatrixParams,
  FramingMode,
  ShadowMode,
  BackgroundSpec
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import type { CursorMotionSettings } from '../engine/cursor-spline';
import { GRADIENT_PRESETS, gradientCss } from '../engine/background-painter';
import { WALLPAPERS, getWallpaperThumbnail } from '../engine/wallpapers';

type BackgroundTab = 'wallpaper' | 'gradient' | 'color' | 'image';
const BACKGROUND_TABS: ReadonlyArray<readonly [BackgroundTab, string]> = [
  ['wallpaper', 'Wallpaper'],
  ['gradient', 'Gradient'],
  ['color', 'Color'],
  ['image', 'Image']
];
const tabOf = (spec: BackgroundSpec): BackgroundTab =>
  spec.kind === 'solid' ? 'color' : spec.kind === 'image' ? 'image' : spec.kind === 'gradient' ? 'gradient' : 'wallpaper';
import {
  Palette,
  Volume2,
  Sparkles,
  Monitor,
  Smartphone,
  Square,
  Tv,
  MousePointer,
  Subtitles,
  Scissors,
  Layers,
  RotateCcw,
  Info,
  Upload,
  Sliders
} from 'lucide-react';

interface VibePresetsPanelProps {
  currentPreset: VibePreset;
  onSelectPreset: (preset: VibePreset) => void;
  aspectRatio: AspectRatioType;
  onChangeAspectRatio: (aspect: AspectRatioType) => void;
  framingMode: FramingMode;
  onChangeFramingMode: (mode: FramingMode) => void;
  shadowMode: ShadowMode;
  onChangeShadowMode: (mode: ShadowMode) => void;
  metadata?: RecordingMetadata;
  backdropParams?: BackdropMatrixParams;
  onChangeBackdropParams?: (params: Partial<BackdropMatrixParams>) => void;
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
  cursorSmoothing: number;
  onChangeCursorSmoothing: (value: number) => void;
  cursorMotion: CursorMotionSettings;
  onChangeCursorMotion: (change: Partial<CursorMotionSettings>) => void;
  capturedNativeCursor?: CapturedNativeCursor;
  showCaptions: boolean;
  onToggleCaptions: (val: boolean) => void;
  captionStyle: CaptionStyle;
  onChangeCaptionStyle: (style: CaptionStyle) => void;
  captionBackdrop: number;
  onChangeCaptionBackdrop: (val: number) => void;
  showIntroCard?: boolean;
  onToggleIntroCard?: (val: boolean) => void;
  introHeadline?: string;
  onChangeIntroHeadline?: (val: string) => void;
  introSubheadline?: string;
  onChangeIntroSubheadline?: (val: string) => void;
  showOutroCard?: boolean;
  onToggleOutroCard?: (val: boolean) => void;
  outroHeadline?: string;
  onChangeOutroHeadline?: (val: string) => void;
  outroCtaText?: string;
  onChangeOutroCtaText?: (val: string) => void;
  framePadding?: number;
  onChangeFramePadding?: (val: number) => void;
  background?: BackgroundSpec;
  onChangeBackground?: (spec: BackgroundSpec) => void;
  backgroundColor?: string | null;
  onSelectBackgroundColor?: (val: string | null) => void;
  backgroundImageUrl?: string | null;
  onSelectBackgroundImage?: (url: string | null, img: HTMLImageElement | null) => void;
  onBackgroundImageError?: (url: string) => void;
}

export function VibePresetsPanel({
  currentPreset,
  onSelectPreset,
  aspectRatio,
  onChangeAspectRatio,
  framingMode,
  onChangeFramingMode,
  shadowMode,
  onChangeShadowMode,
  metadata,
  backdropParams,
  onChangeBackdropParams,
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
  autoCutSilences = false,
  onToggleAutoCutSilences,
  onUpdatePresetBorderRadius,
  cursorTheme,
  onChangeCursorTheme,
  cursorScale,
  onChangeCursorScale,
  cursorSmoothing,
  onChangeCursorSmoothing,
  cursorMotion,
  onChangeCursorMotion,
  capturedNativeCursor,
  showCaptions,
  onToggleCaptions,
  captionStyle,
  onChangeCaptionStyle,
  captionBackdrop,
  onChangeCaptionBackdrop,
  showIntroCard,
  onToggleIntroCard,
  introHeadline,
  onChangeIntroHeadline,
  introSubheadline,
  onChangeIntroSubheadline,
  showOutroCard,
  onToggleOutroCard,
  outroHeadline,
  onChangeOutroHeadline,
  outroCtaText,
  onChangeOutroCtaText,
  framePadding,
  onChangeFramePadding,
  background = { kind: 'backdrop' },
  onChangeBackground,
  backgroundColor,
  onSelectBackgroundColor,
  backgroundImageUrl,
  onSelectBackgroundImage,
  onBackgroundImageError
}: VibePresetsPanelProps) {
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      onSelectBackgroundImage?.(url, img);
    };
    img.onerror = () => {
      onBackgroundImageError?.(url);
    };
    img.src = url;
  };

  const handleResetBackground = () => {
    onSelectBackgroundImage?.(null, null);
    onChangeBackground?.({ kind: 'backdrop' });
  };

  const [backgroundTab, setBackgroundTab] = React.useState<BackgroundTab>(tabOf(background));
  const hasCustomBackground = background.kind !== 'backdrop';
  const gradient = background.kind === 'gradient' ? background : null;
  const gradientColors = gradient?.colors ?? GRADIENT_PRESETS[0].colors;
  const gradientAngle = gradient?.angle ?? GRADIENT_PRESETS[0].angle;
  const gradientShape = gradient?.shape ?? GRADIENT_PRESETS[0].shape;
  /** Edits the current gradient (or starts one from the first preset). */
  const editGradient = (change: Partial<{ colors: string[]; angle: number; shape: 'linear' | 'radial' }>) => {
    onChangeBackground?.({
      kind: 'gradient',
      colors: change.colors ?? [...gradientColors],
      angle: change.angle ?? gradientAngle,
      shape: change.shape ?? gradientShape
    });
  };

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
      keycapTheme: 'glass',
      backdrop: {
        presetType: 'stripe-mesh',
        vignetteStrength: 65,
        illumination: 80,
        flowSpeed: 50,
        gridIntensity: 0,
        gradientAngle: 135
      }
    };
    onSelectPreset(brandPreset);
  };

  const PRESET_ORDER: VibePresetId[] = [
    'keynote-pro',
    'stripe-mesh',
    'linear-cosmic',
    'linear-dark',
    'apple-keynote',
    'indie-pop',
    'minimal-clean'
  ];

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

          <button
            onClick={() => onChangeAspectRatio('4:5')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors col-span-2 ${
              aspectRatio === '4:5'
                ? 'bg-purple-600 text-white font-medium shadow-md shadow-purple-600/30'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            4:5 (Instagram/LinkedIn)
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onChangeFramingMode('fit')}
            className={`p-1.5 rounded-lg text-[11px] border ${framingMode === 'fit' ? 'bg-purple-600/30 border-purple-500 text-white' : 'bg-white/5 border-white/5 text-gray-400'}`}
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => onChangeFramingMode('smart-fill')}
            className={`p-1.5 rounded-lg text-[11px] border ${framingMode === 'smart-fill' ? 'bg-purple-600/30 border-purple-500 text-white' : 'bg-white/5 border-white/5 text-gray-400'}`}
          >
            Smart Fill
          </button>
        </div>
      </div>

      {/* Vibe Presets */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-purple-400" />
            Studio Presets
          </label>
        </div>

        <div className="space-y-1.5">
          {PRESET_ORDER.map((id) => {
            const preset = VIBE_PRESETS[id];
            if (!preset) return null;
            const isSelected = currentPreset.id === id;

            return (
              <button
                key={id}
                onClick={() => onSelectPreset(preset)}
                className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs transition-all ${
                  isSelected
                    ? 'bg-purple-600/20 border-purple-500 text-white font-medium'
                    : 'bg-white/5 border-white/5 hover:bg-white/10 text-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{preset.name}</span>
                  {id === 'keynote-pro' && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-mono">STUDIO</span>
                  )}
                  {id === 'stripe-mesh' && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono">MESH</span>
                  )}
                  {id === 'linear-cosmic' && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">SPACE</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: preset.gradientColors[1] || preset.gradientColors[0] }}
                  />
                  <div
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: preset.gradientColors[2] || preset.gradientColors[1] }}
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

      {/* Advanced Backdrop Rendering Matrix Parameters */}
      <div className="pt-2 border-t border-white/10 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-300 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Backdrop Matrix
          </span>
          <span className="font-mono text-indigo-400 text-[10px]">
            {backdropParams?.presetType === 'stripe-mesh'
              ? 'Mesh Flow'
              : backdropParams?.presetType === 'linear-cosmic'
              ? 'Cosmic Space'
              : 'Studio Vignette'}
          </span>
        </div>

        {/* Backdrop Matrix Mode Selector Pills */}
        <div className="grid grid-cols-3 gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => {
              onChangeBackdropParams?.({ presetType: 'keynote-pro' });
              if (currentPreset.id !== 'keynote-pro') {
                onSelectPreset(VIBE_PRESETS['keynote-pro']);
              } else {
                // Already on this backdrop: choosing it again still drops an uploaded image / solid colour.
                handleResetBackground();
              }
            }}
            className={`p-1.5 rounded-lg border text-center transition-all ${
              (backdropParams?.presetType || currentPreset.backdrop?.presetType) === 'keynote-pro'
                ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-medium'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            Keynote Pro
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeBackdropParams?.({ presetType: 'stripe-mesh' });
              if (currentPreset.id !== 'stripe-mesh') {
                onSelectPreset(VIBE_PRESETS['stripe-mesh']);
              } else {
                // Already on this backdrop: choosing it again still drops an uploaded image / solid colour.
                handleResetBackground();
              }
            }}
            className={`p-1.5 rounded-lg border text-center transition-all ${
              (backdropParams?.presetType || currentPreset.backdrop?.presetType) === 'stripe-mesh'
                ? 'bg-purple-600/25 border-purple-500 text-purple-200 font-medium'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            Stripe Mesh
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeBackdropParams?.({ presetType: 'linear-cosmic' });
              if (currentPreset.id !== 'linear-cosmic') {
                onSelectPreset(VIBE_PRESETS['linear-cosmic']);
              } else {
                // Already on this backdrop: choosing it again still drops an uploaded image / solid colour.
                handleResetBackground();
              }
            }}
            className={`p-1.5 rounded-lg border text-center transition-all ${
              (backdropParams?.presetType || currentPreset.backdrop?.presetType) === 'linear-cosmic'
                ? 'bg-indigo-600/25 border-indigo-400 text-indigo-200 font-medium'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
            }`}
          >
            Linear Cosmic
          </button>
        </div>

        {/* Backdrop Matrix Sliders */}
        <div className="space-y-2 pt-1 text-[11px]">
          {/* Studio Vignette Strength */}
          <div className="space-y-1">
            <div className="flex justify-between text-gray-300">
              <span>Studio Vignette Strength</span>
              <span className="font-mono text-indigo-300">{backdropParams?.vignetteStrength ?? 75}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={backdropParams?.vignetteStrength ?? 75}
              onChange={(e) => onChangeBackdropParams?.({ vignetteStrength: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
              title="Studio lighting drop-shadow vignette falloff"
            />
          </div>

          {/* Ambient Illumination */}
          <div className="space-y-1">
            <div className="flex justify-between text-gray-300">
              <span>Ambient Illumination</span>
              <span className="font-mono text-indigo-300">{backdropParams?.illumination ?? 85}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              value={backdropParams?.illumination ?? 85}
              onChange={(e) => onChangeBackdropParams?.({ illumination: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
              title="Overhead key light intensity & gradient glow"
            />
          </div>

          {/* Mesh Flow Rate */}
          <div className="space-y-1">
            <div className="flex justify-between text-gray-300">
              <span>Mesh Flow Rate</span>
              <span className="font-mono text-indigo-300">{backdropParams?.flowSpeed ?? 50}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={backdropParams?.flowSpeed ?? 50}
              onChange={(e) => onChangeBackdropParams?.({ flowSpeed: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
              title="Fluid flow velocity for multi-stop mesh gradients and cosmic flares"
            />
          </div>

          {/* Cosmic Space Grid Intensity */}
          <div className="space-y-1">
            <div className="flex justify-between text-gray-300">
              <span>Geometric Matrix Grid</span>
              <span className="font-mono text-indigo-300">{backdropParams?.gridIntensity ?? 30}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={backdropParams?.gridIntensity ?? 30}
              onChange={(e) => onChangeBackdropParams?.({ gridIntensity: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
              title="Architectural coordinate grid in cosmic space"
            />
          </div>

          {/* Gradient Direction Angle */}
          <div className="space-y-1">
            <div className="flex justify-between text-gray-300">
              <span>Gradient Matrix Angle</span>
              <span className="font-mono text-indigo-300">{backdropParams?.gradientAngle ?? 135}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              value={backdropParams?.gradientAngle ?? 135}
              onChange={(e) => onChangeBackdropParams?.({ gradientAngle: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
              title="Orientation angle of dual-tone linear and mesh gradients"
            />
          </div>

          {/* Reset to defaults */}
          <button
            type="button"
            onClick={() => {
              const defaultParams = currentPreset.backdrop || {
                presetType: 'keynote-pro',
                vignetteStrength: 75,
                illumination: 85,
                flowSpeed: 40,
                gridIntensity: 0,
                gradientAngle: 180
              };
              onChangeBackdropParams?.(defaultParams);
            }}
            className="w-full mt-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center gap-1.5 text-[10px] transition-colors"
          >
            <RotateCcw className="w-3 h-3 text-indigo-400" />
            Reset Backdrop to Studio Defaults
          </button>
        </div>
      </div>

      {/* Window Corner Radius Slider */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5 text-gray-300">
          <span>Window Corner Radius</span>
          <span className="font-mono text-purple-400">{currentPreset.borderRadius}px</span>
        </div>
        <input
          type="range"
          min="0"
          max="36"
          value={currentPreset.borderRadius}
          onChange={(e) => onUpdatePresetBorderRadius(parseInt(e.target.value))}
          className="w-full accent-purple-500"
        />
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-xs mb-1.5 text-gray-300">
          <span>Frame Shadow</span>
          <span className="font-mono text-purple-400 capitalize">{shadowMode}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['none', 'subtle', 'studio'] as ShadowMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChangeShadowMode(mode)}
              className={`p-1.5 rounded-lg text-[11px] border capitalize ${shadowMode === mode ? 'bg-purple-600/30 border-purple-500 text-white' : 'bg-white/5 border-white/5 text-gray-400'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Frame Padding Slider (0% - 20%, default 8%) */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5 text-gray-300">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-purple-400" />
            Frame Padding
          </span>
          <span className="font-mono text-purple-400">{Math.round((framePadding ?? 0.08) * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="20"
          value={Math.round((framePadding ?? 0.08) * 100)}
          onChange={(e) => onChangeFramePadding?.(parseInt(e.target.value, 10) / 100)}
          className="w-full accent-purple-500 cursor-pointer"
        />
      </div>

      {/* Custom Background: gradients, solid colors and images */}
      <div className="pt-2 border-t border-white/10 space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-300 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-pink-400" />
            Background
          </span>
          {hasCustomBackground && (
            <button
              type="button"
              onClick={handleResetBackground}
              className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
              title="Back to the preset's animated backdrop"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-4 gap-1 text-[11px]" role="tablist">
          {BACKGROUND_TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={backgroundTab === id}
              onClick={() => setBackgroundTab(id)}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                backgroundTab === id ? 'bg-pink-600/20 border-pink-500 text-white font-medium' : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {backgroundTab === 'wallpaper' && (
          <div className="grid grid-cols-3 gap-1.5">
            {WALLPAPERS.map((wp) => {
              const selected = background.kind === 'wallpaper' && background.id === wp.id;
              return (
                <button
                  key={wp.id}
                  type="button"
                  onClick={() => onChangeBackground?.({ kind: 'wallpaper', id: wp.id })}
                  className={`relative aspect-video rounded-lg overflow-hidden border transition-all ${
                    selected ? 'border-white ring-1 ring-white/60' : 'border-white/10 hover:border-white/40'
                  }`}
                  title={wp.name}
                  aria-label={`${wp.name} wallpaper`}
                  aria-pressed={selected}
                >
                  <img src={getWallpaperThumbnail(wp.id)} alt="" className="w-full h-full object-cover" draggable={false} />
                </button>
              );
            })}
          </div>
        )}

        {backgroundTab === 'gradient' && (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-1.5">
              {GRADIENT_PRESETS.map((g) => {
                const selected = Boolean(gradient && gradient.angle === g.angle && gradient.shape === g.shape && gradient.colors.join() === g.colors.join());
                return (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => onChangeBackground?.({ kind: 'gradient', colors: [...g.colors], angle: g.angle, shape: g.shape })}
                    className={`h-9 rounded-lg border transition-all ${selected ? 'border-white ring-1 ring-white/60' : 'border-white/10 hover:border-white/40'}`}
                    style={{ background: gradientCss(g.colors, g.angle, g.shape) }}
                    title={g.name}
                    aria-label={`${g.name} gradient`}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              {gradientColors.map((color, i) => (
                <input
                  key={i}
                  type="color"
                  value={color}
                  onChange={(e) => {
                    const next = [...gradientColors];
                    next[i] = e.target.value;
                    editGradient({ colors: next });
                  }}
                  className="w-6 h-6 rounded-full border border-white/20 p-0 cursor-pointer bg-transparent"
                  title={`Color ${i + 1}`}
                  aria-label={`Gradient color ${i + 1}`}
                />
              ))}
              {gradientColors.length < 3 && (
                <button
                  type="button"
                  onClick={() => editGradient({ colors: [...gradientColors, gradientColors[gradientColors.length - 1]] })}
                  className="w-6 h-6 rounded-full border border-white/20 text-gray-300 text-xs hover:bg-white/10"
                  title="Add a color"
                >
                  +
                </button>
              )}
              {gradientColors.length > 2 && (
                <button
                  type="button"
                  onClick={() => editGradient({ colors: gradientColors.slice(0, -1) })}
                  className="w-6 h-6 rounded-full border border-white/20 text-gray-300 text-xs hover:bg-white/10"
                  title="Remove the last color"
                >
                  −
                </button>
              )}
              <div className="ml-auto flex rounded-lg border border-white/10 overflow-hidden text-[10px]">
                {(['linear', 'radial'] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => editGradient({ shape })}
                    className={`px-2 py-1 ${gradientShape === shape ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    {shape === 'linear' ? 'Linear' : 'Radial'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-gray-400">
                <span>Angle</span>
                <span className="font-mono text-pink-300">{Math.round(gradientAngle)}°</span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="5"
                value={gradientAngle}
                disabled={gradientShape === 'radial'}
                onChange={(e) => editGradient({ angle: parseInt(e.target.value, 10) })}
                className="w-full accent-pink-500 disabled:opacity-40"
                aria-label="Gradient angle"
              />
            </div>
          </div>
        )}

        {backgroundTab === 'color' && (
          <div className="flex items-center gap-1.5">
            {['#000000', '#0F172A', '#1E1B4B', '#18181B', '#3B0764', '#064E3B', '#F8FAFC', '#FDE68A'].map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onSelectBackgroundColor?.(color)}
                className={`w-5 h-5 rounded-full border transition-all ${
                  backgroundColor === color ? 'border-white scale-110 shadow-sm shadow-white/50' : 'border-white/20 hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
            <input
              type="color"
              value={backgroundColor || '#000000'}
              onChange={(e) => onSelectBackgroundColor?.(e.target.value)}
              className="w-5 h-5 rounded-full border border-white/20 p-0 cursor-pointer bg-transparent"
              title="Custom solid color"
            />
          </div>
        )}

        {backgroundTab === 'image' && (
          <div className="pt-1">
            <label className="w-full py-1.5 px-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 cursor-pointer flex items-center justify-center gap-2 transition-colors">
              <Upload className="w-3.5 h-3.5 text-indigo-400" />
              <span>{backgroundImageUrl ? 'Replace Custom Image' : 'Upload Background Image'}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          </div>
        )}
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
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>Cursor Smoothing</span>
            <span className="text-purple-300">{cursorSmoothing < 0.34 ? 'Crisp' : cursorSmoothing < 0.75 ? 'Smooth' : 'Cinematic'}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={cursorSmoothing}
            onChange={(e) => onChangeCursorSmoothing(parseFloat(e.target.value))}
            className="w-full accent-purple-500"
            aria-label="Cursor Smoothing"
          />
        </div>

        {/* Cursor motion: sway spring, tilt, click press, hide when idle */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>Sway</span>
            <span className="text-purple-300">{cursorMotion.sway < 34 ? 'Tight' : cursorMotion.sway < 67 ? 'Natural' : 'Languid'} · {Math.round(cursorMotion.sway)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={cursorMotion.sway}
            onChange={(e) => onChangeCursorMotion({ sway: parseFloat(e.target.value) })}
            className="w-full accent-purple-500"
            aria-label="Cursor Sway"
          />
        </div>
        <div className="space-y-1">
          <label className="flex justify-between items-center text-[11px] text-gray-400">
            <span>Tilt with speed</span>
            <input type="checkbox" checked={cursorMotion.tiltEnabled} onChange={(e) => onChangeCursorMotion({ tiltEnabled: e.target.checked })} />
          </label>
          <div className="flex justify-between text-[11px] text-gray-500">
            <span>Max angle</span>
            <span>{Math.round(cursorMotion.maxTiltDeg)}°</span>
          </div>
          <input
            type="range"
            min="2"
            max="30"
            step="1"
            value={cursorMotion.maxTiltDeg}
            disabled={!cursorMotion.tiltEnabled}
            onChange={(e) => onChangeCursorMotion({ maxTiltDeg: parseFloat(e.target.value) })}
            className="w-full accent-purple-500 disabled:opacity-40"
            aria-label="Cursor Max Tilt"
          />
        </div>
        <div className="space-y-1">
          <label className="flex justify-between items-center text-[11px] text-gray-400">
            <span>Click press</span>
            <input type="checkbox" checked={cursorMotion.pressEnabled} onChange={(e) => onChangeCursorMotion({ pressEnabled: e.target.checked })} />
          </label>
          <div className="flex justify-between text-[11px] text-gray-500">
            <span>Depth</span>
            <span>{Math.round(cursorMotion.pressDepth * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.05"
            max="0.35"
            step="0.01"
            value={cursorMotion.pressDepth}
            disabled={!cursorMotion.pressEnabled}
            onChange={(e) => onChangeCursorMotion({ pressDepth: parseFloat(e.target.value) })}
            className="w-full accent-purple-500 disabled:opacity-40"
            aria-label="Cursor Press Depth"
          />
        </div>
        <div className="space-y-1">
          <label className="flex justify-between items-center text-[11px] text-gray-400">
            <span>Hide when idle</span>
            <input type="checkbox" checked={cursorMotion.hideWhenIdle} onChange={(e) => onChangeCursorMotion({ hideWhenIdle: e.target.checked })} />
          </label>
          <div className="flex justify-between text-[11px] text-gray-500">
            <span>After</span>
            <span>{(cursorMotion.idleDelayMs / 1000).toFixed(1)} s still</span>
          </div>
          <input
            type="range"
            min="500"
            max="5000"
            step="100"
            value={cursorMotion.idleDelayMs}
            disabled={!cursorMotion.hideWhenIdle}
            onChange={(e) => onChangeCursorMotion({ idleDelayMs: parseFloat(e.target.value) })}
            className="w-full accent-purple-500 disabled:opacity-40"
            aria-label="Cursor Idle Delay"
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
          <>
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

          <div className="pt-1 space-y-1">
            {/* Caption Backdrop Opacity / Blur */}
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span>Backdrop Opacity / Blur</span>
              <span className="font-mono text-amber-300">{captionBackdrop}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={captionBackdrop}
              onChange={(e) => onChangeCaptionBackdrop(parseInt(e.target.value))}
              className="w-full accent-amber-500"
              title="Caption pill backdrop blur and opacity"
            />
          </div>
          </>
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
            id="vector-cursor-checkbox"
            type="checkbox"
            checked={showCursor}
            onChange={(e) => onToggleCursor(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
            title={capturedNativeCursor === 'always' ? 'The native cursor was captured; enabling this may show both cursors.' : undefined}
          />
        </label>

        {capturedNativeCursor === 'always' && (
          <p className="text-[11px] leading-relaxed text-amber-300/90">
            The native cursor was captured in this recording. The vector cursor starts off to prevent a double cursor; you can re-enable it manually.
          </p>
        )}
        {capturedNativeCursor === 'motion' && metadata?.displaySurface !== 'window' && metadata?.displaySurface !== 'monitor' && showCursor && (
          <p id="cursor-motion-note" className="text-[11px] leading-relaxed text-gray-400">
            Chrome may draw its own cursor while the mouse moves. If you see two cursors in the preview, switch the vector cursor off.
          </p>
        )}

        {(metadata?.displaySurface === 'window' || metadata?.displaySurface === 'monitor') && (
          <div id="cursor-mode-hint" className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-[11px] text-indigo-200 flex items-start gap-2 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              Window/monitor capture keeps the native cursor and disables DOM Auto Zoom. Add zooms manually, or share a browser tab for cinematic cursor tracking.
            </span>
          </div>
        )}

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
            id="autocut-silences-checkbox"
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
                placeholder="Headline text"
                className="w-full bg-black/50 border border-white/15 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none"
              />
            </div>

            <div>
              <span className="text-[10px] text-gray-400 uppercase font-medium block mb-1">Subheadline</span>
              <input
                type="text"
                value={introSubheadline || ''}
                onChange={(e) => onChangeIntroSubheadline?.(e.target.value)}
                placeholder="Subheadline text"
                className="w-full bg-black/50 border border-white/15 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none"
              />
            </div>

            <p className="text-[10px] text-gray-400 leading-tight">
              Animate hook title over brand mesh gradient before 3D spring zoom into recording.
            </p>
          </div>
        )}
      </div>

      {/* Built-In Outro CTA Title Hook Cards */}
      <div className="pt-2 border-t border-white/10 space-y-2.5">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center justify-between">
          <span>Outro CTA Card</span>
          <span className="text-[10px] text-pink-400 font-mono">Final 1.5s 3D Zoom</span>
        </label>

        <label className="flex items-center justify-between text-xs text-gray-300 hover:text-white cursor-pointer">
          <span>Enable Outro CTA Card</span>
          <input
            type="checkbox"
            checked={!!showOutroCard}
            onChange={(e) => onToggleOutroCard?.(e.target.checked)}
            className="rounded bg-gray-800 border-gray-600 text-purple-600 focus:ring-0"
          />
        </label>

        {showOutroCard && (
          <div className="space-y-2.5 pt-1">
            <div>
              <span className="text-[10px] text-gray-400 uppercase font-medium block mb-1">Outro Headline</span>
              <input
                type="text"
                value={outroHeadline || ''}
                onChange={(e) => onChangeOutroHeadline?.(e.target.value)}
                placeholder="Outro headline text"
                className="w-full bg-black/50 border border-white/15 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none"
              />
            </div>

            <div>
              <span className="text-[10px] text-gray-400 uppercase font-medium block mb-1">Outro CTA Badge / URL</span>
              <input
                type="text"
                value={outroCtaText || ''}
                onChange={(e) => onChangeOutroCtaText?.(e.target.value)}
                placeholder="Outro CTA text"
                className="w-full bg-black/50 border border-white/15 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none"
              />
            </div>

            <p className="text-[10px] text-gray-400 leading-tight">
              Final 1.5s: recording zooms out in 3D while the CTA card and glowing button animate in.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

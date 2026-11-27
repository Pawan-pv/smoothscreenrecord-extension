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
  BackgroundSpec,
  BackgroundEffects,
  ClickEffectStyle
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { STUDIO_CLICK_COLORS, type CursorMotionSettings } from '../engine/cursor-spline';
import type { CursorEngineKind } from '../engine/cursor-solve';
import { GRADIENT_PRESETS, gradientCss } from '../engine/background-painter';
import { WALLPAPERS, getWallpaperThumbnail } from '../engine/wallpapers';
import { StudioSlider } from './ui-primitives';

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
  clickEffectStyle: ClickEffectStyle;
  onChangeClickEffectStyle: (style: ClickEffectStyle) => void;
  clickColor: string;
  onChangeClickColor: (color: string) => void;
  cursorEngineKind: CursorEngineKind;
  onChangeCursorEngine: (kind: CursorEngineKind) => void;
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
  backgroundEffects?: BackgroundEffects;
  onChangeBackgroundEffects?: (change: Partial<BackgroundEffects>) => void;
  backgroundColor?: string | null;
  onSelectBackgroundColor?: (val: string | null) => void;
  backgroundImageUrl?: string | null;
  onSelectBackgroundImage?: (url: string | null, img: HTMLImageElement | null) => void;
  onBackgroundImageError?: (url: string) => void;
  /** Stores and selects an image file (picker, drag-drop, paste). */
  onUploadBackgroundFile?: (file: File) => void;
  recentUploads?: Array<{ id: string; name: string; url: string }>;
  onSelectRecentUpload?: (id: string) => void;
  onDeleteRecentUpload?: (id: string) => void;
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
  clickEffectStyle,
  onChangeClickEffectStyle,
  clickColor,
  onChangeClickColor,
  cursorEngineKind,
  onChangeCursorEngine,
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
  backgroundEffects = { blur: 0, dim: 0, motion: 0 },
  onChangeBackgroundEffects,
  backgroundColor,
  onSelectBackgroundColor,
  backgroundImageUrl,
  onSelectBackgroundImage,
  onBackgroundImageError,
  onUploadBackgroundFile,
  recentUploads = [],
  onSelectRecentUpload,
  onDeleteRecentUpload
}: VibePresetsPanelProps) {
  // Mirrors the renderer: on an aligned window/monitor capture the native cursor is
  // visible (vector cursor off), but click coordinates are placed on the frame, so
  // click ripples still draw.
  const clicksAligned = (metadata?.displaySurface !== 'window' && metadata?.displaySurface !== 'monitor')
    || metadata?.coordinateSpace === 'capture';
  const ripplesActive = showCursor || clicksAligned;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again
    if (!file) return;
    if (onUploadBackgroundFile) {
      onUploadBackgroundFile(file);
      return;
    }
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
    onChangeBackground?.({ kind: 'backdrop' });
  };

  const [backgroundTab, setBackgroundTab] = React.useState<BackgroundTab>(tabOf(background));
  // An image chosen from anywhere (drop, paste, restore) shows the Image tab.
  React.useEffect(() => {
    if (background.kind === 'image') setBackgroundTab('image');
  }, [background.kind]);
  const [isDraggingFile, setIsDraggingFile] = React.useState(false);
  const dragDepthRef = React.useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const handleBackgroundDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };
  const handleBackgroundDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleBackgroundDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  };
  const handleBackgroundDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    const files = Array.from(e.dataTransfer.files || []);
    const file = files.find((f) => f.type.startsWith('image/')) || files[0];
    if (file) onUploadBackgroundFile?.(file); // a non-image is refused there, with a message
  };
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
    <aside className="ss-panel w-72 border-r p-4 flex flex-col gap-5 overflow-y-auto select-none">
      {/* Aspect Ratio Switcher */}
      <div>
        <label className="ss-section-title mb-2.5 block">
          Aspect Ratio
        </label>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onChangeAspectRatio('16:9')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '16:9'
                ? 'ss-chip-active text-studio-text font-medium'
                : 'ss-chip hover:text-studio-text'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" strokeWidth={1.75} />
            16:9 (YouTube/X)
          </button>

          <button
            onClick={() => onChangeAspectRatio('9:16')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '9:16'
                ? 'ss-chip-active text-studio-text font-medium'
                : 'ss-chip hover:text-studio-text'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" strokeWidth={1.75} />
            9:16 (Shorts/TikTok)
          </button>

          <button
            onClick={() => onChangeAspectRatio('1:1')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '1:1'
                ? 'ss-chip-active text-studio-text font-medium'
                : 'ss-chip hover:text-studio-text'
            }`}
          >
            <Square className="w-3.5 h-3.5" strokeWidth={1.75} />
            1:1 (LinkedIn)
          </button>

          <button
            onClick={() => onChangeAspectRatio('4:3')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
              aspectRatio === '4:3'
                ? 'ss-chip-active text-studio-text font-medium'
                : 'ss-chip hover:text-studio-text'
            }`}
          >
            <Tv className="w-3.5 h-3.5" strokeWidth={1.75} />
            4:3 (Classic)
          </button>

          <button
            onClick={() => onChangeAspectRatio('4:5')}
            className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-colors col-span-2 ${
              aspectRatio === '4:5'
                ? 'ss-chip-active text-studio-text font-medium'
                : 'ss-chip hover:text-studio-text'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" strokeWidth={1.75} />
            4:5 (Instagram/LinkedIn)
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onChangeFramingMode('fit')}
            className={`p-1.5 rounded-lg text-[11px] border ${framingMode === 'fit' ? 'ss-chip ss-chip-active text-studio-text' : 'ss-chip'}`}
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => onChangeFramingMode('smart-fill')}
            className={`p-1.5 rounded-lg text-[11px] border ${framingMode === 'smart-fill' ? 'ss-chip ss-chip-active text-studio-text' : 'ss-chip'}`}
          >
            Smart Fill
          </button>
        </div>
      </div>

      {/* Vibe Presets */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <label className="ss-section-title flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
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
                    ? 'ss-card ss-chip-active text-studio-text font-medium'
                    : 'ss-card text-[#CBD5E1]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{preset.name}</span>
                  {id === 'keynote-pro' && (
                    <span className="ss-num text-[9px] px-1.5 py-0.5 rounded bg-[#38BDF8]/15 text-[#7DD3FC] ss-num">STUDIO</span>
                  )}
                  {id === 'stripe-mesh' && (
                    <span className="ss-num text-[9px] px-1.5 py-0.5 rounded bg-[#6366F1]/20 text-[#A5B4FC] ss-num">MESH</span>
                  )}
                  {id === 'linear-cosmic' && (
                    <span className="ss-num text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-[#A5B4FC] ss-num">SPACE</span>
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
            className="ss-btn ss-btn-primary w-full mt-2 py-2 px-3 text-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#C7D2FE]" strokeWidth={1.75} />
            Match Website Brand Colors
          </button>
        )}
      </div>

      {/* Advanced Backdrop Rendering Matrix Parameters */}
      <div className="pt-2 border-t border-studio-border space-y-3">
        <div className="flex items-center justify-between ss-section-title">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
            Backdrop Matrix
          </span>
          <span className="ss-num text-[#818CF8] text-[10px]">
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
                ? 'bg-[#38BDF8]/18 border-[#38BDF8] text-[#BAE6FD] font-medium'
                : 'ss-chip'
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
                ? 'ss-chip ss-chip-active text-studio-text font-medium'
                : 'ss-chip'
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
                ? 'bg-indigo-600/25 border-indigo-400 text-[#C7D2FE] font-medium'
                : 'ss-chip'
            }`}
          >
            Linear Cosmic
          </button>
        </div>

        {/* Backdrop Matrix Sliders */}
        <div className="space-y-2 pt-1 text-[11px]">
          {/* Studio Vignette Strength */}
          <div className="space-y-1">
            <div className="flex justify-between text-[#CBD5E1]">
              <span>Studio Vignette Strength</span>
              <span className="ss-num text-[#A5B4FC]">{backdropParams?.vignetteStrength ?? 75}%</span>
            </div>
            <StudioSlider
              min={0}
              max={100}
              value={backdropParams?.vignetteStrength ?? 75}
              onChange={(v) => onChangeBackdropParams?.({ vignetteStrength: v })}
              title="Studio lighting drop-shadow vignette falloff"
            />
          </div>

          {/* Ambient Illumination */}
          <div className="space-y-1">
            <div className="flex justify-between text-[#CBD5E1]">
              <span>Ambient Illumination</span>
              <span className="ss-num text-[#A5B4FC]">{backdropParams?.illumination ?? 85}%</span>
            </div>
            <StudioSlider
              min={10}
              max={100}
              value={backdropParams?.illumination ?? 85}
              onChange={(v) => onChangeBackdropParams?.({ illumination: v })}
              title="Overhead key light intensity & gradient glow"
            />
          </div>

          {/* Mesh Flow Rate */}
          <div className="space-y-1">
            <div className="flex justify-between text-[#CBD5E1]">
              <span>Mesh Flow Rate</span>
              <span className="ss-num text-[#A5B4FC]">{backdropParams?.flowSpeed ?? 50}%</span>
            </div>
            <StudioSlider
              min={0}
              max={100}
              value={backdropParams?.flowSpeed ?? 50}
              onChange={(v) => onChangeBackdropParams?.({ flowSpeed: v })}
              title="Fluid flow velocity for multi-stop mesh gradients and cosmic flares"
            />
          </div>

          {/* Cosmic Space Grid Intensity */}
          <div className="space-y-1">
            <div className="flex justify-between text-[#CBD5E1]">
              <span>Geometric Matrix Grid</span>
              <span className="ss-num text-[#A5B4FC]">{backdropParams?.gridIntensity ?? 30}%</span>
            </div>
            <StudioSlider
              min={0}
              max={100}
              value={backdropParams?.gridIntensity ?? 30}
              onChange={(v) => onChangeBackdropParams?.({ gridIntensity: v })}
              title="Architectural coordinate grid in cosmic space"
            />
          </div>

          {/* Gradient Direction Angle */}
          <div className="space-y-1">
            <div className="flex justify-between text-[#CBD5E1]">
              <span>Gradient Matrix Angle</span>
              <span className="ss-num text-[#A5B4FC]">{backdropParams?.gradientAngle ?? 135}°</span>
            </div>
            <StudioSlider
              min={0}
              max={360}
              step={5}
              value={backdropParams?.gradientAngle ?? 135}
              onChange={(v) => onChangeBackdropParams?.({ gradientAngle: v })}
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
            className="ss-btn ss-btn-secondary w-full mt-1 py-1.5 px-2 text-[10px]"
          >
            <RotateCcw className="w-3 h-3 text-[#818CF8]" strokeWidth={1.75} />
            Reset Backdrop to Studio Defaults
          </button>
        </div>
      </div>

      {/* Window Corner Radius Slider */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5 text-[#CBD5E1]">
          <span>Window Corner Radius</span>
          <span className="ss-num text-[#818CF8]">{currentPreset.borderRadius}px</span>
        </div>
        <StudioSlider
          min={0}
          max={36}
          value={currentPreset.borderRadius}
          onChange={(v) => onUpdatePresetBorderRadius(v)}
        />
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-xs mb-1.5 text-[#CBD5E1]">
          <span>Frame Shadow</span>
          <span className="ss-num text-[#818CF8] capitalize">{shadowMode}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['none', 'subtle', 'studio'] as ShadowMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChangeShadowMode(mode)}
              className={`p-1.5 rounded-lg text-[11px] border capitalize ${shadowMode === mode ? 'ss-chip ss-chip-active text-studio-text' : 'ss-chip'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Frame Padding Slider (0% - 20%, default 8%) */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5 text-[#CBD5E1]">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
            Frame Padding
          </span>
          <span className="ss-num text-[#818CF8]">{Math.round((framePadding ?? 0.08) * 100)}%</span>
        </div>
        <StudioSlider
          min={0}
          max={20}
          value={Math.round((framePadding ?? 0.08) * 100)}
          onChange={(v) => onChangeFramePadding?.(v / 100)}
        />
      </div>

      {/* Custom Background: wallpapers, gradients, solid colors and images (drop an image anywhere here) */}
      <div
        className={`pt-2 border-t border-studio-border space-y-2 rounded-lg transition-colors ${
          isDraggingFile ? 'outline outline-2 outline-dashed outline-[#A855F7]/70 bg-[#A855F7]/10' : ''
        }`}
        onDragEnter={handleBackgroundDragEnter}
        onDragOver={handleBackgroundDragOver}
        onDragLeave={handleBackgroundDragLeave}
        onDrop={handleBackgroundDrop}
      >
        {isDraggingFile && (
          <div className="text-center text-[11px] text-[#E9D5FF] py-1">Drop the image to use it as the background</div>
        )}
        <div className="flex items-center justify-between ss-section-title">
          <span className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-[#A855F7]" strokeWidth={1.75} />
            Background
          </span>
          {hasCustomBackground && (
            <button
              type="button"
              onClick={handleResetBackground}
              className="text-[10px] text-[#FB7185] hover:text-[#FDA4AF] flex items-center gap-1 transition-colors"
              title="Back to the preset's animated backdrop"
            >
              <RotateCcw className="w-2.5 h-2.5" strokeWidth={1.75} />
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
                backgroundTab === id ? 'ss-chip ss-chip-active text-studio-text font-medium' : 'ss-chip'
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
                    selected ? 'border-white ring-1 ring-white/60' : 'border-studio-border hover:border-white/40'
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
                    className={`h-9 rounded-lg border transition-all ${selected ? 'border-white ring-1 ring-white/60' : 'border-studio-border hover:border-white/40'}`}
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
                  className="w-6 h-6 rounded-full border border-white/20 text-[#CBD5E1] text-xs hover:bg-studio-cardHover"
                  title="Add a color"
                >
                  +
                </button>
              )}
              {gradientColors.length > 2 && (
                <button
                  type="button"
                  onClick={() => editGradient({ colors: gradientColors.slice(0, -1) })}
                  className="w-6 h-6 rounded-full border border-white/20 text-[#CBD5E1] text-xs hover:bg-studio-cardHover"
                  title="Remove the last color"
                >
                  −
                </button>
              )}
              <div className="ml-auto flex rounded-lg border border-studio-border overflow-hidden text-[10px]">
                {(['linear', 'radial'] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    onClick={() => editGradient({ shape })}
                    className={`px-2 py-1 ${gradientShape === shape ? 'bg-white/15 text-studio-text' : 'text-studio-muted hover:text-studio-text'}`}
                  >
                    {shape === 'linear' ? 'Linear' : 'Radial'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-studio-muted">
                <span>Angle</span>
                <span className="ss-num text-[#C084FC]">{Math.round(gradientAngle)}°</span>
              </div>
              <StudioSlider
                min={0}
                max={360}
                step={5}
                value={gradientAngle}
                disabled={gradientShape === 'radial'}
                onChange={(v) => editGradient({ angle: v })}
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
          <div className="pt-1 space-y-2">
            <label className="w-full py-1.5 px-2.5 bg-studio-card hover:bg-studio-cardHover border border-studio-border rounded-lg text-xs text-[#CBD5E1] cursor-pointer flex items-center justify-center gap-2 transition-colors">
              <Upload className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
              <span>{backgroundImageUrl ? 'Replace image' : 'Browse for an image'}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
            <p className="text-[10px] text-studio-meta text-center">…or drop an image on this panel, or paste one (Ctrl+V).</p>
            {recentUploads.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-studio-meta">Recent</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {recentUploads.map((u) => {
                    const selected = background.kind === 'image' && background.uploadId === u.id;
                    return (
                      <div key={u.id} className="relative group">
                        <button
                          type="button"
                          onClick={() => onSelectRecentUpload?.(u.id)}
                          className={`block w-full aspect-video rounded-md overflow-hidden border transition-all ${
                            selected ? 'border-white ring-1 ring-white/60' : 'border-studio-border hover:border-white/40'
                          }`}
                          title={u.name}
                          aria-label={`Use ${u.name}`}
                          aria-pressed={selected}
                        >
                          <img src={u.url} alt="" className="w-full h-full object-cover" draggable={false} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteRecentUpload?.(u.id)}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 border border-white/20 text-[10px] leading-none text-[#CBD5E1] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#FDA4AF]"
                          title={`Remove ${u.name}`}
                          aria-label={`Remove ${u.name}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {(background.kind === 'wallpaper' || background.kind === 'image') && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-studio-muted">
                <span>Blur</span>
                <span className="ss-num text-[#C084FC]">{Math.round(backgroundEffects.blur)}%</span>
              </div>
              <StudioSlider
                min={0}
                max={100}
                step={1}
                value={backgroundEffects.blur}
                onChange={(v) => onChangeBackgroundEffects?.({ blur: v })}
                aria-label="Background blur"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-studio-muted">
                <span>Dim</span>
                <span className="ss-num text-[#C084FC]">{Math.round(backgroundEffects.dim)}%</span>
              </div>
              <StudioSlider
                min={0}
                max={100}
                step={1}
                value={backgroundEffects.dim}
                onChange={(v) => onChangeBackgroundEffects?.({ dim: v })}
                aria-label="Background dim"
              />
            </div>
          </div>
        )}

        {(background.kind === 'wallpaper' || background.kind === 'gradient' || background.kind === 'image') && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[11px] text-studio-muted">
              <span>Motion</span>
              <span className="ss-num text-[#C084FC]">
                {backgroundEffects.motion <= 0
                  ? 'Still'
                  : backgroundEffects.motion < 35
                    ? 'Calm'
                    : backgroundEffects.motion < 70
                      ? 'Flowing'
                      : 'Lively'}
              </span>
            </div>
            <StudioSlider
              min={0}
              max={100}
              step={1}
              value={backgroundEffects.motion}
              onChange={(v) => onChangeBackgroundEffects?.({ motion: v })}
              aria-label="Background motion"
            />
            <p className="text-[10px] text-studio-meta">
              {background.kind === 'image'
                ? 'A slow push-in and pan across your image.'
                : background.kind === 'gradient'
                  ? 'The gradient slowly sways.'
                  : 'The light drifts and flows, looping seamlessly.'}{' '}
              Plays with the video; GIFs keep it still to stay small.
            </p>
          </div>
        )}
      </div>

      {/* Cursor Theme & Scale Customizer */}
      <div className="pt-2 border-t border-studio-border space-y-3">
        <div className="flex items-center justify-between ss-section-title">
          <span className="flex items-center gap-1.5">
            <MousePointer className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
            Vector Cursor Styling
          </span>
          <span className="ss-num text-[#818CF8] text-[11px]">{cursorScale.toFixed(1)}x</span>
        </div>

        {/* Theme pills */}
        <div className="grid grid-cols-3 gap-1 text-[11px]">
          <button
            onClick={() => onChangeCursorTheme('mac-obsidian')}
            className={`p-1.5 rounded-lg border text-center transition-colors ${
              cursorTheme === 'mac-obsidian'
                ? 'ss-chip ss-chip-active text-studio-text font-medium'
                : 'ss-chip'
            }`}
          >
            Obsidian
          </button>
          <button
            onClick={() => onChangeCursorTheme('neon-glow')}
            className={`p-1.5 rounded-lg border text-center transition-colors ${
              cursorTheme === 'neon-glow'
                ? 'ss-chip ss-chip-active text-studio-text font-medium'
                : 'ss-chip'
            }`}
          >
            Neon Glow
          </button>
          <button
            onClick={() => onChangeCursorTheme('minimal-white')}
            className={`p-1.5 rounded-lg border text-center transition-colors ${
              cursorTheme === 'minimal-white'
                ? 'ss-chip ss-chip-active text-studio-text font-medium'
                : 'ss-chip'
            }`}
          >
            Clean White
          </button>
        </div>

        {/* Cursor Scale Slider */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-studio-muted">
            <span>Pointer Size</span>
          </div>
          <StudioSlider
            min={0.8}
            max={2.0}
            step={0.1}
            value={cursorScale}
            onChange={(v) => onChangeCursorScale(v)}
          />
        </div>
        <div className="space-y-1">
          <label className="flex justify-between items-center text-[11px] text-studio-muted">
            <span>Cursor engine</span>
            <select
              value={cursorEngineKind}
              onChange={(e) => onChangeCursorEngine(e.target.value === 'solve' ? 'solve' : 'spline')}
              className="bg-transparent border border-studio-border rounded px-1 py-0.5 text-[11px] text-[#A5B4FC]"
              aria-label="Cursor engine"
            >
              <option value="solve">Solve (default)</option>
              <option value="spline">Spline (classic)</option>
            </select>
          </label>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-studio-muted">
            <span>Cursor Smoothing</span>
            <span className="text-[#A5B4FC]">{cursorSmoothing < 0.34 ? 'Crisp' : cursorSmoothing < 0.75 ? 'Smooth' : 'Cinematic'}</span>
          </div>
          <StudioSlider
            min={0}
            max={1}
            step={0.05}
            value={cursorSmoothing}
            onChange={(v) => onChangeCursorSmoothing(v)}
            aria-label="Cursor Smoothing"
          />
        </div>

        {/* Cursor motion: sway spring, tilt, click press, hide when idle */}
        <div className="space-y-1">
          {!showCursor && (
            <p className="text-[10px] leading-snug text-studio-meta">
              Requires Vector Cursor (auto-enabled on Chrome Tab captures).
            </p>
          )}
          <div className="flex justify-between text-[11px] text-studio-muted">
            <span>Sway</span>
            <span className="text-[#A5B4FC]">{cursorEngineKind === 'solve' ? 'No effect with Solve' : `${cursorMotion.sway < 34 ? 'Tight' : cursorMotion.sway < 67 ? 'Natural' : 'Languid'} · ${Math.round(cursorMotion.sway)}`}</span>
          </div>
          <StudioSlider
            min={0}
            max={100}
            step={1}
            value={cursorMotion.sway}
            disabled={cursorEngineKind === 'solve'}
            onChange={(v) => onChangeCursorMotion({ sway: v })}
            aria-label="Cursor Sway"
          />
        </div>
        <div className={`space-y-1${!showCursor ? ' opacity-50' : ''}`}>
          <label className="flex justify-between items-center text-[11px] text-studio-muted">
            <span>Tilt with speed</span>
            <input type="checkbox" checked={cursorMotion.tiltEnabled} onChange={(e) => onChangeCursorMotion({ tiltEnabled: e.target.checked })} />
          </label>
          <div className="flex justify-between text-[11px] text-studio-meta">
            <span>Max angle</span>
            <span>{Math.round(cursorMotion.maxTiltDeg)}°</span>
          </div>
          <StudioSlider
            min={2}
            max={30}
            step={1}
            value={cursorMotion.maxTiltDeg}
            disabled={!cursorMotion.tiltEnabled}
            onChange={(v) => onChangeCursorMotion({ maxTiltDeg: v })}
            aria-label="Cursor Max Tilt"
          />
        </div>
        <div className={`space-y-1${!showCursor ? ' opacity-50' : ''}`}>
          <label className="flex justify-between items-center text-[11px] text-studio-muted">
            <span>Click press</span>
            <input type="checkbox" checked={cursorMotion.pressEnabled} onChange={(e) => onChangeCursorMotion({ pressEnabled: e.target.checked })} />
          </label>
          <div className="flex justify-between text-[11px] text-studio-meta">
            <span>Depth</span>
            <span>{Math.round(cursorMotion.pressDepth * 100)}%</span>
          </div>
          <StudioSlider
            min={0.05}
            max={0.40}
            step={0.01}
            value={cursorMotion.pressDepth}
            disabled={!cursorMotion.pressEnabled}
            onChange={(v) => onChangeCursorMotion({ pressDepth: v })}
            aria-label="Cursor Press Depth"
          />
        </div>

        {/* Click Effect Style — inside the Cursor settings, alongside the Click Press toggle/depth */}
        <div className={`space-y-1${!ripplesActive ? ' opacity-50' : ''}`}>
          <div className="flex justify-between text-[11px] text-studio-muted">
            <span>Click Effect</span>
            <span className="text-[#A5B4FC]">
              {clickEffectStyle === 'double-ring' ? 'Double' : clickEffectStyle === 'halo' ? 'Halo' : clickEffectStyle === 'none' ? 'None' : 'Ring'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            {(['ring', 'double-ring', 'halo', 'none'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => onChangeClickEffectStyle(style)}
                className={`p-1.5 rounded-lg border text-center transition-colors ${
                  clickEffectStyle === style
                    ? 'ss-chip ss-chip-active text-studio-text font-medium'
                    : 'ss-chip'
                }`}
                title={
                  style === 'ring'
                    ? 'Studio Ring (default): crisp expanding ring + soft-core flash'
                    : style === 'double-ring'
                      ? 'Sonar: primary ring + staggered echo for high-visibility tutorials'
                      : style === 'halo'
                        ? 'Soft Pulse: translucent radial bloom, no hard stroke'
                        : 'Squish Only: no ring or halo, just the 2.5D press'
                }
              >
                {style === 'double-ring' ? 'Double' : style === 'halo' ? 'Halo' : style === 'none' ? 'None' : 'Ring'}
              </button>
            ))}
          </div>
        </div>

        {/* Click Accent Color */}
        <div className={`space-y-1${!ripplesActive ? ' opacity-50' : ''}`}>
          <div className="flex justify-between text-[11px] text-studio-muted">
            <span>Click Accent Color</span>
            <span className="text-[#A5B4FC]">{clickColor === 'auto' ? 'Auto' : clickColor}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeClickColor('auto')}
              className={`px-2 py-1 rounded-lg border text-[10px] transition-colors ${
                clickColor === 'auto'
                  ? 'ss-chip ss-chip-active text-studio-text font-medium'
                  : 'ss-chip'
              }`}
            >
              Auto
            </button>
            {STUDIO_CLICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChangeClickColor(c)}
                className={`w-5 h-5 rounded-full border transition-all ${
                  clickColor === c ? 'border-white scale-110 shadow-sm shadow-white/50' : 'border-white/20 hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>
        <div className={`space-y-1${!showCursor ? ' opacity-50' : ''}`}>
          <label className="flex justify-between items-center text-[11px] text-studio-muted">
            <span>Hide when idle</span>
            <input
              type="checkbox"
              checked={cursorMotion.hideWhenIdle}
              disabled={!showCursor}
              onChange={(e) => onChangeCursorMotion({ hideWhenIdle: e.target.checked })}
              className="ss-checkbox disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </label>
          <div className="flex justify-between text-[11px] text-studio-meta">
            <span>After</span>
            <span>{(cursorMotion.idleDelayMs / 1000).toFixed(1)} s still</span>
          </div>
          <StudioSlider
            min={500}
            max={5000}
            step={100}
            value={cursorMotion.idleDelayMs}
            disabled={!showCursor || !cursorMotion.hideWhenIdle}
            onChange={(v) => onChangeCursorMotion({ idleDelayMs: v })}
            aria-label="Cursor Idle Delay"
          />
        </div>
      </div>

      {/* TikTok / Reels Auto-Captions */}
      <div className="pt-2 border-t border-studio-border space-y-2.5">
        <div className="flex items-center justify-between ss-section-title">
          <span className="flex items-center gap-1.5">
            <Subtitles className="w-3.5 h-3.5 text-[#FBBF24]" strokeWidth={1.75} />
            Viral Auto-Captions
          </span>
          <input
            type="checkbox"
            checked={showCaptions}
            onChange={(e) => onToggleCaptions(e.target.checked)}
            className="ss-checkbox"
          />
        </div>

        {showCaptions && (
          <>
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <button
              onClick={() => onChangeCaptionStyle('tiktok-bold')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'tiktok-bold'
                  ? 'bg-[#FBBF24]/25 border-amber-500 text-[#FDE68A] font-medium'
                  : 'ss-chip'
              }`}
            >
              TikTok Bold (Yellow)
            </button>
            <button
              onClick={() => onChangeCaptionStyle('apple-keynote')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'apple-keynote'
                  ? 'bg-[#38BDF8]/18 border-[#38BDF8] text-[#BAE6FD] font-medium'
                  : 'ss-chip'
              }`}
            >
              Apple Keynote (Glass)
            </button>
            <button
              onClick={() => onChangeCaptionStyle('minimal-pill')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'minimal-pill'
                  ? 'ss-chip ss-chip-active text-studio-text font-medium'
                  : 'ss-chip'
              }`}
            >
              Minimal Pill
            </button>
            <button
              onClick={() => onChangeCaptionStyle('classic-sub')}
              className={`p-1.5 rounded-lg border text-center transition-colors ${
                captionStyle === 'classic-sub'
                  ? 'ss-chip ss-chip-active text-studio-text font-medium'
                  : 'ss-chip'
              }`}
            >
              Classic Sub
            </button>
          </div>

          <div className="pt-1 space-y-1">
            {/* Caption Backdrop Opacity / Blur */}
            <div className="flex items-center justify-between text-[10px] text-studio-muted">
              <span>Backdrop Opacity / Blur</span>
              <span className="ss-num text-[#FCD34D]">{captionBackdrop}%</span>
            </div>
            <StudioSlider
              min={0}
              max={100}
              step={5}
              value={captionBackdrop}
              onChange={(v) => onChangeCaptionBackdrop(v)}
              title="Caption pill backdrop blur and opacity"
            />
          </div>
          </>
        )}
      </div>

      {/* Visual & Sound Superpowers Toggles */}
      <div className="pt-2 border-t border-studio-border space-y-2.5">
        <label className="ss-section-title block">
          Visual & Audio Effects
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span>Spotlight Dimming Mode</span>
          <input
            type="checkbox"
            checked={showSpotlight}
            onChange={(e) => onToggleSpotlight(e.target.checked)}
            className="ss-checkbox"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span>Vector 4K Cursor & Blur</span>
          <input
            id="vector-cursor-checkbox"
            type="checkbox"
            checked={showCursor}
            onChange={(e) => onToggleCursor(e.target.checked)}
            className="ss-checkbox"
            title={capturedNativeCursor === 'always' ? 'The native cursor was captured; enabling this may show both cursors.' : undefined}
          />
        </label>

        {capturedNativeCursor === 'always' && (
          <p className="text-[11px] leading-relaxed text-[#FCD34D]/90">
            The native cursor was captured in this recording. The vector cursor starts off to prevent a double cursor; you can re-enable it manually.
          </p>
        )}
        {capturedNativeCursor === 'motion' && metadata?.displaySurface !== 'window' && metadata?.displaySurface !== 'monitor' && showCursor && (
          <p id="cursor-motion-note" className="text-[11px] leading-relaxed text-studio-muted">
            Chrome may draw its own cursor while the mouse moves. If you see two cursors in the preview, switch the vector cursor off.
          </p>
        )}

        {(metadata?.displaySurface === 'window' || metadata?.displaySurface === 'monitor') && (
          <div id="cursor-mode-hint" className="p-2.5 rounded-lg bg-[#6366F1]/10 border border-[#818CF8]/25 text-[11px] text-[#C7D2FE] flex items-start gap-2 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-[#818CF8] shrink-0 mt-0.5" strokeWidth={1.75} />
            <span>
              {metadata?.coordinateSpace === 'capture'
                ? 'Window/monitor capture keeps the native cursor, so the vector cursor and its 2.5D press squish stay off to avoid a double cursor. Auto-Zoom and Click Ripples remain active on the placed click points. Share a Chrome Tab for the full smooth vector cursor and press squish.'
                : 'Window/monitor capture keeps the native cursor. Record a Chrome Tab (or the screen the Chrome window is on) for vector cursor tracking, and add zooms manually if the clicks could not be placed.'}
            </span>
          </div>
        )}

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span>3D Keystroke HUD (Cmd+K)</span>
          <input
            type="checkbox"
            checked={showHud}
            onChange={(e) => onToggleHud(e.target.checked)}
            className="ss-checkbox"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span>Camera Dynamic Follow (Cursor)</span>
          <input
            type="checkbox"
            checked={followCursor}
            onChange={(e) => onToggleFollowCursor(e.target.checked)}
            className="ss-checkbox"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
            Procedural Sound Effects
          </span>
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(e) => onToggleSound(e.target.checked)}
            className="ss-checkbox"
          />
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span className="flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-[#FBBF24]" strokeWidth={1.75} />
            Auto-Cut Silences (&gt;1.2s)
          </span>
          <input
            id="autocut-silences-checkbox"
            type="checkbox"
            checked={!!autoCutSilences}
            onChange={(e) => onToggleAutoCutSilences?.(e.target.checked)}
            className="ss-checkbox"
          />
        </label>
      </div>

      {/* Built-In Intro Title Hook Cards */}
      <div className="pt-2 border-t border-studio-border space-y-2.5">
        <label className="ss-section-title flex items-center justify-between">
          <span>Intro Title Hook Card</span>
          <span className="text-[10px] text-[#818CF8] ss-num">1.5s 3D Zoom</span>
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span>Enable Intro Title Card</span>
          <input
            type="checkbox"
            checked={!!showIntroCard}
            onChange={(e) => onToggleIntroCard?.(e.target.checked)}
            className="ss-checkbox"
          />
        </label>

        {showIntroCard && (
          <div className="space-y-2.5 pt-1">
            <div>
              <span className="text-[10px] text-studio-muted uppercase font-medium block mb-1">Headline</span>
              <input
                type="text"
                value={introHeadline || ''}
                onChange={(e) => onChangeIntroHeadline?.(e.target.value)}
                placeholder="Headline text"
                className="ss-input w-full px-2.5 py-1.5 text-xs text-studio-text placeholder:text-studio-meta"
              />
            </div>

            <div>
              <span className="text-[10px] text-studio-muted uppercase font-medium block mb-1">Subheadline</span>
              <input
                type="text"
                value={introSubheadline || ''}
                onChange={(e) => onChangeIntroSubheadline?.(e.target.value)}
                placeholder="Subheadline text"
                className="ss-input w-full px-2.5 py-1.5 text-xs placeholder:text-studio-meta"
              />
            </div>

            <p className="text-[10px] text-studio-muted leading-tight">
              Animate hook title over brand mesh gradient before 3D spring zoom into recording.
            </p>
          </div>
        )}
      </div>

      {/* Built-In Outro CTA Title Hook Cards */}
      <div className="pt-2 border-t border-studio-border space-y-2.5">
        <label className="ss-section-title flex items-center justify-between">
          <span>Outro CTA Card</span>
          <span className="text-[10px] text-[#A855F7] ss-num">Final 1.5s 3D Zoom</span>
        </label>

        <label className="flex items-center justify-between text-xs text-[#CBD5E1] hover:text-studio-text cursor-pointer">
          <span>Enable Outro CTA Card</span>
          <input
            type="checkbox"
            checked={!!showOutroCard}
            onChange={(e) => onToggleOutroCard?.(e.target.checked)}
            className="ss-checkbox"
          />
        </label>

        {showOutroCard && (
          <div className="space-y-2.5 pt-1">
            <div>
              <span className="text-[10px] text-studio-muted uppercase font-medium block mb-1">Outro Headline</span>
              <input
                type="text"
                value={outroHeadline || ''}
                onChange={(e) => onChangeOutroHeadline?.(e.target.value)}
                placeholder="Outro headline text"
                className="ss-input w-full px-2.5 py-1.5 text-xs text-studio-text placeholder:text-studio-meta"
              />
            </div>

            <div>
              <span className="text-[10px] text-studio-muted uppercase font-medium block mb-1">Outro CTA Badge / URL</span>
              <input
                type="text"
                value={outroCtaText || ''}
                onChange={(e) => onChangeOutroCtaText?.(e.target.value)}
                placeholder="Outro CTA text"
                className="ss-input w-full px-2.5 py-1.5 text-xs placeholder:text-studio-meta"
              />
            </div>

            <p className="text-[10px] text-studio-muted leading-tight">
              Final 1.5s: recording zooms out in 3D while the CTA card and glowing button animate in.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

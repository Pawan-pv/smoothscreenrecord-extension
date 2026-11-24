import React, { useState, useEffect, useRef, useCallback, useReducer, useMemo } from 'react';
import {
  TelemetryData,
  ZoomPill,
  SilenceSegment,
  AspectRatioType,
  VibePreset,
  CaptionBlock,
  CaptionWord,
  CaptionStyle,
  CursorTheme,
  CapturedNativeCursor,
  FramingMode,
  ShadowMode,
  BackdropMatrixParams,
  BackgroundSpec,
  BackgroundEffects,
  BackgroundLayer,
  DEFAULT_BACKGROUND_EFFECTS
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { generateAutoZoomPills, resolveSourcePixelWidth, AUTO_ZOOM_DEFAULT_DEPTH, AUTO_ZOOM_CONFIG } from '../engine/spring-physics';
import { toCaptureSpace, captureSpaceProblem } from '../engine/capture-space';
import { untrackablePage } from '../engine/restricted-pages';
import { prepareVideo, studioLoadReducer, LoadStep, LOAD_STEPS } from './studio-load';
import { nextRecordingPhase, RecordingPhase, RecordingEvent, ExportJob } from './studio-session';
import { CursorSplineEngine, CursorMotionSettings, DEFAULT_CURSOR_MOTION } from '../engine/cursor-spline';
import {
  loadBackgroundChoice,
  saveBackgroundChoice,
  addUpload,
  getUpload,
  listUploads,
  deleteUpload
} from './background-store';
import { AudioProcessor } from '../engine/audio-processor';
import { SfxSynthesizer } from '../engine/sfx-synthesizer';
import { HardwareMp4Exporter, ExportEncoderInfo } from '../engine/mp4-exporter';
import { describeMp4Export } from '../engine/export-report';
import { loadPrivacyPrefs } from '../engine/privacy-prefs';
import { resolveEditorShortcut } from './keyboard-shortcuts';
import { HardwareGifExporter, GIF_QUALITY_PRESETS, GifQualityPreset } from '../engine/gif-exporter';
import { SopGuideExporter } from '../engine/sop-guide-exporter';
import { HtmlWidgetExporter } from '../engine/html-widget-exporter';
import { scheduleObjectUrlRevoke, isExportAbortError } from '../engine/export-safety';
import {
  getRecordingBlob, loadTelemetry, saveTelemetry, setUseOpfs, newSessionId, getFinalSessionId,
  recoverInterruptedSession, isSessionLockHeld
} from '../engine/opfs-storage';
import { patchWebmBlobDuration } from '../engine/webm-fixer';
import { ScreenCaptureEngine, shouldEnableCustomCursor } from '../engine/screen-recorder';
import { diagnosticChannel, SystemDegradationEvent } from '../engine/diagnostic-channel';
import { CanvasPreview } from './CanvasPreview';
import { MagneticTimeline } from './MagneticTimeline';
import { VibePresetsPanel } from './VibePresetsPanel';
import { DiagnosticsDoctor } from './DiagnosticsDoctor';
import { DegradationTriagePanel } from './DegradationTriagePanel';
import { ToastContainer, ToastItem } from './ToastNotification';
import {
  Video,
  Download,
  FileText,
  MousePointerClick,
  Sparkles,
  CircleDot,
  Loader2,
  CheckCircle2,
  Play,
  Pause,
  Activity,
  AlertTriangle,
  HardDrive,
  Cpu,
  XCircle
} from 'lucide-react';

/**
 * Tags telemetry with its recording session (M1-08). Without telemetry an
 * EMPTY record is returned: no click, key or mouse point is ever invented.
 */
function withSession(tel: TelemetryData | null, sessionId: string, durationMs: number, displaySurface?: string, capturedNativeCursor?: CapturedNativeCursor): TelemetryData {
  const now = Date.now();
  const base: TelemetryData = tel || {
    metadata: {
      id: sessionId,
      startTime: now - durationMs,
      endTime: now,
      durationMs,
      width: typeof window !== 'undefined' ? window.innerWidth : 1920,
      height: typeof window !== 'undefined' ? window.innerHeight : 1080,
      devicePixelRatio: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      title: 'Screen Recording'
    },
    mousePoints: [],
    clicks: [],
    keystrokes: [],
    inputEvents: []
  };
  return {
    ...base,
    metadata: {
      ...base.metadata,
      id: sessionId,
      sessionId,
      ...(displaySurface ? { displaySurface } : {}),
      ...(capturedNativeCursor ? { capturedNativeCursor } : {})
    }
  };
}

export interface AutoZoomSettings {
  enabled: boolean;
  /** Depth of every auto zoom. */
  depth: number;
  /** Camera speed of auto zooms (ms). */
  speedMs: number;
}

const AUTO_ZOOM_SETTINGS_KEY = 'smoothstudio.autoZoom';
const AUTO_ZOOM_SETTINGS_VERSION = 2;

function loadAutoZoomSettings(): AutoZoomSettings {
  const defaults: AutoZoomSettings = { enabled: true, depth: AUTO_ZOOM_DEFAULT_DEPTH, speedMs: AUTO_ZOOM_CONFIG.LEAD_IN_MS };
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_ZOOM_SETTINGS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    // Settings saved before v2 hold the old default speeds (600 / 400 ms): they become the new 200 ms default.
    const oldDefault = saved.v !== AUTO_ZOOM_SETTINGS_VERSION && (saved.speedMs === 600 || saved.speedMs === 400);
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
      depth: Number.isFinite(saved.depth) && saved.depth > 1 ? saved.depth : defaults.depth,
      speedMs: !oldDefault && Number.isFinite(saved.speedMs) && saved.speedMs > 0 ? saved.speedMs : defaults.speedMs
    };
  } catch {
    return defaults;
  }
}

/**
 * Page clicks line up with a browser-tab recording directly, and with a window /
 * screen recording once they were moved onto its frame (toCaptureSpace).
 */
function canAutoZoom(tel: TelemetryData): boolean {
  const surface = tel.metadata?.displaySurface;
  return (surface !== 'window' && surface !== 'monitor') || tel.metadata?.coordinateSpace === 'capture';
}

function buildAutoZoomPills(tel: TelemetryData, durationMs: number, settings: AutoZoomSettings): ZoomPill[] {
  if (!settings.enabled || !canAutoZoom(tel)) return [];
  return generateAutoZoomPills(
    tel.clicks || [],
    durationMs,
    tel.metadata?.width || 1920,
    tel.metadata?.height || 1080,
    { depth: settings.depth, transitionMs: settings.speedMs }
  );
}

export function EditorStudio() {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const latestTelemetryRef = useRef<TelemetryData | null>(null);
  /** Session id of the recording being made right now (M1-08). */
  const activeSessionIdRef = useRef<string | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | HTMLCanvasElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  /** Loading state machine (studio-load.ts): the studio is usable only when `ready`. */
  const [load, dispatchLoad] = useReducer(studioLoadReducer, { phase: 'empty' });
  /** Id of the newest load: events of older loads are ignored. */
  const loadIdRef = useRef(0);
  const isStudioReady = load.phase === 'ready';
  const [autoZoomSettings, setAutoZoomSettingsState] = useState<AutoZoomSettings>(loadAutoZoomSettings);
  /** Read by setupLoadedRecording, which can run from an older render. */
  const autoZoomSettingsRef = useRef<AutoZoomSettings>(autoZoomSettings);
  const setAutoZoomSettings = (settings: AutoZoomSettings) => {
    autoZoomSettingsRef.current = settings;
    setAutoZoomSettingsState(settings);
    try { localStorage.setItem(AUTO_ZOOM_SETTINGS_KEY, JSON.stringify({ ...settings, v: AUTO_ZOOM_SETTINGS_VERSION })); } catch { /* storage unavailable */ }
  };
  const [durationMs, setDurationMs] = useState<number>(10000);
  const [trimStartMs, setTrimStartMs] = useState<number>(0);
  const [trimEndMs, setTrimEndMs] = useState<number>(0);
  /** Real container duration of the loaded recording (before the UI override). */
  const mediaDurationRef = useRef<number | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [showDoctor, setShowDoctor] = useState<boolean>(false);
  const [activeDegradation, setActiveDegradation] = useState<SystemDegradationEvent | null>(null);
  const [storageMode, setStorageMode] = useState<'opfs' | 'ram'>(diagnosticChannel.getStorageMode());
  const [encoderStreamMode, setEncoderStreamMode] = useState<'hardware-mp4' | 'client-webm'>(diagnosticChannel.getEncoderStreamMode());
  const [exportResPreset, setExportResPreset] = useState<'source' | '1080p' | '4k' | '720p'>('source');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [micWarning, setMicWarning] = useState<string | null>(null);

  const showToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Settings & Timeline state
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('16:9');
  const [framingMode, setFramingMode] = useState<FramingMode>('fit');
  const [shadowMode, setShadowMode] = useState<ShadowMode>('studio');
  const [preset, setPreset] = useState<VibePreset>(VIBE_PRESETS['keynote-pro'] || VIBE_PRESETS['linear-dark']);
  const [backdropParams, setBackdropParams] = useState<BackdropMatrixParams>(
    VIBE_PRESETS['keynote-pro']?.backdrop || {
      presetType: 'keynote-pro',
      vignetteStrength: 75,
      illumination: 85,
      flowSpeed: 40,
      gridIntensity: 0,
      gradientAngle: 180
    }
  );
  const [pills, setPills] = useState<ZoomPill[]>([]);
  const [selectedPillId, setSelectedPillId] = useState<string | null>(null);
  const [silences, setSilences] = useState<SilenceSegment[]>([]);
  const [autoCutSilences, setAutoCutSilences] = useState<boolean>(false);
  const [showSpotlight, setShowSpotlight] = useState<boolean>(true);
  const [showCursor, setShowCursor] = useState<boolean>(true);
  const [showHud, setShowHud] = useState<boolean>(true);
  const [showIntroCard, setShowIntroCard] = useState<boolean>(false);
  const [introHeadline, setIntroHeadline] = useState<string>('');
  const [introSubheadline, setIntroSubheadline] = useState<string>('');
  const [showOutroCard, setShowOutroCard] = useState<boolean>(false);
  const [outroHeadline, setOutroHeadline] = useState<string>('');
  const [outroCtaText, setOutroCtaText] = useState<string>('');
  const [framePadding, setFramePadding] = useState<number>(0.08);
  /** What fills the canvas behind the window (one source of truth for preview and exports). */
  // The last background is remembered (background-store.ts). An image needs its stored
  // file decoded first: it starts as the backdrop and is restored on mount.
  const [savedBackground] = useState(() => loadBackgroundChoice());
  const [backgroundSpec, setBackgroundSpec] = useState<BackgroundSpec>(
    savedBackground.spec.kind === 'image' ? { kind: 'backdrop' } : savedBackground.spec
  );
  const [backgroundEffects, setBackgroundEffects] = useState<BackgroundEffects>(savedBackground.effects ?? DEFAULT_BACKGROUND_EFFECTS);
  /** True while the remembered image is being restored: nothing is saved over it meanwhile. */
  const restoringBackgroundRef = useRef(savedBackground.spec.kind === 'image');
  const [recentUploads, setRecentUploads] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const recentUploadUrlsRef = useRef<string[]>([]);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const backgroundImageUrlRef = useRef<string | null>(null);
  const backgroundColor = backgroundSpec.kind === 'solid' ? backgroundSpec.color : null;
  const background = useMemo<BackgroundLayer>(
    () => ({ spec: backgroundSpec, effects: backgroundEffects, image: backgroundSpec.kind === 'image' ? backgroundImage : null }),
    [backgroundSpec, backgroundEffects, backgroundImage]
  );

  useEffect(() => {
    return () => {
      const url = backgroundImageUrlRef.current;
      if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const clearBackgroundImage = useCallback(() => {
    const currentUrl = backgroundImageUrlRef.current;
    backgroundImageUrlRef.current = null;
    setBackgroundImageUrl(null);
    setBackgroundImage(null);
    if (currentUrl?.startsWith('blob:')) URL.revokeObjectURL(currentUrl);
  }, []);

  const handleSelectBackgroundImage = useCallback((url: string | null, image: HTMLImageElement | null, uploadId = 'session') => {
    if (!url || !image) {
      clearBackgroundImage();
      setBackgroundSpec({ kind: 'backdrop' });
      return;
    }
    const previousUrl = backgroundImageUrlRef.current;
    backgroundImageUrlRef.current = url;
    setBackgroundImageUrl(url);
    setBackgroundImage(image);
    setBackgroundSpec({ kind: 'image', uploadId });
    if (previousUrl && previousUrl !== url && previousUrl.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
  }, [clearBackgroundImage]);

  /** Any non-image background: a solid color, a gradient, a wallpaper or the preset backdrop. */
  const handleChangeBackground = useCallback((spec: BackgroundSpec) => {
    restoringBackgroundRef.current = false; // the user's choice wins over a restore still loading
    if (spec.kind !== 'image') clearBackgroundImage();
    setBackgroundSpec(spec);
  }, [clearBackgroundImage]);

  const handleBackgroundImageError = useCallback((url: string) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    showToast({ type: 'error', title: 'Background Image Failed', message: 'The image could not be loaded; the previous background was kept.' });
  }, [showToast]);

  const handleSelectBackgroundColor = useCallback((color: string | null) => {
    handleChangeBackground(color ? { kind: 'solid', color } : { kind: 'backdrop' });
  }, [handleChangeBackground]);

  /** Decodes an image blob into an <img> behind a fresh object URL (the caller owns the URL). */
  const decodeImageBlob = (blob: Blob) => new Promise<{ url: string; image: HTMLImageElement }>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ url, image });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be read.'));
    };
    image.src = url;
  });

  const refreshRecentUploads = useCallback(async () => {
    try {
      const uploads = await listUploads();
      recentUploadUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      const next = uploads.map((u) => ({ id: u.id, name: u.name, url: URL.createObjectURL(u.blob) }));
      recentUploadUrlsRef.current = next.map((u) => u.url);
      setRecentUploads(next);
    } catch {
      // Storage unavailable: no recent uploads to show.
    }
  }, []);

  /** Picker, drag-drop and paste all end here. */
  const handleUploadBackgroundFile = useCallback(async (file: File) => {
    restoringBackgroundRef.current = false;
    try {
      const { upload, persisted } = await addUpload(file);
      const { url, image } = await decodeImageBlob(upload.blob);
      handleSelectBackgroundImage(url, image, upload.id);
      if (persisted) {
        void refreshRecentUploads();
      } else {
        showToast({ type: 'info', title: 'Background not saved', message: 'This browser blocked local storage: the image works now but will not be remembered.' });
      }
    } catch (err: any) {
      showToast({ type: 'error', title: 'Background Image Failed', message: err?.message || 'The image could not be used.' });
    }
  }, [handleSelectBackgroundImage, refreshRecentUploads, showToast]);

  const handleSelectRecentUpload = useCallback(async (id: string) => {
    restoringBackgroundRef.current = false;
    try {
      const upload = await getUpload(id);
      if (!upload) throw new Error('That image is no longer stored.');
      const { url, image } = await decodeImageBlob(upload.blob);
      handleSelectBackgroundImage(url, image, upload.id);
    } catch (err: any) {
      showToast({ type: 'error', title: 'Background Image Failed', message: err?.message || 'The image could not be used.' });
      void refreshRecentUploads();
    }
  }, [handleSelectBackgroundImage, refreshRecentUploads, showToast]);

  const handleDeleteRecentUpload = useCallback(async (id: string) => {
    try {
      await deleteUpload(id);
    } catch {
      // Already gone.
    }
    if (backgroundSpec.kind === 'image' && backgroundSpec.uploadId === id) handleChangeBackground({ kind: 'backdrop' });
    void refreshRecentUploads();
  }, [backgroundSpec, handleChangeBackground, refreshRecentUploads]);

  // Restore the remembered image (if any) and list the recent uploads, once.
  useEffect(() => {
    void refreshRecentUploads();
    if (savedBackground.spec.kind !== 'image') return;
    const id = savedBackground.spec.uploadId;
    let cancelled = false;
    (async () => {
      try {
        const upload = await getUpload(id);
        if (!upload) throw new Error('missing');
        const { url, image } = await decodeImageBlob(upload.blob);
        // Cancelled, or the user picked another background meanwhile: theirs wins.
        if (cancelled || !restoringBackgroundRef.current) { URL.revokeObjectURL(url); return; }
        handleSelectBackgroundImage(url, image, upload.id);
      } catch {
        if (cancelled || !restoringBackgroundRef.current) return;
        saveBackgroundChoice({ kind: 'backdrop' }, savedBackground.effects);
        showToast({ type: 'info', title: 'Background reset', message: 'The saved background image is no longer available.' });
      } finally {
        if (!cancelled) restoringBackgroundRef.current = false;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    recentUploadUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    recentUploadUrlsRef.current = [];
  }, []);

  // Paste an image anywhere in the editor (not while typing in a field) to use it as the background.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select') || target.isContentEditable)) return;
      const items = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file');
      if (items.length === 0) return; // plain text etc.: not ours
      const item = items.find((i) => i.type.startsWith('image/')) || items[0];
      const file = item.getAsFile();
      if (!file) return;
      event.preventDefault();
      void handleUploadBackgroundFile(file); // a non-image is refused there, with a message
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleUploadBackgroundFile]);

  // Remember every change (not while the saved image is still being restored).
  useEffect(() => {
    if (restoringBackgroundRef.current) return;
    saveBackgroundChoice(backgroundSpec, backgroundEffects);
  }, [backgroundSpec, backgroundEffects]);
  const [followCursor, setFollowCursor] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Cursor & Auto-Captions State
  const [cursorTheme, setCursorTheme] = useState<CursorTheme>('mac-obsidian');
  const [cursorScale, setCursorScale] = useState<number>(1.2);
  const [cursorSmoothing, setCursorSmoothing] = useState<number>(0.6);
  const [cursorMotion, setCursorMotion] = useState<CursorMotionSettings>(DEFAULT_CURSOR_MOTION);
  const [showCaptions, setShowCaptions] = useState<boolean>(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('tiktok-bold');
  const [captionBackdrop, setCaptionBackdrop] = useState<number>(70);
  const [captions, setCaptions] = useState<CaptionBlock[]>([]);
  // Real amplitude envelope decoded from the recorded audio track.
  // Empty array == the recording has no audio track (the timeline shows "NO AUDIO").
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportComplete, setExportComplete] = useState<boolean>(false);

  // GIF Export State
  const [isExportingGif, setIsExportingGif] = useState<boolean>(false);
  const [exportGifProgress, setExportGifProgress] = useState<number>(0);
  const [exportGifComplete, setExportGifComplete] = useState<boolean>(false);
  // The running export (MP4 or GIF) can be cancelled; one controller per export.
  const exportAbortRef = useRef<AbortController | null>(null);
  const [gifPreset, setGifPreset] = useState<GifQualityPreset>('compact');

  const [copiedSop, setCopiedSop] = useState<boolean>(false);
  /** Recording lifecycle (studio-session.ts). The ref is read by callbacks of older renders. */
  const [recordingPhase, setRecordingPhaseState] = useState<RecordingPhase>('idle');
  const recordingRef = useRef<RecordingPhase>('idle');
  const isRecordingLive = recordingPhase === 'recording';
  /** Moves the recording machine; false (and nothing changes) when the event is not allowed now. */
  const sendRecording = (event: RecordingEvent): boolean => {
    const next = nextRecordingPhase(recordingRef.current, event);
    if (!next) {
      console.log(`[SmoothStudio] Recording: '${event}' ignored while ${recordingRef.current}`);
      return false;
    }
    recordingRef.current = next;
    setRecordingPhaseState(next);
    return true;
  };
  /** The one export running right now (they share the source video). */
  const exportJobRef = useRef<ExportJob | null>(null);
  const [showRecordPrompt, setShowRecordPrompt] = useState<boolean>(false);
  const [recordTargetTabId, setRecordTargetTabId] = useState<number | undefined>(undefined);
  const [recordIncludeMic, setRecordIncludeMic] = useState<boolean>(true);
  /** The tab whose page is tracked for clicks in the current / last recording (from the service worker). */
  const trackedTabIdRef = useRef<number | null>(null);
  const [hasNoRecording, setHasNoRecording] = useState<boolean>(false);

  // Engines
  const cursorEngineRef = useRef<CursorSplineEngine>(new CursorSplineEngine());
  const audioProcessorRef = useRef<AudioProcessor>(new AudioProcessor());
  const sfxSynthesizerRef = useRef<SfxSynthesizer>(new SfxSynthesizer(true));
  const captureEngineRef = useRef<ScreenCaptureEngine>(new ScreenCaptureEngine());
  useEffect(() => {
    cursorEngineRef.current.setOptions({
      smoothing: cursorSmoothing,
      cutRanges: autoCutSilences ? silences.filter((silence) => silence.markedForCut) : [],
      trimStartMs,
      trimEndMs,
      motion: cursorMotion
    });
  }, [autoCutSilences, cursorSmoothing, cursorMotion, silences, trimEndMs, trimStartMs]);
  /** Applied to the engine right away: the preview re-renders before the effect above runs. */
  const handleChangeCursorMotion = (change: Partial<CursorMotionSettings>) => {
    const next = { ...cursorMotion, ...change };
    cursorEngineRef.current.setOptions({ motion: next });
    setCursorMotion(next);
  };
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  // Deduplicates procedural SFX so a single click/keystroke/zoom event never
  // fires more than once across adjacent animation frames.
  const firedSfxRef = useRef<Set<string>>(new Set());
  const currentTimeRef = useRef<number>(0);
  const handleStopLiveRecordingRef = useRef<((passedTelemetry?: TelemetryData | null, passedBlob?: Blob | null) => Promise<void>) | null>(null);
  const handleStartLiveRecordingRef = useRef<((sourceTabId?: number, includeMic?: boolean) => Promise<void>) | null>(null);
  const telemetryReceivedRef = useRef<boolean>(false);
  // QA-029: the recorder stays paused until the recorded tab's HUD is on
  // screen. `goLiveRef` is called by the HUD_VISIBLE message (or by a watchdog)
  // and is idempotent.
  const hudLiveRef = useRef<boolean>(false);
  const hudLiveWatchdogRef = useRef<any>(null);
  const goLiveRef = useRef<(epoch?: number, why?: string) => void>(() => {});
  // QA-037: HUD_VISIBLE arms the recorder's live gate; the recorder starts once
  // the captured picture itself shows the recorded tab.
  const armLiveGateRef = useRef<(epoch?: number) => void>(() => {});
  // Exposed by the keepalive useEffect so handleStopLiveRecording can speed up
  // pings while a stop/commit is in flight, keeping the MV3 SW awake.
  const keepaliveStateRef = useRef<{ startFastPing: () => void; stopFastPing: () => void } | null>(null);

  // 1. Initial Load: Try OPFS / storage or generate interactive demo
  useEffect(() => {
    // Register editor tab with service worker and listen for background stop capture
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'REGISTER_EDITOR_TAB' }, () => {
        void chrome.runtime?.lastError;
      });

      // Connect persistent keepalive port to prevent MV3 service worker dormancy.
      // During stop/commit the port must stay open so the SW cannot terminate
      // mid-handshake; reconnect on disconnect and ping more often while stopping.
      let keepalivePort: chrome.runtime.Port | null = null;
      let pingInterval: any = null;
      let stopKeepaliveInterval: any = null;
      const connectKeepalive = () => {
        try {
          keepalivePort = chrome.runtime.connect({ name: 'smoothstudio-keepalive' });
          keepalivePort.onDisconnect.addListener(() => {
            void chrome.runtime?.lastError;
            keepalivePort = null;
            // Reconnect so the SW stays awake across restarts, also during stop/commit.
            connectKeepalive();
          });
        } catch {}
      };
      connectKeepalive();
      pingInterval = setInterval(() => {
        try { keepalivePort?.postMessage('ping'); } catch {}
      }, 15000);
      // Faster ping while a stop/commit is in flight so the SW does not go idle.
      const startFastPing = () => {
        if (stopKeepaliveInterval) return;
        stopKeepaliveInterval = setInterval(() => {
          try { keepalivePort?.postMessage('ping'); } catch {}
        }, 5000);
      };
      const stopFastPing = () => {
        if (stopKeepaliveInterval) { clearInterval(stopKeepaliveInterval); stopKeepaliveInterval = null; }
      };
      keepaliveStateRef.current = { startFastPing, stopFastPing };

      const messageListener = (msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        if (msg.type === 'STUDIO_STOP_CAPTURE') {
          console.log('[SmoothStudio] Received STUDIO_STOP_CAPTURE message from service worker:', msg.telemetry);
          // Delivery ack (QA-012): the service worker retries until it hears
          // back, so a stop sent during an SW restart is delivered exactly once
          // and the retry loop terminates instead of firing four stops.
          sendResponse({ ok: true });
          handleStopLiveRecordingRef.current?.(msg.telemetry);
        } else if (msg.type === 'HUD_VISIBLE') {
          // QA-029/QA-037: the recorded tab is visible; arm the recorder's live
          // gate. The timeline starts when the captured picture proves the
          // switch, not at this (earlier) visibility report.
          if (activeSessionIdRef.current && msg.sessionId === activeSessionIdRef.current) {
            armLiveGateRef.current(typeof msg.epoch === 'number' ? msg.epoch : undefined);
          }
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        if (pingInterval) clearInterval(pingInterval);
        try { keepalivePort?.disconnect(); } catch {}
        chrome.runtime.onMessage.removeListener(messageListener);
      };
    }
  }, []);

  // Active State Subscriptions: Hook React 19 Editor UI directly into core engine diagnostic telemetry streams
  useEffect(() => {
    const unsubscribe = diagnosticChannel.subscribe((event) => {
      setActiveDegradation(event);
      showToast({
        type: event.severity === 'critical' ? 'error' : 'warning',
        title: event.title,
        message: event.message
      });
    });

    return () => {
      unsubscribe();
    };
  }, [showToast]);

  // Global Error Trap & Flight Doctor Keyboard Shortcut (Ctrl+Shift+D)
  useEffect(() => {
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason || 'Unhandled error');
      // If error is related to WebCodecs or OPFS quota, route to diagnostic channel
      if (/VideoEncoder|WebCodecs|hardware|encoder/i.test(msg)) {
        diagnosticChannel.recordFrameDrop(msg);
      } else if (/quota|storage|opfs|filehandle|permission/i.test(msg)) {
        diagnosticChannel.recordStorageCap(msg);
      }
      showToast({ type: 'error', title: 'Runtime Alert', message: msg });
    };
    const onError = (e: ErrorEvent) => {
      if (/VideoEncoder|WebCodecs/i.test(e.message)) {
        diagnosticChannel.recordFrameDrop(e.message);
      }
      showToast({ type: 'error', title: 'Script Error', message: e.message });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setShowDoctor((d) => !d);
      }
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    window.addEventListener('error', onError);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('error', onError);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showToast]);

  // Safe blob URL cleanup on window unload (never revoke active blob on React component re-renders)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Release the shared Web Audio context when the studio unmounts
  useEffect(() => {
    return () => {
      sfxSynthesizerRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    async function loadInitial() {
      // M1-06 crash recovery: a session whose recorder page died (crash, tab
      // closed) is assembled from its committed chunks and becomes the
      // recording. A session another live editor is recording is left alone.
      let recoveredSession = false;
      try {
        const recovered = await recoverInterruptedSession({
          isSessionAlive: isSessionLockHeld,
          transform: (b, d) => (d > 0 ? patchWebmBlobDuration(b, d) : Promise.resolve(b))
        });
        if (recovered) {
          const sid = recovered.sessionId;
          let tel: TelemetryData | null = null;
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            tel = await new Promise<TelemetryData | null>((resolve) => {
              const timer = setTimeout(() => resolve(null), 5000);
              chrome.runtime.sendMessage({ type: 'RECOVER_SESSION', sessionId: sid }, (res) => {
                void chrome.runtime?.lastError;
                clearTimeout(timer);
                const t = res?.telemetry as TelemetryData | undefined;
                resolve(t && t.metadata?.sessionId === sid ? t : null);
              });
            });
          }
          if (!tel) tel = await loadTelemetry(sid);
          const finalTel = withSession(tel, sid, recovered.durationMs);
          await saveTelemetry(finalTel).catch(() => undefined);
          setupLoadedRecording(recovered.blob, finalTel, recovered.durationMs || undefined, sid);
          setHasNoRecording(false);
          recoveredSession = true;
          showToast({
            type: 'warning',
            title: 'Recording Recovered',
            message: `The previous recording was interrupted. ${(recovered.durationMs / 1000).toFixed(1)}s were recovered.`
          });
        }
      } catch (err) {
        console.warn('[SmoothStudio] Crash recovery failed:', err);
      }

      if (typeof window !== 'undefined' && window.location.search.includes('record=true')) {
        const urlParams = new URLSearchParams(window.location.search);
        const sourceTabStr = urlParams.get('sourceTab');
        const sourceTabId = sourceTabStr ? parseInt(sourceTabStr) : undefined;
        const micParam = urlParams.get('includeMic');
        const shouldIncludeMic = micParam === null ? true : micParam === 'true';
        setRecordTargetTabId(sourceTabId);
        setRecordIncludeMic(shouldIncludeMic);
        setShowRecordPrompt(true);
        return;
      }

      if (recoveredSession) return;

      try {
        const storedBlob = await getRecordingBlob();
        // Only the committed recording's OWN telemetry is used (M1-08).
        const sid = getFinalSessionId();
        const storedTelemetry = sid ? await loadTelemetry(sid) : await loadTelemetry();

        if (storedBlob && storedBlob.size > 0) {
          const defaultTel: TelemetryData = storedTelemetry || withSession(null, sid || newSessionId(), 0);
          setupLoadedRecording(storedBlob, defaultTel, undefined, sid || defaultTel.metadata.sessionId);
          setHasNoRecording(false);
        } else {
          setHasNoRecording(true);
        }
      } catch (err) {
        console.warn('[SmoothStudio] Failed to load stored recording:', err);
        setHasNoRecording(true);
      }
    }
    loadInitial();
  }, []);

  /**
   * Loads a recording into the studio (state machine: studio-load.ts). The video,
   * its real length, the telemetry and the zooms are put on screen together, once
   * all of them are ready; until then the studio shows the loading screen.
   */
  const setupLoadedRecording = async (blob: Blob, loadedData: TelemetryData, measuredDurationMs?: number, sessionId?: string | null): Promise<boolean> => {
    const loadId = ++loadIdRef.current;
    const isCurrent = () => loadId === loadIdRef.current;
    const step = (s: LoadStep) => { if (isCurrent()) dispatchLoad({ type: 'step', loadId, step: s }); };
    dispatchLoad({ type: 'begin', loadId, step: 'opening' });

    // Nothing of the previous recording may play or draw while this one loads.
    setIsPlaying(false);
    setVideoElement(null);
    const previousVideo = document.getElementById('smoothstudio-source-video') as HTMLVideoElement | null;
    if (previousVideo) {
      try { previousVideo.pause(); } catch { /* already gone */ }
      previousVideo.remove();
    }
    firedSfxRef.current.clear();

    const newObjectUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = newObjectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.id = 'smoothstudio-source-video';
    const loadedSid = sessionId || loadedData.metadata?.sessionId || null;
    if (loadedSid) video.setAttribute('data-session-id', loadedSid);
    // Mounted so the browser decodes it; invisible (the canvas shows it).
    video.style.cssText = 'position: fixed; bottom: 0; right: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; z-index: -1;';
    document.body.appendChild(video);
    video.addEventListener('play', () => { if (isCurrent()) setIsPlaying(true); });
    video.addEventListener('pause', () => { if (isCurrent()) setIsPlaying(false); });
    try { video.load(); } catch { /* reported by prepareVideo */ }

    const dropThisVideo = () => {
      video.remove();
      URL.revokeObjectURL(newObjectUrl);
    };

    try {
      const media = await prepareVideo(video, step);
      if (!isCurrent()) { dropThisVideo(); return false; }
      video.setAttribute('data-ready', 'true');

      // ---- syncing: one clock (the video's) and one frame (the video's picture) ----
      step('syncing');
      const telemetryMs = (measuredDurationMs && measuredDurationMs > 0)
        ? measuredDurationMs
        : (loadedData.metadata?.durationMs && loadedData.metadata.durationMs > 0 ? loadedData.metadata.durationMs : null);
      // The video is the timeline: its own length wins over the recorder's estimate.
      const resolvedDur = media.durationMs ?? telemetryMs ?? 10000;
      mediaDurationRef.current = media.durationMs;
      // Many readers (timeline, exporters) use video.duration: keep it finite and equal to the timeline.
      try {
        Object.defineProperty(video, 'duration', { get: () => resolvedDur / 1000, configurable: true });
      } catch { /* read-only in this browser */ }

      // A window / entire-screen recording shows the page somewhere inside the picture:
      // the clicks and the cursor are moved onto the recorded frame (its real size is known now).
      const loadedSurface = loadedData.metadata?.displaySurface || captureEngineRef.current.getTrackSettings()?.displaySurface;
      const data = toCaptureSpace(loadedData, loadedSurface, media.width, media.height) ?? loadedData;
      cursorEngineRef.current.setData(data.mousePoints || [], data.clicks || [], data.pressEvents || []);
      // A window / screen recording whose page cannot be placed gets no auto zooms: say why
      // instead of silently showing none.
      // No click and no mouse data at all: nothing to zoom on. Say why rather than show an empty timeline.
      if ((loadedData.clicks || []).length === 0 && (loadedData.mousePoints || []).length === 0) {
        const explain = (url?: string | null) => {
          const blocked = untrackablePage(url);
          console.warn('[SmoothStudio] No clicks or mouse movement were recorded.', { url: url || '(unknown)', blocked });
          showToast({
            type: 'warning',
            title: 'No clicks were recorded',
            message: blocked
              ? `Chrome does not let extensions work on ${blocked}, so clicks there cannot be tracked and there is no auto-zoom. Record a normal website.`
              : 'Nothing was tracked on the recorded page, so there is no auto-zoom. Reload the extension, refresh the page you record, then record again (or add zooms by hand).'
          });
        };
        const knownUrl = loadedData.metadata?.url;
        if (knownUrl) {
          explain(knownUrl);
        } else if (typeof (recordTargetTabId ?? trackedTabIdRef.current) === 'number' && typeof chrome !== 'undefined' && chrome.tabs?.get) {
          chrome.tabs.get((recordTargetTabId ?? trackedTabIdRef.current) as number, (tab) => {
            void chrome.runtime?.lastError;
            explain(tab?.url);
          });
        } else {
          explain(null);
        }
      }
      const placementProblem = captureSpaceProblem(loadedData, loadedSurface, media.width, media.height);
      if (placementProblem && (loadedData.clicks || []).length > 0) {
        console.warn('[SmoothStudio] Auto-zoom is off for this recording:', placementProblem, {
          surface: loadedSurface,
          picture: `${media.width}x${media.height}`,
          screenLayout: loadedData.metadata?.screenLayout,
          page: `${loadedData.metadata?.width}x${loadedData.metadata?.height}`
        });
        showToast({
          type: 'warning',
          title: 'Auto-zoom is off for this recording',
          message: `The clicks could not be placed on the video: ${placementProblem}. Record the screen the Chrome window is on, or a Chrome tab; zooms can still be added by hand.`
        });
      }

      // ---- zooms: built against the real length ----
      step('zooms');
      const autoPills = buildAutoZoomPills(data, resolvedDur, autoZoomSettingsRef.current);
      const displaySurface = data.metadata?.displaySurface || captureEngineRef.current.getTrackSettings()?.displaySurface;
      const capturedNativeCursor = data.metadata?.capturedNativeCursor || captureEngineRef.current.getCapturedNativeCursor();
      const hasDomCursorTelemetry = (data.mousePoints || []).some((point) => Boolean(point.c));

      // ---- ready: everything goes on screen in the same render ----
      if (!isCurrent()) { dropThisVideo(); return false; }
      if (prevBlobUrlRef.current && prevBlobUrlRef.current !== newObjectUrl) URL.revokeObjectURL(prevBlobUrlRef.current);
      prevBlobUrlRef.current = currentBlobUrlRef.current;
      currentBlobUrlRef.current = newObjectUrl;
      setVideoBlob(blob);
      setTelemetry(data);
      setDurationMs(resolvedDur);
      setTrimStartMs(0);
      setTrimEndMs(resolvedDur);
      currentTimeRef.current = 0;
      setCurrentTimeMs(0);
      setPills(autoPills);
      setSelectedPillId(null);
      // Captions are only ever sourced from a REAL transcription supplied with the recording.
      setCaptions(data.captions && data.captions.length > 0 ? data.captions : []);
      setShowCursor(shouldEnableCustomCursor(capturedNativeCursor, displaySurface, hasDomCursorTelemetry));
      setSilences([]);
      setWaveformPeaks([]);
      setVideoElement(video);
      dispatchLoad({ type: 'ready', loadId });
      console.log('[SmoothStudio] Recording ready:', resolvedDur, 'ms,', media.width, 'x', media.height, ',', (data.clicks || []).length, 'clicks,', autoPills.length, 'auto zooms');

      // Audio analysis does not move anything on the timeline: it fills in afterwards.
      audioProcessorRef.current
        .buildWaveformPeaks(blob, 160)
        .then((peaks) => { if (isCurrent()) setWaveformPeaks(peaks); })
        .catch((err) => {
          console.warn('[SmoothStudio] Waveform extraction failed:', err);
          if (isCurrent()) setWaveformPeaks([]);
        });
      audioProcessorRef.current
        .analyzeSilences(blob, data.clicks || [], data.keystrokes || [], -42, 1200, resolvedDur)
        .then((detected) => { if (isCurrent()) setSilences(detected); })
        .catch((err) => console.warn('[SmoothStudio] Silence analysis failed:', err));
      return true;
    } catch (err: any) {
      dropThisVideo();
      if (!isCurrent()) return false;
      console.error('[SmoothStudio] The recording could not be loaded:', err);
      dispatchLoad({ type: 'fail', loadId, message: err?.message || 'The recording could not be loaded.' });
      showToast({
        type: 'error',
        title: 'Video Stream Error',
        message: err?.message || 'Could not decode the recorded video in the browser.'
      });
      return false;
    }
  };

  const handleUpdateTrim = useCallback((start: number, end: number) => {
    setTrimStartMs(start);
    setTrimEndMs(end);
    if (currentTimeRef.current < start) {
      currentTimeRef.current = start;
      setCurrentTimeMs(start);
      if (videoElement instanceof HTMLVideoElement) videoElement.currentTime = start / 1000;
    } else if (currentTimeRef.current > end) {
      currentTimeRef.current = end;
      setCurrentTimeMs(end);
      if (videoElement instanceof HTMLVideoElement) videoElement.currentTime = end / 1000;
    }
  }, [videoElement]);

  const handleResetTrim = useCallback(() => {
    setTrimStartMs(0);
    setTrimEndMs(durationMs);
  }, [durationMs]);

  /** Moves the playhead and the video together: the only way the playhead jumps. */
  const seekPlayhead = useCallback((timeMs: number) => {
    firedSfxRef.current.clear();
    currentTimeRef.current = timeMs;
    setCurrentTimeMs(timeMs);
    if (videoElement instanceof HTMLVideoElement) {
      try { videoElement.currentTime = timeMs / 1000; } catch { /* not seekable yet */ }
    }
  }, [videoElement]);

  /** Play / pause. Nothing plays until the recording is fully loaded and in sync. */
  const handleTogglePlay = useCallback(() => {
    if (!isStudioReady || exportJobRef.current) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
    const safeTrimStart = Math.max(0, Math.min(safeDur, trimStartMs));
    const safeTrimEnd = Math.max(safeTrimStart, Math.min(safeDur, trimEndMs > 0 ? trimEndMs : safeDur));
    // At (or within a frame of) the end, or before the start: play from the start.
    if (currentTimeRef.current >= safeTrimEnd - 50 || currentTimeRef.current < safeTrimStart) {
      seekPlayhead(safeTrimStart);
    }
    setIsPlaying(true);
  }, [isStudioReady, isPlaying, durationMs, trimStartMs, trimEndMs, seekPlayhead]);

  const handleRestart = useCallback(() => {
    firedSfxRef.current.clear();
    const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
    const safeTrimStart = Math.max(0, Math.min(safeDur, trimStartMs));
    currentTimeRef.current = safeTrimStart;
    setCurrentTimeMs(safeTrimStart);
    if (videoElement instanceof HTMLVideoElement) {
      videoElement.currentTime = safeTrimStart / 1000;
    }
  }, [durationMs, trimStartMs, videoElement]);

  // 2. Playback Loop (60 FPS)
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    lastTimeRef.current = performance.now();

    const loop = (now: number) => {
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
      const safeTrimStart = Math.max(0, Math.min(safeDur, trimStartMs));
      const safeTrimEnd = Math.max(safeTrimStart, Math.min(safeDur, trimEndMs > 0 ? trimEndMs : safeDur));
      let next = currentTimeRef.current + dt;
      if (videoElement instanceof HTMLVideoElement && !videoElement.paused) {
        next = videoElement.currentTime * 1000;
      }

      const jumpVideoTo = (ms: number) => {
        if (videoElement instanceof HTMLVideoElement) {
          try { videoElement.currentTime = ms / 1000; } catch { /* not seekable yet */ }
        }
      };

      if (next < safeTrimStart) {
        next = safeTrimStart;
        jumpVideoTo(next);
      }

      if (autoCutSilences) {
        const activeSilence = silences.find(
          (s) => s.markedForCut && next >= s.startTime && next < s.endTime
        );
        if (activeSilence) {
          // Never skip across the Outro CTA window: clamp the jump so the final
          // 1.5s always plays in full when the outro card is enabled.
          const clampEnd = showOutroCard
            ? Math.min(activeSilence.endTime, Math.max(activeSilence.startTime, safeTrimEnd - 1500))
            : activeSilence.endTime;
          if (clampEnd > next) {
            next = clampEnd;
            jumpVideoTo(next);
          }
        }
      }

      if (next >= safeTrimEnd) {
        setIsPlaying(false);
        currentTimeRef.current = safeTrimStart;
        setCurrentTimeMs(safeTrimStart);
        if (videoElement instanceof HTMLVideoElement) {
          videoElement.currentTime = safeTrimStart / 1000;
        }
        firedSfxRef.current.clear();
        // no extra frame scheduled on natural end
        return;
      }

      // Procedural Audio SFX Triggering during playback.
      // The rAF loop only runs while playing, and each event is deduplicated by
      // its timestamp so adjacent frames never double-trigger the same sound.
      // Timing offsets are passed so audio synthesizers schedule with sample-accurate timeline playhead sync.
      if (isPlaying && soundEnabled && telemetry) {
        const activeClick = telemetry.clicks.find((c) => Math.abs(c.t - next) < 25);
        if (activeClick && !firedSfxRef.current.has(`click_${activeClick.t}`)) {
          firedSfxRef.current.add(`click_${activeClick.t}`);
          const timeOffsetSec = Math.max(0, (activeClick.t - next) / 1000);
          sfxSynthesizerRef.current.playUiClick(0.35, timeOffsetSec);
        }

        const activeKey = telemetry.keystrokes.find((k) => Math.abs(k.t - next) < 25);
        if (activeKey && !firedSfxRef.current.has(`key_${activeKey.t}`)) {
          firedSfxRef.current.add(`key_${activeKey.t}`);
          const timeOffsetSec = Math.max(0, (activeKey.t - next) / 1000);
          sfxSynthesizerRef.current.playMechanicalThock(0.3, timeOffsetSec);
        }

        const pillEntering = pills.find((p) => Math.abs(p.startTime - next) < 25);
        if (pillEntering && !firedSfxRef.current.has(`pill_${pillEntering.id}`)) {
          firedSfxRef.current.add(`pill_${pillEntering.id}`);
          const timeOffsetSec = Math.max(0, (pillEntering.startTime - next) / 1000);

          // Calculate spring-physics translation speed based on camera trajectory delta
          const prevPill = pills.slice().reverse().find((p) => p.endTime <= pillEntering.startTime);
          const fromX = prevPill ? prevPill.targetX : 0.5;
          const fromY = prevPill ? prevPill.targetY : 0.5;
          const fromScale = prevPill ? prevPill.targetScale : 1.0;
          const dx = pillEntering.targetX - fromX;
          const dy = pillEntering.targetY - fromY;
          const dScale = Math.abs(pillEntering.targetScale - fromScale);
          const translationDist = Math.hypot(dx, dy);
          const translationSpeed = Math.max(0.6, (translationDist * 2.8 + dScale * 1.2) / 0.5);

          sfxSynthesizerRef.current.playCameraWhoosh(0.25, translationSpeed, timeOffsetSec);
        }
      }

      currentTimeRef.current = next;
      setCurrentTimeMs(next);

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, videoElement, durationMs, trimStartMs, trimEndMs, soundEnabled, telemetry, pills, silences, autoCutSilences, showOutroCard]);

  // Timeline Interactions
  /** A zoom at the playhead: on the given point, else on the cursor at that moment (like an auto zoom). */
  const handleAddPillAtPlayhead = useCallback((targetX?: number, targetY?: number) => {
    const playhead = currentTimeRef.current;
    const settings = autoZoomSettingsRef.current;
    let x = targetX;
    let y = targetY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const cursor = (telemetry?.mousePoints || []).length > 0 ? cursorEngineRef.current.getCursorAt(playhead) : null;
      const onFrame = (v: number | undefined) => Number.isFinite(v) && (v as number) >= 0 && (v as number) <= 1;
      x = cursor && onFrame(cursor.x) && onFrame(cursor.y) ? cursor.x : 0.5;
      y = cursor && onFrame(cursor.x) && onFrame(cursor.y) ? cursor.y : 0.5;
    }
    const newPill: ZoomPill = {
      id: 'pill_' + Date.now(),
      startTime: Math.max(0, playhead - settings.speedMs),
      endTime: Math.min(durationMs, playhead + 2500),
      targetX: x as number,
      targetY: y as number,
      targetScale: settings.depth,
      tiltX: 0,
      tiltY: 0,
      spotlight: false,
      label: 'Custom Zoom',
      transitionDuration: settings.speedMs
    };
    setPills((prev) => [...prev, newPill].sort((a, b) => a.startTime - b.startTime));
  }, [durationMs, telemetry]);

  const handleSelectPreset = useCallback((newPreset: VibePreset) => {
    setPreset(newPreset);
    // The latest choice wins: picking a preset drops any custom background.
    restoringBackgroundRef.current = false;
    clearBackgroundImage();
    setBackgroundSpec({ kind: 'backdrop' });
    if (newPreset.backdrop) {
      setBackdropParams(newPreset.backdrop);
    }
  }, [clearBackgroundImage]);

  const handleChangeAspectRatio = useCallback((aspect: AspectRatioType) => {
    setAspectRatio(aspect);
    setFramingMode(aspect === '9:16' || aspect === '4:5' ? 'smart-fill' : 'fit');
  }, []);

  const handleUpdateBackdropParams = useCallback((updates: Partial<BackdropMatrixParams>) => {
    setBackdropParams((prev) => {
      const merged = { ...prev, ...updates };
      setPreset((p) => ({ ...p, backdrop: merged }));
      return merged;
    });
  }, []);

  // Safe Fail-over Action 1: Toggle RAM Fallback Buffer
  const handleToggleRamFallback = useCallback(() => {
    const nextMode = storageMode === 'opfs' ? 'ram' : 'opfs';
    setStorageMode(nextMode);
    setUseOpfs(nextMode === 'opfs');
    diagnosticChannel.setStorageMode(nextMode);
    if (nextMode === 'ram') {
      diagnosticChannel.clearDegradation('opfs');
      setActiveDegradation((curr) => (curr?.source === 'opfs' ? null : curr));
      showToast({
        type: 'success',
        title: 'RAM Fallback Buffer Active',
        message: 'Swapped from disk-heavy OPFS to raw system memory arrays.'
      });
    } else {
      showToast({
        type: 'info',
        title: 'OPFS Storage Restored',
        message: 'Restored disk-based OPFS storage stream.'
      });
    }
  }, [storageMode, showToast]);

  // Safe Fail-over Action 2: Downgrade Encoder Stream
  const handleDowngradeEncoderStream = useCallback(() => {
    const nextMode = encoderStreamMode === 'hardware-mp4' ? 'client-webm' : 'hardware-mp4';
    setEncoderStreamMode(nextMode);
    diagnosticChannel.setEncoderStreamMode(nextMode);
    if (nextMode === 'client-webm') {
      diagnosticChannel.clearDegradation('webcodecs');
      setActiveDegradation((curr) => (curr?.source === 'webcodecs' ? null : curr));
      showToast({
        type: 'success',
        title: 'Encoder Stream Downgraded',
        message: 'Swapped from hardware-accelerated H.264 MP4 to pure WebM client-side downloads.'
      });
    } else {
      showToast({
        type: 'info',
        title: 'Hardware MP4 Restored',
        message: 'Restored H.264 GPU hardware acceleration profile.'
      });
    }
  }, [encoderStreamMode, showToast]);

  // Keyboard shortcuts: Space (play/pause), ArrowLeft/Right (seek), Z (add zoom),
  // Delete/Backspace (delete the selected zoom). Typing surfaces (input, textarea,
  // select, contenteditable) keep every key; a focused button keeps Space.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcut = resolveEditorShortcut(e, { hasSelectedPill: Boolean(selectedPillId) });
      if (!shortcut) return;

      if (shortcut === 'toggle-play') {
        e.preventDefault();
        handleTogglePlay();
      } else if (shortcut === 'delete-pill') {
        e.preventDefault();
        const doomed = selectedPillId;
        setPills((prev) => prev.filter((p) => p.id !== doomed));
        setSelectedPillId(null);
      } else if (shortcut === 'seek-back') {
        e.preventDefault();
        const safeTrimStart = Math.max(0, Math.min(durationMs, trimStartMs));
        seekPlayhead(Math.max(safeTrimStart, currentTimeRef.current - 1000));
      } else if (shortcut === 'seek-forward') {
        e.preventDefault();
        const safeTrimEnd = Math.max(0, Math.min(durationMs, trimEndMs > 0 ? trimEndMs : durationMs));
        seekPlayhead(Math.min(safeTrimEnd, currentTimeRef.current + 1000));
      } else if (shortcut === 'add-zoom') {
        handleAddPillAtPlayhead();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [durationMs, trimStartMs, trimEndMs, currentTimeMs, selectedPillId, handleAddPillAtPlayhead, handleTogglePlay, seekPlayhead]);

  useEffect(() => { currentTimeRef.current = currentTimeMs; }, [currentTimeMs]);
  useEffect(() => { sfxSynthesizerRef.current.setEnabled(soundEnabled); }, [soundEnabled]);

  // Synchronize HTML5 video element currentTime if source is a real video
  // Paused: the video shows the playhead's frame. Playing: the video is the clock and
  // the playhead follows it, so it is never pulled back to a playhead a render behind.
  useEffect(() => {
    if (isExporting || isExportingGif || isPlaying) return;
    if (videoElement instanceof HTMLVideoElement) {
      if (Math.abs(videoElement.currentTime - currentTimeMs / 1000) > 0.03) {
        videoElement.currentTime = currentTimeMs / 1000;
      }
    }
  }, [currentTimeMs, videoElement, isExporting, isExportingGif, isPlaying]);

  // Synchronize HTML5 video play/pause state
  useEffect(() => {
    if (isExporting || isExportingGif) return;
    if (videoElement instanceof HTMLVideoElement) {
      if (isPlaying) {
        if (videoElement.paused) videoElement.play().catch(() => {});
      } else {
        if (!videoElement.paused) videoElement.pause();
      }
    }
  }, [isPlaying, videoElement, isExporting, isExportingGif]);

  // Handle Live Screen Recording within the browser tab
  const handleStartLiveRecording = async (sourceTabId?: number, includeMic = true) => {
    if (exportJobRef.current) {
      showToast({ type: 'info', title: 'Export in progress', message: 'Finish or cancel the export before recording.' });
      return;
    }
    if (load.phase === 'loading') return;
    // Only from idle: a second Record click, or Record during a stop, does nothing.
    if (!sendRecording('start')) return;
    try {
      telemetryReceivedRef.current = false;
      latestTelemetryRef.current = null;
      hudLiveRef.current = false;
      // QA-037: a recording started again in this editor must not inherit the
      // previous recording's declared timeline origin.
      if (hudLiveWatchdogRef.current) {
        clearTimeout(hudLiveWatchdogRef.current);
        hudLiveWatchdogRef.current = null;
      }
      const sessionId = newSessionId();
      activeSessionIdRef.current = sessionId;
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      await captureEngineRef.current.start({
        includeMic,
        sessionId,
        frameRate: 60,
        onMicWarning: (msg) => {
          showToast({
            type: 'warning',
            title: 'Microphone not recorded',
            message: msg
          });
          setMicWarning(msg);
        },
        onStop: (stoppedBlob) => {
          console.log('[SmoothStudio] captureEngine onStop triggered with blob size:', stoppedBlob?.size);
          // The capture ended by itself (Chrome's "Stop sharing", the tab closed).
          if (recordingRef.current !== 'stopping') {
            void handleStopLiveRecordingRef.current?.(null, stoppedBlob);
          }
        }
      });
      // The capture ended while the picker was still resolving: the stop owns the session now.
      if (!sendRecording('started')) return;

      // Clear record=true query param without refreshing page
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      // QA-029/QA-037: the recorder is armed PAUSED. The content script reports
      // when the recorded tab is visible, but "visible" is not "on screen": the
      // compositor swaps the tab ~0.5 s later and Chromium then stalls the
      // screen capture while the capturing tab is backgrounded. The recorder
      // holds the pause until the captured picture itself shows the switch, and
      // that instant is timeline zero for video, audio and telemetry.
      const notifyTimelineOrigin = (originEpoch: number) => {
        // QA-037: the harness anchors the wall clock at this declared instant;
        // the recorded page's own clock band is the independent check.
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage(
            { type: 'RECORDING_LIVE', epoch: originEpoch, sessionId },
            () => { void chrome.runtime?.lastError; }
          );
        }
      };
      armLiveGateRef.current = (hudEpoch) => {
        if (hudLiveRef.current || recordingRef.current !== 'recording') return;
        const armed = captureEngineRef.current.armLiveGate((origin) => {
          if (recordingRef.current !== 'recording') return;
          hudLiveRef.current = true;
          if (hudLiveWatchdogRef.current) {
            clearTimeout(hudLiveWatchdogRef.current);
            hudLiveWatchdogRef.current = null;
          }
          console.log(`[SmoothStudio] Recording live (recorded surface on screen) at epoch ${origin}`);
          notifyTimelineOrigin(origin);
        });
        if (!armed) {
          // The recorder is not in the armed state: never leave the user
          // without a recording - start it the old way.
          const origin = captureEngineRef.current.resumeCapture(
            typeof hudEpoch === 'number' ? hudEpoch : undefined
          );
          if (origin !== null) {
            hudLiveRef.current = true;
            notifyTimelineOrigin(origin);
          }
          return;
        }
        console.log(`[SmoothStudio] HUD visible at epoch ${hudEpoch}; waiting for the captured picture to show the recorded tab`);
      };
      // Last resort only: no HUD signal at all (a recorded surface without a
      // content script, e.g. another app or a chrome:// page).
      goLiveRef.current = (epoch) => {
        if (hudLiveRef.current || recordingRef.current !== 'recording') return;
        const origin = captureEngineRef.current.resumeCapture(epoch);
        if (origin === null) return;
        hudLiveRef.current = true;
        console.log(`[SmoothStudio] Recording live (watchdog) at epoch ${origin}`);
        notifyTimelineOrigin(origin);
      };

      // Notify service worker to initiate 120Hz DOM tracking on target tab.
      // No originEpoch is sent: the content script owns the HUD-visible epoch
      // and publishes it back with HUD_VISIBLE.
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // QA-006: forward the privacy options to the target tab when starting from
        // the editor. They are the user's saved popup choices (a category switched
        // OFF stays OFF); with nothing saved every category is ON, so sensitive data
        // is never recorded unblurred by default.
        const privacyPrefs = await loadPrivacyPrefs();
        chrome.runtime.sendMessage({
          type: 'APPLY_PRIVACY_OPTIONS',
          options: privacyPrefs,
          ...(sourceTabId ? { tabId: sourceTabId } : {})
        }, () => {
          void chrome.runtime?.lastError;
        });
        trackedTabIdRef.current = typeof sourceTabId === 'number' ? sourceTabId : null;
        chrome.runtime.sendMessage(
          {
            type: 'START_STUDIO_RECORDING',
            tabId: sourceTabId,
            focusTarget: Boolean(sourceTabId),
            sessionId
          },
          (response) => {
            if (chrome.runtime?.lastError || !response) return;
            // Clicks are only tracked on the page of ONE normal Chrome tab. Say so now when
            // that page cannot be tracked, not after the recording turns out to have no zooms.
            const tabId = typeof response.activeRecordingTabId === 'number' ? response.activeRecordingTabId : null;
            trackedTabIdRef.current = tabId;
            const results: Array<{ ok?: boolean; reason?: string }> = Array.isArray(response.telemetry) ? response.telemetry : [];
            if (tabId !== null && results.some((r) => r && r.ok)) return;
            const warn = (page: string | null) => showToast({
              type: 'warning',
              title: 'Clicks will not be tracked',
              message: page
                ? `Chrome does not let extensions work on ${page}, so this recording will have no auto-zoom. Click inside a normal website instead.`
                : tabId === null
                  ? 'No normal website is open. Clicks are tracked only inside a web page in a Chrome tab: open your site, then record again for auto-zoom.'
                  : 'The page being recorded did not respond. Refresh it (after reloading the extension) and record again for auto-zoom.'
            });
            if (tabId !== null && chrome.tabs?.get) {
              chrome.tabs.get(tabId, (tab) => {
                void chrome.runtime?.lastError;
                warn(untrackablePage(tab?.url));
              });
            } else {
              warn(null);
            }
          }
        );
      }
      hudLiveWatchdogRef.current = setTimeout(() => {
        goLiveRef.current(undefined, 'watchdog: no HUD signal');
      }, 8000);
    } catch (err: any) {
      console.warn('Capture canceled or rejected:', err);
      sendRecording('start-failed');
      showToast({
        type: 'warning',
        title: 'Recording Not Started',
        message: err?.name === 'NotAllowedError' ? 'Display capture permission was dismissed or denied.' : (err?.message || 'Capture could not start.')
      });
    }
  };

  const handleStopLiveRecording = async (passedTelemetry?: TelemetryData | null, passedBlob?: Blob | null) => {
    // Every stop path ends here: the HUD / popup (via the SW, with telemetry),
    // the editor's Stop button and Chrome's "Stop sharing" bar (recorder onStop).
    console.log('[SmoothStudio] Stop handled at epoch', Date.now(), 'telemetry passed:', Boolean(passedTelemetry));
    const sessionId = activeSessionIdRef.current;
    const sameSession = (t?: TelemetryData | null) =>
      !!t && (!t.metadata?.sessionId || !sessionId || t.metadata.sessionId === sessionId);
    if (passedTelemetry && sameSession(passedTelemetry)) {
      latestTelemetryRef.current = passedTelemetry;
    }

    // One stop per session: a stop while this session is being finalized (or
    // when nothing records) only hands over its telemetry. It must never load
    // the previous recording again.
    if (recordingRef.current === 'idle' || recordingRef.current === 'stopping') {
      console.log(`[SmoothStudio] Stop request ignored while ${recordingRef.current}.`);
      return;
    }
    // The picker is still open and nothing was captured yet: there is nothing to stop.
    if (recordingRef.current === 'starting' && !passedBlob && !captureEngineRef.current.getStatus()) {
      console.log('[SmoothStudio] Stop request ignored: the capture has not started yet.');
      return;
    }
    sendRecording('stop');
    keepaliveStateRef.current?.startFastPing();
    if (hudLiveWatchdogRef.current) {
      clearTimeout(hudLiveWatchdogRef.current);
      hudLiveWatchdogRef.current = null;
    }
    setIsPlaying(false);
    const stopLoadId = ++loadIdRef.current;
    dispatchLoad({ type: 'begin', loadId: stopLoadId, step: 'finishing' });

    // Ask the SW to end the session on the recorded tab (HUD, telemetry) in
    // parallel with stopping the recorder, unless the SW already did.
    const telemetryFromSw: Promise<TelemetryData | null> = latestTelemetryRef.current
      ? Promise.resolve(latestTelemetryRef.current)
      : new Promise<TelemetryData | null>((resolve) => {
          if (typeof chrome === 'undefined' || !chrome.runtime) { resolve(null); return; }
          const timer = setTimeout(() => resolve(null), 6000);
          try {
            chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING', sessionId }, (res) => {
              void chrome.runtime?.lastError;
              clearTimeout(timer);
              const t = res?.telemetry as TelemetryData | undefined;
              resolve(t && sameSession(t) ? t : null);
            });
          } catch { clearTimeout(timer); resolve(null); }
        });

    try {
      // 1. Stop the recorder and get the finalized blob of THIS session
      let blob = passedBlob || null;
      if (!blob) {
        try {
          blob = await captureEngineRef.current.stop();
        } catch (stopErr: any) {
          console.error('[SmoothStudio] Recorder reported a failure:', stopErr);
          showToast({
            type: 'error',
            title: 'Recording Failed',
            message: stopErr?.message || 'Recording failed: no video was captured.'
          });
          dispatchLoad({ type: 'fail', loadId: stopLoadId, message: stopErr?.message || 'Recording failed: no video was captured.' });
          return;
        }
      }

      // 2. Telemetry of THIS session only (never a previous recording's)
      let tel = latestTelemetryRef.current || (await telemetryFromSw);
      if (!tel) tel = latestTelemetryRef.current || (sessionId ? await loadTelemetry(sessionId) : null);

      const measuredDur = captureEngineRef.current.getDurationMs() || 10000;
      const trackSettings = captureEngineRef.current.getTrackSettings();
      const displaySurface = trackSettings?.displaySurface || tel?.metadata?.displaySurface || 'browser';
      const sid = sessionId || captureEngineRef.current.getSessionId() || newSessionId();

      // 3. Complete telemetry tagged with the session
      const finalTelemetry = withSession(tel, sid, measuredDur, displaySurface, captureEngineRef.current.getCapturedNativeCursor());
      await saveTelemetry(finalTelemetry).catch((e) => console.warn('[SmoothStudio] Could not persist telemetry:', e));

      if (blob && blob.size > 0) {
        console.log('[SmoothStudio] Recording stopped successfully. Finalizing editor with blob size:', blob.size, 'duration:', measuredDur);
        const loaded = await setupLoadedRecording(blob, finalTelemetry, measuredDur, sid);
        if (loaded) {
          showToast({
            type: 'success',
            title: 'Recording Loaded',
            message: `Recording ready (${(measuredDur / 1000).toFixed(1)}s).`
          });
        }
      } else {
        console.warn('[SmoothStudio] Finished recording but no video frames were captured.');
        showToast({
          type: 'error',
          title: 'Recording Failed',
          message: 'Recording failed: no video was captured. The display capture stream produced zero encoded frames.'
        });
        dispatchLoad({ type: 'fail', loadId: stopLoadId, message: 'No video was captured.' });
      }
    } catch (err: any) {
      console.error('[SmoothStudio] Error during stop processing:', err);
      dispatchLoad({ type: 'fail', loadId: stopLoadId, message: err?.message || 'Error loading recording into editor.' });
      showToast({
        type: 'error',
        title: 'Stop Recording Failed',
        message: err?.message || 'Error loading recording into editor.'
      });
    } finally {
      keepaliveStateRef.current?.stopFastPing();
      latestTelemetryRef.current = null;
      sendRecording('stopped');
    }
  };

  // Keep the latest stop handler in the ref so the message listener never uses a stale closure
  useEffect(() => {
    handleStopLiveRecordingRef.current = handleStopLiveRecording;
    handleStartLiveRecordingRef.current = handleStartLiveRecording;
  });

  const handleUpdatePill = (updated: ZoomPill) => {
    // An auto zoom the user changed keeps its own settings when the auto zooms are rebuilt.
    setPills((prev) => prev.map((p) => (p.id === updated.id ? (p.autoGenerated ? { ...updated, editedByUser: true } : updated) : p)));
  };

  const handleDeletePill = (id: string) => {
    setPills((prev) => prev.filter((p) => p.id !== id));
    if (selectedPillId === id) setSelectedPillId(null);
  };

  /**
   * Rebuilds the auto zooms with these settings. Zooms added by hand and auto zooms the
   * user edited are kept; a rebuilt auto zoom that overlaps an edited one is dropped
   * (it is the same click).
   */
  const applyAutoZoom = (settings: AutoZoomSettings) => {
    if (!telemetry) return;
    const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
    const autoPills = buildAutoZoomPills(telemetry, safeDuration, settings);
    setPills((prev) => {
      const kept = prev.filter((p) => !p.autoGenerated || p.editedByUser);
      const edited = kept.filter((p) => p.editedByUser);
      const fresh = autoPills.filter((a) => !edited.some((e) => a.startTime < e.endTime && e.startTime < a.endTime));
      const next = [...kept, ...fresh].sort((a, b) => a.startTime - b.startTime);
      if (selectedPillId && !next.some((p) => p.id === selectedPillId)) setSelectedPillId(null);
      return next;
    });
  };

  const handleRedetectZooms = () => {
    if (!telemetry) return;
    if (!canAutoZoom(telemetry)) {
      showToast({
        type: 'info',
        title: 'Manual zoom only',
        message: 'This window or screen recording does not show the recorded page where SmoothStudio expected it. Add zooms by hand.'
      });
      return;
    }
    applyAutoZoom(autoZoomSettings);
  };

  const handleChangeAutoZoom = (change: Partial<AutoZoomSettings>) => {
    const settings = { ...autoZoomSettings, ...change };
    setAutoZoomSettings(settings);
    applyAutoZoom(settings);
  };

  // Timeline seek: reset SFX dedup so re-scrubbing can re-arm event triggers
  const handleSeek = (timeMs: number) => {
    firedSfxRef.current.clear();
    const safeTrimStart = Math.max(0, Math.min(durationMs, trimStartMs));
    const safeTrimEnd = Math.max(safeTrimStart, Math.min(durationMs, trimEndMs > 0 ? trimEndMs : durationMs));
    const clamped = Math.max(safeTrimStart, Math.min(safeTrimEnd, timeMs));
    seekPlayhead(clamped);
  };

  const handleCutAllSilences = () => {
    setSilences((prev) => prev.map((s) => ({ ...s, markedForCut: true })));
  };

  const handleToggleSilenceCut = (id: string) => {
    setSilences((prev) => prev.map((s) => (s.id === id ? { ...s, markedForCut: !s.markedForCut } : s)));
  };

  // Caption Manipulations
  const handleAddCaptionAtPlayhead = () => {
    const start = Math.max(0, currentTimeMs - 100);
    const end = Math.min(durationMs, currentTimeMs + 2500);
    // No pre-filled caption text: the operator types the real transcription.
    const text = '';
    const words: CaptionWord[] = [];
    const newCaption: CaptionBlock = {
      id: 'cap_' + Date.now(),
      startTime: start,
      endTime: end,
      text,
      words
    };
    setCaptions((prev) => [...prev, newCaption].sort((a, b) => a.startTime - b.startTime));
  };

  const handleUpdateCaption = (updated: CaptionBlock) => {
    setCaptions((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDeleteCaption = (id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
  };

  // MULTI-FORMAT ASSET EXPORTS (MP4, GIF, Notion SOP, Interactive HTML)

  const sourceWidth = (videoElement instanceof HTMLVideoElement && videoElement.videoWidth > 0)
    ? videoElement.videoWidth
    : (telemetry?.metadata?.width || 1920);
  const sourceHeight = (videoElement instanceof HTMLVideoElement && videoElement.videoHeight > 0)
    ? videoElement.videoHeight
    : (telemetry?.metadata?.height || 1080);

  const getResLabel = (w: number, h: number) => {
    if (w >= 3840 || h >= 2160) return '4K';
    if (w >= 2560 || h >= 1440) return '1440p';
    if (w >= 1920 || h >= 1080) return '1080p';
    if (w >= 1280 || h >= 720) return '720p';
    return `${w}x${h}`;
  };

  const sourceResLabel = getResLabel(sourceWidth, sourceHeight);

  let targetExportWidth = sourceWidth;
  let targetResLabel = sourceResLabel;
  if (exportResPreset === '4k') {
    targetExportWidth = 3840;
    targetResLabel = '4K';
  } else if (exportResPreset === '1080p') {
    targetExportWidth = 1920;
    targetResLabel = '1080p';
  } else if (exportResPreset === '720p') {
    targetExportWidth = 1280;
    targetResLabel = '720p';
  } else {
    targetExportWidth = sourceWidth;
    targetResLabel = sourceResLabel;
  }

  const isUpscaled = targetExportWidth > sourceWidth;

  /** Claims the source video for one export; false when it cannot run now. */
  const beginExport = (job: ExportJob): boolean => {
    if (exportJobRef.current) {
      showToast({ type: 'info', title: 'Export in progress', message: 'Wait for the current export to finish, or cancel it.' });
      return false;
    }
    if (recordingRef.current !== 'idle') {
      showToast({ type: 'info', title: 'Recording in progress', message: 'Stop the recording before exporting.' });
      return false;
    }
    if (load.phase !== 'ready') return false;
    exportJobRef.current = job;
    setIsPlaying(false);
    return true;
  };
  const endExport = (job: ExportJob) => {
    if (exportJobRef.current === job) exportJobRef.current = null;
  };

  // 1. Hardware 60fps MP4 Export (with safe fail-over path to client WebM)
  const handleExportMp4 = async () => {
    if (!videoElement) return;
    if (!beginExport('mp4')) return;

    // Safe Fail-over Path: If user downgraded encoder stream, download pure client WebM directly
    if (encoderStreamMode === 'client-webm') {
      const blobToDownload = videoBlob || (await getRecordingBlob());
      if (blobToDownload) {
        const url = URL.createObjectURL(blobToDownload);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${telemetry?.metadata.title || 'SmoothStudio'}_Raw_Stream.webm`;
        a.click();
        scheduleObjectUrlRevoke(url);
        setExportComplete(true);
        setIsExporting(false);
        endExport('mp4');
        showToast({
          type: 'success',
          title: 'Pure WebM Export Complete',
          message: 'Client-side WebM recording stream downloaded directly (GPU encoder bypassed).'
        });
        return;
      }
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportComplete(false);
    const abortController = new AbortController();
    exportAbortRef.current = abortController;
    let encoderInfo: ExportEncoderInfo | null = null;

    try {
      const exporter = new HardwareMp4Exporter();
      const mp4Blob = await exporter.exportMp4({
        signal: abortController.signal,
        onEncoderSelected: (info) => { encoderInfo = info; },
        videoSource: videoElement,
        videoBlob,
        durationMs,
        aspectRatio,
        preset,
        pills,
        silences,
        cursorEngine: cursorEngineRef.current,
        keystrokes: telemetry?.keystrokes || [],
        cutSilences: autoCutSilences && silences.some((s) => s.markedForCut),
        showSpotlight,
        showCursor,
        showHud,
        metadata: telemetry?.metadata,
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
        trimStartMs: trimStartMs > 0 ? trimStartMs : undefined,
        trimEndMs: trimEndMs > 0 && trimEndMs < durationMs ? trimEndMs : undefined,
        framePadding,
        background,
        framingMode,
        shadowMode,
        targetWidth: targetExportWidth,
        followCursor,
        mediaDurationMs: mediaDurationRef.current ?? undefined,
        onProgress: (pct) => setExportProgress(pct)
      });

      HardwareMp4Exporter.downloadBlob(mp4Blob, `${telemetry?.metadata.title || 'SmoothStudio'}_Cinematic.mp4`);
      setExportComplete(true);
      showToast({
        type: 'success',
        title: 'MP4 Exported',
        message: describeMp4Export(encoderInfo, {
          requestedLabel: targetResLabel,
          sourceLabel: sourceResLabel,
          upscaled: isUpscaled
        })
      });
    } catch (err: any) {
      if (isExportAbortError(err)) {
        // The user pressed Cancel: not a failure, nothing to report as an error.
        setExportComplete(false);
        showToast({ type: 'info', title: 'Export Cancelled', message: 'The MP4 export was cancelled. Nothing was downloaded.' });
      } else {
        console.error('MP4 export failed:', err);
        diagnosticChannel.recordFrameDrop(err?.message || 'VideoEncoder runtime error during export');
        showToast({ type: 'error', title: 'MP4 Export Failed', message: err?.message || 'VideoEncoder error' });
      }
    } finally {
      if (exportAbortRef.current === abortController) exportAbortRef.current = null;
      setIsExporting(false);
      setExportProgress(0);
      endExport('mp4');
    }
  };

  // 2. Hardware 20fps GIF Export
  const handleExportGif = async () => {
    if (!videoElement) return;
    if (!beginExport('gif')) return;
    setIsExportingGif(true);
    setExportGifProgress(0);
    setExportGifComplete(false);

    const gifAbortController = new AbortController();
    exportAbortRef.current = gifAbortController;
    try {
      const exporter = new HardwareGifExporter();
      const config = GIF_QUALITY_PRESETS[gifPreset] || GIF_QUALITY_PRESETS.compact;
      const gifBlob = await exporter.exportGif({
        signal: gifAbortController.signal,
        followCursor,
        videoSource: videoElement,
        videoBlob: videoBlob ?? undefined,
        durationMs,
        aspectRatio,
        preset,
        pills,
        silences,
        cursorEngine: cursorEngineRef.current,
        keystrokes: telemetry?.keystrokes || [],
        cutSilences: autoCutSilences && silences.some((s) => s.markedForCut),
        showSpotlight,
        showCursor,
        showHud,
        metadata: telemetry?.metadata,
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
        trimStartMs: trimStartMs > 0 ? trimStartMs : undefined,
        trimEndMs: trimEndMs > 0 && trimEndMs < durationMs ? trimEndMs : undefined,
        framePadding,
        background,
        framingMode,
        shadowMode,
        qualityPreset: gifPreset,
        fps: config.fps,
        maxDimension: config.maxDimension,
        maxColors: config.maxColors,
        onProgress: (pct) => setExportGifProgress(pct)
      });

      HardwareGifExporter.downloadBlob(gifBlob, `${telemetry?.metadata.title || 'SmoothStudio'}_Loop.gif`);
      setExportGifComplete(true);
      showToast({ type: 'success', title: 'GIF Exported', message: 'Looping animated GIF downloaded.' });
    } catch (err: any) {
      if (isExportAbortError(err)) {
        setExportGifComplete(false);
        showToast({ type: 'info', title: 'Export Cancelled', message: 'The GIF export was cancelled. Nothing was downloaded.' });
      } else {
        console.error('GIF export failed:', err);
        showToast({ type: 'error', title: 'GIF Export Failed', message: err?.message || 'GIF encoder error' });
      }
    } finally {
      if (exportAbortRef.current === gifAbortController) exportAbortRef.current = null;
      setIsExportingGif(false);
      setExportGifProgress(0);
      endExport('gif');
    }
  };

  const handleCancelExport = () => {
    exportAbortRef.current?.abort();
  };

  // What the user kept of the recording. The SOP guide and the HTML widget list
  // steps, so they follow the same trim window and silence cuts as the video.
  const buildExportTimelineWindow = () => ({
    durationMs,
    trimStartMs: trimStartMs > 0 ? trimStartMs : undefined,
    trimEndMs: trimEndMs > 0 && trimEndMs < durationMs ? trimEndMs : undefined,
    cutRanges: autoCutSilences
      ? silences.filter((silence) => silence.markedForCut).map((silence) => ({ startTime: silence.startTime, endTime: silence.endTime }))
      : []
  });

  // 2. Step-by-Step Markdown / Notion SOP Guide Export
  const handleExportSopGuide = () => {
    if (!telemetry) return;
    const md = SopGuideExporter.generateMarkdownGuide(telemetry, captureEngineRef.current.getSnapshots(), true, buildExportTimelineWindow());
    SopGuideExporter.downloadMarkdown(md, `${telemetry.metadata.title || 'SOP'}_Guide.md`);
    showToast({ type: 'success', title: 'SOP Guide Exported', message: 'Markdown guide downloaded.' });
  };

  const handleCopySopGuide = async () => {
    if (!telemetry) return;
    try {
      const md = SopGuideExporter.generateMarkdownGuide(telemetry, captureEngineRef.current.getSnapshots(), true, buildExportTimelineWindow());
      await navigator.clipboard.writeText(md);
      setCopiedSop(true);
      showToast({ type: 'success', title: 'SOP Copied', message: 'Markdown documentation copied to clipboard.' });
      setTimeout(() => setCopiedSop(false), 2200);
    } catch {
      handleExportSopGuide();
    }
  };

  // 3. Interactive HTML Click-Through Widget Export
  const handleExportInteractiveWidget = () => {
    if (!telemetry) return;
    const html = HtmlWidgetExporter.generateInteractiveWidget(
      telemetry,
      captureEngineRef.current.getSnapshots(),
      true,
      buildExportTimelineWindow()
    );
    HtmlWidgetExporter.downloadWidget(html, `${telemetry.metadata.title || 'Walkthrough'}_Interactive.html`);
    showToast({ type: 'success', title: 'HTML Widget Exported', message: 'Interactive walkthrough downloaded.' });
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0B0C10] text-[#F3F4F6] font-sans overflow-hidden select-none">
      {/* Top Studio Header */}
      <header className="h-14 bg-[#14161D] border-b border-white/10 px-5 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/25">
            <Video className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              SmoothStudio <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-mono">v1.0 Pro</span>
            </h1>
            <p className="text-[11px] text-gray-400">
              {telemetry?.metadata.title || 'Cinematic 3D Video Studio'} • 60 FPS Canvas 2D
            </p>
          </div>
        </div>

        {/* Live Recording Switcher */}
        <div className="flex items-center gap-2">
          {isRecordingLive ? (
            <button
              id="stop-live-recording-top-btn"
              onClick={() => handleStopLiveRecording()}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center gap-2 shadow-lg shadow-red-600/30 animate-pulse"
            >
              <div className="w-2 h-2 rounded-sm bg-white" />
              Stop Live Recording
            </button>
          ) : (
            <button
              id="record-new-screen-top-btn"
              onClick={() => handleStartLiveRecording()}
              disabled={recordingPhase !== 'idle' || isExporting || isExportingGif || load.phase === 'loading'}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CircleDot className="w-3.5 h-3.5 text-red-400" />
              {recordingPhase === 'starting' ? 'Starting…' : recordingPhase === 'stopping' ? 'Stopping…' : 'Record New Screen'}
            </button>
          )}

          <button
            onClick={() => setShowDoctor(true)}
            className="px-3 py-1.5 rounded-lg bg-purple-600/10 hover:bg-purple-600/20 text-purple-300 text-xs font-medium flex items-center gap-1.5 border border-purple-500/20 transition-colors"
            title="Flight Doctor & Live Diagnostics (Ctrl+Shift+D)"
          >
            <Activity className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
            Flight Doctor
          </button>

          {/* Active Triage Recovery & Fail-Over Indicators */}
          {activeDegradation && (
            <button
              onClick={() => setActiveDegradation((prev) => prev || diagnosticChannel.getActiveDegradations()[0] || null)}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-1.5 border border-amber-500/40 animate-pulse transition-all shadow-md shadow-amber-500/10"
              title="System degradation detected. Click to inspect recovery triage panel."
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Triage Recovery
            </button>
          )}

          {storageMode === 'ram' && (
            <span
              className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono flex items-center gap-1"
              title="RAM Fallback Buffer active (bypassing disk OPFS)"
            >
              <HardDrive className="w-3 h-3 text-emerald-400" />
              RAM Buffer
            </span>
          )}

          {encoderStreamMode === 'client-webm' && (
            <span
              className="px-2 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-mono flex items-center gap-1"
              title="Client-side WebM active (GPU hardware encoder bypassed)"
            >
              <Cpu className="w-3 h-3 text-sky-400" />
              WebM Stream
            </span>
          )}
        </div>

        {/* 3-in-1 Export Multi-Format Action Buttons */}
        <div className="flex items-center gap-2">
          {/* SOP Markdown Guide & Copy */}
          <div className="flex items-center rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <button
              onClick={handleExportSopGuide}
              className="px-3 py-1.5 hover:bg-white/10 text-gray-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Download Step-by-Step Markdown SOP guide with screenshots"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              SOP Guide (.md)
            </button>
            <div className="w-[1px] h-4 bg-white/15" />
            <button
              onClick={handleCopySopGuide}
              className="px-2.5 py-1.5 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1 transition-colors"
              title="Copy SOP markdown formatted for Notion & Obsidian"
            >
              {copiedSop ? (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Copied!
                </span>
              ) : (
                'Copy'
              )}
            </button>
          </div>

          {/* Interactive HTML Widget */}
          <button
            onClick={handleExportInteractiveWidget}
            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 text-xs font-medium flex items-center gap-1.5 border border-white/10 transition-colors"
            title="Export standalone HTML click-through walkthrough widget"
          >
            <MousePointerClick className="w-3.5 h-3.5 text-indigo-400" />
            HTML Widget
          </button>

          {/* Hardware GIF Exporter */}
          <button
            onClick={handleExportGif}
            disabled={isExportingGif || isExporting}
            className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-purple-200 text-xs font-medium flex items-center gap-1.5 border border-purple-500/30 transition-all disabled:opacity-50"
            title="Export animated lightweight GIF"
          >
            {isExportingGif ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                GIF {exportGifProgress}%
              </>
            ) : exportGifComplete ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                Exported GIF!
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                Export GIF
              </>
            )}
          </button>

          {/* GIF Quality Preset Selector */}
          <select
            id="gif-preset-select"
            value={gifPreset}
            onChange={(e) => setGifPreset(e.target.value as GifQualityPreset)}
            disabled={isExporting || isExportingGif}
            className="px-2 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-purple-200 text-xs font-medium border border-purple-500/30 focus:outline-none focus:border-purple-400 cursor-pointer disabled:opacity-50"
            title="GIF Quality Preset"
          >
            <option value="compact" className="bg-[#14161D] text-white">
              GIF: Compact (&lt;5 MB)
            </option>
            <option value="web" className="bg-[#14161D] text-white">
              GIF: Web (720p / 15fps)
            </option>
            <option value="high" className="bg-[#14161D] text-white">
              GIF: High (840px / 20fps)
            </option>
          </select>

          {/* Resolution Selector Dropdown with Honest Labels */}
          <select
            id="export-resolution-select"
            value={exportResPreset}
            onChange={(e) => setExportResPreset(e.target.value as any)}
            disabled={isExporting || isExportingGif}
            className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 text-xs font-medium border border-white/10 focus:outline-none focus:border-purple-500 cursor-pointer disabled:opacity-50"
            title="Export Resolution"
          >
            <option value="source" className="bg-[#14161D] text-white">
              {sourceResLabel} (Source Default)
            </option>
            <option value="1080p" className="bg-[#14161D] text-white">
              1080p {1920 > sourceWidth ? `(Upscaled from ${sourceResLabel})` : ''}
            </option>
            <option value="4k" className="bg-[#14161D] text-white">
              4K {3840 > sourceWidth ? `(Upscaled from ${sourceResLabel})` : ''}
            </option>
            <option value="720p" className="bg-[#14161D] text-white">
              720p {1280 > sourceWidth ? `(Upscaled from ${sourceResLabel})` : ''}
            </option>
          </select>

          {(isExporting || isExportingGif) && (
            <button
              id="cancel-export-btn"
              onClick={handleCancelExport}
              className="px-3.5 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-200 text-xs font-medium flex items-center gap-1.5 border border-red-500/40 transition-colors"
              title="Cancel the running export"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel export
            </button>
          )}

          {/* Hardware MP4 Exporter */}
          <button
            id="export-mp4-btn"
            onClick={handleExportMp4}
            disabled={isExporting || isExportingGif}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-medium flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Encoding {exportProgress}%
              </>
            ) : exportComplete ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                Exported MP4!
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                {isUpscaled
                  ? `Export ${targetResLabel}/60fps (Upscaled from ${sourceResLabel})`
                  : `Export ${targetResLabel}/60fps MP4`}
              </>
            )}
          </button>
        </div>
      </header>
      {micWarning && (
        <div id="mic-warning-banner" className="bg-amber-500/20 border-b border-amber-500/30 px-5 py-2 flex items-center justify-between text-xs text-amber-200 z-30 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span><strong>Microphone not recorded:</strong> {micWarning}</span>
          </div>
          <button
            id="dismiss-mic-warning-btn"
            onClick={() => setMicWarning(null)}
            className="text-amber-400 hover:text-white px-2 py-0.5 rounded transition-colors text-xs font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Studio Body: Sidebar + Center Canvas */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left Vibe Presets & Controls */}
        <VibePresetsPanel
          currentPreset={preset}
          onSelectPreset={handleSelectPreset}
          aspectRatio={aspectRatio}
          onChangeAspectRatio={handleChangeAspectRatio}
          framingMode={framingMode}
          onChangeFramingMode={setFramingMode}
          shadowMode={shadowMode}
          onChangeShadowMode={setShadowMode}
          metadata={telemetry?.metadata}
          backdropParams={backdropParams}
          onChangeBackdropParams={handleUpdateBackdropParams}
          showSpotlight={showSpotlight}
          onToggleSpotlight={setShowSpotlight}
          showCursor={showCursor}
          onToggleCursor={setShowCursor}
          showHud={showHud}
          onToggleHud={setShowHud}
          followCursor={followCursor}
          onToggleFollowCursor={setFollowCursor}
          soundEnabled={soundEnabled}
          onToggleSound={setSoundEnabled}
          autoCutSilences={autoCutSilences}
          onToggleAutoCutSilences={setAutoCutSilences}
          onUpdatePresetBorderRadius={(r) => setPreset((p) => ({ ...p, borderRadius: r }))}
          cursorTheme={cursorTheme}
          onChangeCursorTheme={setCursorTheme}
          cursorScale={cursorScale}
          onChangeCursorScale={setCursorScale}
           cursorSmoothing={cursorSmoothing}
           onChangeCursorSmoothing={setCursorSmoothing}
           cursorMotion={cursorMotion}
           onChangeCursorMotion={handleChangeCursorMotion}
           capturedNativeCursor={telemetry?.metadata?.capturedNativeCursor}
          showCaptions={showCaptions}
          onToggleCaptions={setShowCaptions}
          captionStyle={captionStyle}
          onChangeCaptionStyle={setCaptionStyle}
          captionBackdrop={captionBackdrop}
          onChangeCaptionBackdrop={setCaptionBackdrop}
          showIntroCard={showIntroCard}
          onToggleIntroCard={setShowIntroCard}
          introHeadline={introHeadline}
          onChangeIntroHeadline={setIntroHeadline}
          introSubheadline={introSubheadline}
          onChangeIntroSubheadline={setIntroSubheadline}
          showOutroCard={showOutroCard}
          onToggleOutroCard={setShowOutroCard}
          outroHeadline={outroHeadline}
          onChangeOutroHeadline={setOutroHeadline}
          outroCtaText={outroCtaText}
          onChangeOutroCtaText={setOutroCtaText}
          framePadding={framePadding}
          onChangeFramePadding={setFramePadding}
          background={backgroundSpec}
          onChangeBackground={handleChangeBackground}
          backgroundEffects={backgroundEffects}
          onChangeBackgroundEffects={(change) => setBackgroundEffects((prev) => ({ ...prev, ...change }))}
          backgroundColor={backgroundColor}
          onSelectBackgroundColor={handleSelectBackgroundColor}
          backgroundImageUrl={backgroundImageUrl}
          onSelectBackgroundImage={handleSelectBackgroundImage}
          onBackgroundImageError={handleBackgroundImageError}
          onUploadBackgroundFile={handleUploadBackgroundFile}
          recentUploads={recentUploads}
          onSelectRecentUpload={handleSelectRecentUpload}
          onDeleteRecentUpload={handleDeleteRecentUpload}
        />
        {/* Center Canvas Preview Viewport */}
        <CanvasPreview
          video={videoElement}
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onRestart={handleRestart}
          pills={pills}
          selectedPillId={selectedPillId}
          onSelectPill={setSelectedPillId}
          onUpdatePill={handleUpdatePill}
          cursorEngine={cursorEngineRef.current}
          keystrokes={telemetry?.keystrokes || []}
          preset={preset}
          aspectRatio={aspectRatio}
           framingMode={framingMode}
          shadowMode={shadowMode}
          backdropParams={backdropParams}
          showSpotlight={showSpotlight}
          showCursor={showCursor}
          showHud={showHud}
          followCursor={followCursor}
          cameraCursorKey={`${cursorSmoothing}|${JSON.stringify(cursorMotion)}|${telemetry?.metadata?.id ?? ''}|${telemetry?.mousePoints?.length ?? 0}`}
          metadata={telemetry?.metadata}
          cursorTheme={cursorTheme}
          cursorScale={cursorScale}
          captions={captions}
          captionStyle={captionStyle}
          captionBackdrop={captionBackdrop}
          introHeadline={introHeadline}
          showIntroCard={showIntroCard}
          introSubheadline={introSubheadline}
          showOutroCard={showOutroCard}
          outroHeadline={outroHeadline}
          outroCtaText={outroCtaText}
          framePadding={framePadding}
          background={background}
          onCanvasClickToAddZoom={handleAddPillAtPlayhead}
          showCaptions={showCaptions}
        />

        {/* Record Prompt Dialog Overlay */}
        {showRecordPrompt && recordingPhase === 'idle' && (
          <div className="absolute inset-0 z-40 bg-[#0B0C10]/95 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mb-5 text-purple-400">
              <Video className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Ready to Record Screen</h2>
            <p className="text-sm text-gray-400 max-w-md mb-6">
              SmoothStudio is ready to capture high-definition 60 FPS video with 120 Hz DOM telemetry and cursor smoothing.
            </p>
            <button
              id="start-capture-prompt-btn"
              onClick={() => {
                setShowRecordPrompt(false);
                handleStartLiveRecording(recordTargetTabId, recordIncludeMic);
              }}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-purple-600 hover:from-red-500 hover:to-purple-500 text-white font-semibold text-sm flex items-center gap-2.5 shadow-xl shadow-red-600/30 transition-all cursor-pointer"
            >
              <CircleDot className="w-5 h-5 text-white animate-pulse" />
              Select Screen / Tab to Record
            </button>
          </div>
        )}

        {/* Empty State Overlay when No Recording Exists */}
        {hasNoRecording && !videoElement && recordingPhase === 'idle' && !showRecordPrompt && load.phase !== 'loading' && (
          <div className="absolute inset-0 z-30 bg-[#0B0C10]/95 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-5 text-red-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No Screen Recording Found</h2>
            <p className="text-sm text-gray-400 max-w-md mb-6">
              No recording was found in local storage. Start a new recording session to generate cinematic videos.
            </p>
            <button
              id="record-new-screen-empty-btn"
              onClick={() => handleStartLiveRecording(undefined, true)}
              className="px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
            >
              <CircleDot className="w-5 h-5 text-red-400" />
              Record New Screen
            </button>
          </div>
        )}

        {/* Loading: nothing is shown or playable until the recording is fully in sync */}
        {load.phase === 'loading' && (
          <div
            className="absolute inset-0 z-40 bg-[#0B0C10]/95 flex flex-col items-center justify-center p-6 text-center"
            role="status"
            aria-live="polite"
          >
            <div className="w-10 h-10 rounded-full border-2 border-purple-500/30 border-t-purple-400 animate-spin mb-5" />
            <h2 className="text-lg font-semibold text-white mb-4">Preparing your recording…</h2>
            <ol className="text-left space-y-1.5 text-sm">
              {LOAD_STEPS.map((item, index) => {
                const current = LOAD_STEPS.findIndex((s) => s.step === load.step);
                const status = index < current ? 'done' : index === current ? 'active' : 'todo';
                return (
                  <li
                    key={item.step}
                    className={`flex items-center gap-2 ${
                      status === 'done' ? 'text-gray-400' : status === 'active' ? 'text-white font-medium' : 'text-gray-600'
                    }`}
                  >
                    <span className={`w-4 text-center ${status === 'done' ? 'text-emerald-400' : status === 'active' ? 'text-purple-300' : ''}`}>
                      {status === 'done' ? '✓' : status === 'active' ? '●' : '○'}
                    </span>
                    {item.label}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {load.phase === 'failed' && !videoElement && (
          <div className="absolute inset-0 z-40 bg-[#0B0C10]/95 flex flex-col items-center justify-center p-6 text-center" role="alert">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4 text-red-400">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">The recording could not be loaded</h2>
            <p className="text-sm text-gray-400 max-w-md mb-5">{load.message}</p>
            <button
              onClick={() => { dispatchLoad({ type: 'reset' }); setHasNoRecording(true); }}
              className="px-5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Bottom Magnetic Pill Multi-Track Timeline (locked until the recording is in sync) */}
      <div
        className={load.phase === 'loading' || load.phase === 'failed' ? 'pointer-events-none opacity-40 transition-opacity' : 'transition-opacity'}
        aria-disabled={load.phase === 'loading' || load.phase === 'failed'}
      >
      <MagneticTimeline
        durationMs={durationMs}
        currentTimeMs={currentTimeMs}
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        trimStartMs={trimStartMs}
        trimEndMs={trimEndMs > 0 ? trimEndMs : durationMs}
        onUpdateTrim={handleUpdateTrim}
        onResetTrim={handleResetTrim}
        pills={pills}
        selectedPillId={selectedPillId}
        onSelectPill={setSelectedPillId}
        onRedetectZooms={handleRedetectZooms}
        autoZoom={autoZoomSettings}
        onChangeAutoZoom={handleChangeAutoZoom}
        recordedClickCount={telemetry ? (telemetry.clicks || []).length : undefined}
        onUpdatePill={handleUpdatePill}
        onDeletePill={handleDeletePill}
        sourcePixelWidth={resolveSourcePixelWidth(
          captureEngineRef.current.getTrackSettings()?.width,
          videoElement instanceof HTMLVideoElement ? videoElement.videoWidth : undefined,
          telemetry?.metadata
        )}
        onAddPillAtPlayhead={() => handleAddPillAtPlayhead()}
        silences={silences}
        onToggleSilenceCut={handleToggleSilenceCut}
        onCutAllSilences={handleCutAllSilences}
        autoCutSilences={autoCutSilences}
        onToggleAutoCutSilences={setAutoCutSilences}
        keystrokes={telemetry?.keystrokes || []}
        waveformPeaks={waveformPeaks}
        captions={captions}
        showCaptions={showCaptions}
        onAddCaptionAtPlayhead={handleAddCaptionAtPlayhead}
        onUpdateCaption={handleUpdateCaption}
        onDeleteCaption={handleDeleteCaption}
      />
      </div>

      {/* Flight Doctor Diagnostics Modal */}
      <DiagnosticsDoctor
        isOpen={showDoctor}
        onClose={() => setShowDoctor(false)}
        telemetry={telemetry}
        durationMs={durationMs}
        videoBlob={videoBlob}
      />

      {/* Visual Triage & Degradation Recovery Panel */}
      <DegradationTriagePanel
        activeDegradation={activeDegradation}
        onDismiss={() => setActiveDegradation(null)}
        storageMode={storageMode}
        onToggleRamFallback={handleToggleRamFallback}
        encoderStreamMode={encoderStreamMode}
        onDowngradeEncoderStream={handleDowngradeEncoderStream}
        onOpenFlightDoctor={() => setShowDoctor(true)}
      />

      {/* Real-Time Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
     </div>
   );
 }

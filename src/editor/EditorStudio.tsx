import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  BackdropMatrixParams
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { generateAutoZoomPills } from '../engine/spring-physics';
import { CursorSplineEngine } from '../engine/cursor-spline';
import { AudioProcessor } from '../engine/audio-processor';
import { SfxSynthesizer } from '../engine/sfx-synthesizer';
import { HardwareMp4Exporter } from '../engine/mp4-exporter';
import { HardwareGifExporter, GIF_QUALITY_PRESETS, GifQualityPreset } from '../engine/gif-exporter';
import { SopGuideExporter } from '../engine/sop-guide-exporter';
import { HtmlWidgetExporter } from '../engine/html-widget-exporter';
import { scheduleObjectUrlRevoke } from '../engine/export-safety';
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
  Cpu
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

export function EditorStudio() {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const latestTelemetryRef = useRef<TelemetryData | null>(null);
  /** Session id of the recording being made right now (M1-08). */
  const activeSessionIdRef = useRef<string | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | HTMLCanvasElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
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
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const backgroundImageUrlRef = useRef<string | null>(null);

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

  const handleSelectBackgroundImage = useCallback((url: string | null, image: HTMLImageElement | null) => {
    if (!url || !image) {
      clearBackgroundImage();
      return;
    }
    const previousUrl = backgroundImageUrlRef.current;
    backgroundImageUrlRef.current = url;
    setBackgroundImageUrl(url);
    setBackgroundImage(image);
    setBackgroundColor(null);
    if (previousUrl && previousUrl !== url && previousUrl.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
  }, [clearBackgroundImage]);

  const handleBackgroundImageError = useCallback((url: string) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    showToast({ type: 'error', title: 'Background Image Failed', message: 'The image could not be loaded; the previous background was kept.' });
  }, [showToast]);

  const handleSelectBackgroundColor = useCallback((color: string | null) => {
    if (color) clearBackgroundImage();
    setBackgroundColor(color);
  }, [clearBackgroundImage]);
  const [followCursor, setFollowCursor] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Cursor & Auto-Captions State
  const [cursorTheme, setCursorTheme] = useState<CursorTheme>('mac-obsidian');
  const [cursorScale, setCursorScale] = useState<number>(1.2);
  const [cursorSmoothing, setCursorSmoothing] = useState<number>(0.6);
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
  const [gifPreset, setGifPreset] = useState<GifQualityPreset>('compact');

  const [copiedSop, setCopiedSop] = useState<boolean>(false);
  const [isRecordingLive, setIsRecordingLive] = useState<boolean>(false);
  const [showRecordPrompt, setShowRecordPrompt] = useState<boolean>(false);
  const [recordTargetTabId, setRecordTargetTabId] = useState<number | undefined>(undefined);
  const [recordIncludeMic, setRecordIncludeMic] = useState<boolean>(true);
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
      trimEndMs
    });
  }, [autoCutSilences, cursorSmoothing, silences, trimEndMs, trimStartMs]);
  useEffect(() => {
    // Test hooks exist only in the Vite dev server. The `if` is dead-code
    // eliminated in production builds, so none of these globals ship.
    if (import.meta.env.DEV) {
      (window as any).__captureEngine = captureEngineRef.current;
      (window as any).__ScreenCaptureEngine = ScreenCaptureEngine;
      (window as any).__SopGuideExporter = SopGuideExporter;
      (window as any).__HtmlWidgetExporter = HtmlWidgetExporter;
      (window as any).__HardwareMp4Exporter = HardwareMp4Exporter;
      (window as any).__HardwareGifExporter = HardwareGifExporter;
      (window as any).__GIF_QUALITY_PRESETS = GIF_QUALITY_PRESETS;
      (window as any).__VIBE_PRESETS = VIBE_PRESETS;
      (window as any).__AudioProcessor = AudioProcessor;
      // Programmatic capture hooks: they allow starting/stopping a recording
      // without moving keyboard focus to the editor window (focus changes would
      // otherwise pause the compositor of the captured surface).
      (window as any).__startLiveRecording = (sourceTabId?: number, includeMic = true) =>
        handleStartLiveRecordingRef.current?.(sourceTabId, includeMic);
      (window as any).__stopLiveRecording = (tel?: any, blob?: any) =>
        handleStopLiveRecordingRef.current?.(tel, blob);
    }
  }, []);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  // Deduplicates procedural SFX so a single click/keystroke/zoom event never
  // fires more than once across adjacent animation frames.
  const firedSfxRef = useRef<Set<string>>(new Set());
  const currentTimeRef = useRef<number>(0);
  const handleStopLiveRecordingRef = useRef<((passedTelemetry?: TelemetryData | null, passedBlob?: Blob | null) => Promise<void>) | null>(null);
  const handleStartLiveRecordingRef = useRef<((sourceTabId?: number, includeMic?: boolean) => Promise<void>) | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const hasFinalizedRef = useRef<boolean>(false);
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
            // Reconnect so the SW stays awake across restarts during stop/commit.
            if (!isStoppingRef.current) connectKeepalive();
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

  const setupLoadedRecording = (blob: Blob, data: TelemetryData, measuredDurationMs?: number, sessionId?: string | null) => {
    firedSfxRef.current.clear();
    setVideoBlob(blob);
    setTelemetry(data);
    if (import.meta.env.DEV) (window as any).__lastLoadedTelemetry = data;

    // Compute safe, finite duration fallback
    const safeDuration = (measuredDurationMs && measuredDurationMs > 0)
      ? measuredDurationMs
      : (data.metadata?.durationMs && data.metadata.durationMs > 0 ? data.metadata.durationMs : 10000);
    setDurationMs(safeDuration);
    setTrimStartMs(0);
    setTrimEndMs(safeDuration);

    // Revoke previous object URL if any, preserving the currently active one
    const newObjectUrl = URL.createObjectURL(blob);
    if (prevBlobUrlRef.current && prevBlobUrlRef.current !== newObjectUrl) {
      URL.revokeObjectURL(prevBlobUrlRef.current);
    }
    prevBlobUrlRef.current = currentBlobUrlRef.current;
    currentBlobUrlRef.current = newObjectUrl;

    const video = document.createElement('video');
    video.src = newObjectUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    // Mount video element in DOM so standard element queries (e.g. document.querySelector('video')) and browser decoders resolve it
    const existingVideo = document.getElementById('smoothstudio-source-video');
    if (existingVideo) existingVideo.remove();
    video.id = 'smoothstudio-source-video';
    const loadedSid = sessionId || data.metadata?.sessionId || null;
    if (loadedSid) video.setAttribute('data-session-id', loadedSid);
    video.style.cssText = 'position: fixed; bottom: 0; right: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; z-index: -1;';
    document.body.appendChild(video);
    if (import.meta.env.DEV) {
      (window as any).__smoothstudio_video = video;
      (window as any).__lastLoadedVideoBlob = blob;
      (window as any).__lastLoadedVideoElement = video;
    }

    video.addEventListener('play', () => setIsPlaying(true));
    video.addEventListener('pause', () => setIsPlaying(false));
    const markReady = () => {
      video.setAttribute('data-ready', 'true');
    };
    video.addEventListener('loadeddata', markReady);
    video.addEventListener('canplay', markReady);

    video.onloadedmetadata = () => {
      // Read the REAL container duration before anything overrides it. The
      // container's duration is the authoritative media length: it includes the
      // audio tail when the audio track outlives the last video frame (QA-002).
      const realDurMs = Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000)
        : null;
      mediaDurationRef.current = realDurMs;

      let resolvedDur = safeDuration;
      // Guard against Chrome MediaRecorder WebM bug where video.duration === Infinity or NaN
      if (realDurMs !== null) {
        resolvedDur = Math.max(realDurMs, safeDuration);
      } else {
        // Chrome WebM duration bug workaround: seek near end and reset to 0 to force duration calculation
        try {
          video.currentTime = 1e101;
          video.ontimeupdate = () => {
            video.ontimeupdate = null;
            video.currentTime = 0;
          };
        } catch {}
      }
      // The UI timeline and the exporter must agree on the media length. Keep a
      // finite duration for the many `video.duration` readers in the editor.
      try {
        Object.defineProperty(video, 'duration', {
          get: () => resolvedDur / 1000,
          configurable: true
        });
      } catch {}
      console.log('[SmoothStudio] Video element metadata loaded. Duration:', resolvedDur, 'container:', realDurMs, 'Dimensions:', video.videoWidth, 'x', video.videoHeight);
      setDurationMs(resolvedDur);
      setTrimEndMs((prev) => (prev === 0 || prev > resolvedDur ? resolvedDur : prev));
      setVideoElement(video);
      // Nudge Chromium video decoder to decode the first frame so readyState advances to HAVE_CURRENT_DATA (2) / HAVE_ENOUGH_DATA (4)
      try {
        video.currentTime = 0.001;
      } catch {}
    };

    video.onerror = (err) => {
      console.error('[SmoothStudio] Video element failed to load recording blob URL:', newObjectUrl, err);
      showToast({
        type: 'error',
        title: 'Video Stream Error',
        message: 'Could not decode recorded WebM video stream in browser.'
      });
    };

    // Initiate frame decoding
    try { video.load(); } catch {}

    // Fallback: if onloadedmetadata hasn't fired after 250ms, ensure videoElement is set
    setTimeout(() => {
      setVideoElement((curr) => curr || video);
      try { video.currentTime = 0.001; } catch {}
    }, 300);

    cursorEngineRef.current.setData(data.mousePoints || [], data.clicks || [], data.pressEvents || []);

    const displaySurface = data.metadata?.displaySurface || captureEngineRef.current.getTrackSettings()?.displaySurface;
    const isPageCapture = displaySurface !== 'window' && displaySurface !== 'monitor';

    // DOM coordinates are meaningful only for a browser-tab capture. A
    // window/monitor frame has a different coordinate space, so only manual
    // canvas zooms are offered for that recording.
    const autoPills = isPageCapture ? generateAutoZoomPills(
        data.clicks || [],
        data.inputEvents || [],
        safeDuration,
        data.metadata?.width || 1920,
        data.metadata?.height || 1080,
        data.scrollEvents,
        data.typingSessions
      ) : [];
    setPills(autoPills);
    if (import.meta.env.DEV) (window as any).__smoothstudio_pills = autoPills;

    // Captions are only ever sourced from a REAL transcription supplied with the
    // recording. Nothing is invented: without transcription there are no
    // captions at all.
    setCaptions(data.captions && data.captions.length > 0 ? data.captions : []);

    // Build the timeline waveform from the REAL audio track of the recording.
    // Without an audio track the timeline renders "NO AUDIO" instead of bars.
    audioProcessorRef.current
      .buildWaveformPeaks(blob, 160)
      .then((peaks) => setWaveformPeaks(peaks))
      .catch((err) => {
        console.warn('[SmoothStudio] Waveform extraction failed:', err);
        setWaveformPeaks([]);
      });

    // Analyze silences safely wrapped in try/catch
    try {
      audioProcessorRef.current
        .analyzeSilences(blob, data.clicks || [], data.keystrokes || [], -42, 1200, safeDuration)
        .then((detected) => setSilences(detected))
        .catch((err) => {
          console.warn('[SmoothStudio] Silence analysis error caught in setupLoadedRecording:', err);
        });
    } catch (err) {
      console.warn('[SmoothStudio] Audio processor initiation error caught:', err);
    }
    // Configure cursor visibility from the actual captured track setting, with a
    // conservative window/monitor fallback when DOM telemetry is unavailable.
    const capturedNativeCursor = data.metadata?.capturedNativeCursor || captureEngineRef.current.getCapturedNativeCursor();
    const hasDomCursorTelemetry = (data.mousePoints || []).some((point) => Boolean(point.c));
    setShowCursor(shouldEnableCustomCursor(capturedNativeCursor, displaySurface, hasDomCursorTelemetry));
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

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const nextPlaying = !prev;
      if (nextPlaying) {
        const safeDur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
        const safeTrimStart = Math.max(0, Math.min(safeDur, trimStartMs));
        const safeTrimEnd = Math.max(safeTrimStart, Math.min(safeDur, trimEndMs > 0 ? trimEndMs : safeDur));
        if (currentTimeRef.current >= safeTrimEnd || currentTimeRef.current < safeTrimStart) {
          currentTimeRef.current = safeTrimStart;
          setCurrentTimeMs(safeTrimStart);
          if (videoElement instanceof HTMLVideoElement) {
            videoElement.currentTime = safeTrimStart / 1000;
          }
        }
      }
      return nextPlaying;
    });
  }, [durationMs, trimStartMs, trimEndMs, videoElement]);

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

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__setupLoadedRecording = setupLoadedRecording;
      (window as any).__setSilences = setSilences;
      (window as any).__silences = silences;
      (window as any).__autoCutSilences = autoCutSilences;
      (window as any).__setAutoCutSilences = setAutoCutSilences;
      (window as any).__durationMs = durationMs;
      (window as any).__captions = captions;
      (window as any).__trimStartMs = trimStartMs;
      (window as any).__trimEndMs = trimEndMs;
      (window as any).__setTrim = (start: number, end: number) => handleUpdateTrim(start, end);
    }
  });

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

      if (next < safeTrimStart) {
        next = safeTrimStart;
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
  }, [isPlaying, durationMs, trimStartMs, trimEndMs, soundEnabled, telemetry, pills, silences, autoCutSilences, showOutroCard]);

  // Timeline Interactions
  const handleAddPillAtPlayhead = useCallback((targetX = 0.5, targetY = 0.5) => {
    const playhead = currentTimeRef.current;
    const newPill: ZoomPill = {
      id: 'pill_' + Date.now(),
      startTime: Math.max(0, playhead - 200),
      endTime: Math.min(durationMs, playhead + 2400),
      targetX,
      targetY,
      targetScale: 1.8,
      tiltX: targetX > 0.5 ? -4 : 4,
      tiltY: targetX > 0.5 ? 6 : -6,
      spotlight: true,
      label: 'Custom Zoom'
    };
    setPills((prev) => [...prev, newPill].sort((a, b) => a.startTime - b.startTime));
  }, [durationMs]);

  const handleSelectPreset = useCallback((newPreset: VibePreset) => {
    setPreset(newPreset);
    clearBackgroundImage();
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

  // Keyboard shortcuts: Space (play/pause), ArrowLeft/Right (seek), Z (add zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        firedSfxRef.current.clear();
        const safeTrimStart = Math.max(0, Math.min(durationMs, trimStartMs));
        setCurrentTimeMs((t) => Math.max(safeTrimStart, t - 1000));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        firedSfxRef.current.clear();
        const safeTrimEnd = Math.max(0, Math.min(durationMs, trimEndMs > 0 ? trimEndMs : durationMs));
        setCurrentTimeMs((t) => Math.min(safeTrimEnd, t + 1000));
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        if (!e.metaKey && !e.ctrlKey) {
          handleAddPillAtPlayhead(0.5, 0.5);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [durationMs, trimStartMs, trimEndMs, currentTimeMs, handleAddPillAtPlayhead, handleTogglePlay]);

  useEffect(() => { currentTimeRef.current = currentTimeMs; }, [currentTimeMs]);
  useEffect(() => { sfxSynthesizerRef.current.setEnabled(soundEnabled); }, [soundEnabled]);

  // Synchronize HTML5 video element currentTime if source is a real video
  useEffect(() => {
    if (isExporting || isExportingGif) return;
    if (videoElement instanceof HTMLVideoElement) {
      if (Math.abs(videoElement.currentTime - currentTimeMs / 1000) > 0.08) {
        videoElement.currentTime = currentTimeMs / 1000;
      }
    }
  }, [currentTimeMs, videoElement, isExporting, isExportingGif]);

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
    try {
      hasFinalizedRef.current = false;
      isStoppingRef.current = false;
      telemetryReceivedRef.current = false;
      latestTelemetryRef.current = null;
      hudLiveRef.current = false;
      // QA-037: a recording started again in this editor must not inherit the
      // previous recording's declared timeline origin.
      if (import.meta.env.DEV) delete (window as any).__smoothstudioTimelineOrigin;
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
          setIsRecordingLive(false);
          if (!isStoppingRef.current) {
            void handleStopLiveRecordingRef.current?.(null, stoppedBlob);
          }
        }
      });
      setIsRecordingLive(true);

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
        if (import.meta.env.DEV) (window as any).__smoothstudioTimelineOrigin = originEpoch;
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage(
            { type: 'RECORDING_LIVE', epoch: originEpoch, sessionId },
            () => { void chrome.runtime?.lastError; }
          );
        }
      };
      armLiveGateRef.current = (hudEpoch) => {
        if (hudLiveRef.current || isStoppingRef.current || hasFinalizedRef.current) return;
        const armed = captureEngineRef.current.armLiveGate((origin) => {
          if (isStoppingRef.current || hasFinalizedRef.current) return;
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
        if (hudLiveRef.current || isStoppingRef.current || hasFinalizedRef.current) return;
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
        // QA-006: forward privacy options to the target tab when starting from
        // the editor, matching popup.tsx:103-109. Default to all categories ON
        // so sensitive data is never recorded unblurred.
        chrome.runtime.sendMessage({
          type: 'APPLY_PRIVACY_OPTIONS',
          options: { blurEmails: true, blurRevenue: true, blurApiKeys: true }
        }, () => {
          void chrome.runtime?.lastError;
        });
        chrome.runtime.sendMessage(
          {
            type: 'START_STUDIO_RECORDING',
            tabId: sourceTabId,
            focusTarget: Boolean(sourceTabId),
            sessionId
          },
          () => {
            void chrome.runtime?.lastError;
          }
        );
      }
      hudLiveWatchdogRef.current = setTimeout(() => {
        goLiveRef.current(undefined, 'watchdog: no HUD signal');
      }, 8000);
    } catch (err: any) {
      console.warn('Capture canceled or rejected:', err);
      setIsRecordingLive(false);
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

    // One stop per session: a second stop request while (or after) this
    // session is being finalized only hands over its telemetry.
    if (hasFinalizedRef.current || isStoppingRef.current) {
      return;
    }
    // A stop request when this editor is not recording must not load the
    // previous recording again. Reset the stop guards so the session can
    // never become un-stoppable after an ignored stop request.
    if (!passedBlob && !captureEngineRef.current.getStatus()) {
      console.log('[SmoothStudio] Stop request ignored: this editor is not recording.');
      hasFinalizedRef.current = false;
      isStoppingRef.current = false;
      return;
    }
    hasFinalizedRef.current = true;
    isStoppingRef.current = true;
    keepaliveStateRef.current?.startFastPing();
    if (hudLiveWatchdogRef.current) {
      clearTimeout(hudLiveWatchdogRef.current);
      hudLiveWatchdogRef.current = null;
    }
    setIsRecordingLive(false);

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
          hasFinalizedRef.current = false;
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
        setupLoadedRecording(blob, finalTelemetry, measuredDur, sid);
        showToast({
          type: 'success',
          title: 'Recording Loaded',
          message: `Screen recording loaded with smart zoom pills (${(measuredDur / 1000).toFixed(1)}s).`
        });
      } else {
        console.warn('[SmoothStudio] Finished recording but no video frames were captured.');
        showToast({
          type: 'error',
          title: 'Recording Failed',
          message: 'Recording failed: no video was captured. The display capture stream produced zero encoded frames.'
        });
      }
    } catch (err: any) {
      console.error('[SmoothStudio] Error during stop processing:', err);
      showToast({
        type: 'error',
        title: 'Stop Recording Failed',
        message: err?.message || 'Error loading recording into editor.'
      });
    } finally {
      keepaliveStateRef.current?.stopFastPing();
      isStoppingRef.current = false;
      latestTelemetryRef.current = null;
    }
  };

  // Keep the latest stop handler in the ref so the message listener never uses a stale closure
  useEffect(() => {
    handleStopLiveRecordingRef.current = handleStopLiveRecording;
    handleStartLiveRecordingRef.current = handleStartLiveRecording;
  });

  const handleUpdatePill = (updated: ZoomPill) => {
    setPills((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleDeletePill = (id: string) => {
    setPills((prev) => prev.filter((p) => p.id !== id));
    if (selectedPillId === id) setSelectedPillId(null);
  };

  const handleRedetectZooms = () => {
    if (!telemetry) return;
    const displaySurface = telemetry.metadata?.displaySurface;
    if (displaySurface === 'window' || displaySurface === 'monitor') {
      setPills([]);
      setSelectedPillId(null);
      showToast({
        type: 'info',
        title: 'Manual zoom only',
        message: 'Auto Zoom uses browser-tab coordinates. Add zooms manually for this window or monitor capture.'
      });
      return;
    }
    const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10000;
    const autoPills = generateAutoZoomPills(
      telemetry.clicks || [],
      telemetry.inputEvents || [],
      safeDuration,
      telemetry.metadata?.width || 1920,
      telemetry.metadata?.height || 1080,
      telemetry.scrollEvents,
      telemetry.typingSessions
    );
    setPills(autoPills);
    if (selectedPillId && !autoPills.some((p) => p.id === selectedPillId)) {
      setSelectedPillId(null);
    }
    if (import.meta.env.DEV) (window as any).__smoothstudio_pills = autoPills;
  };

  // Timeline seek: reset SFX dedup so re-scrubbing can re-arm event triggers
  const handleSeek = (timeMs: number) => {
    firedSfxRef.current.clear();
    const safeTrimStart = Math.max(0, Math.min(durationMs, trimStartMs));
    const safeTrimEnd = Math.max(safeTrimStart, Math.min(durationMs, trimEndMs > 0 ? trimEndMs : durationMs));
    const clamped = Math.max(safeTrimStart, Math.min(safeTrimEnd, timeMs));
    setCurrentTimeMs(clamped);
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

  // 1. Hardware 60fps MP4 Export (with safe fail-over path to client WebM)
  const handleExportMp4 = async () => {
    if (!videoElement) return;

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

    try {
      const exporter = new HardwareMp4Exporter();
      const mp4Blob = await exporter.exportMp4({
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
        backgroundColor,
        backgroundImage,
        framingMode,
        shadowMode,
        targetWidth: targetExportWidth,
        mediaDurationMs: mediaDurationRef.current ?? undefined,
        onProgress: (pct) => setExportProgress(pct)
      });

      HardwareMp4Exporter.downloadBlob(mp4Blob, `${telemetry?.metadata.title || 'SmoothStudio'}_Cinematic.mp4`);
      setExportComplete(true);
      showToast({
        type: 'success',
        title: 'MP4 Exported',
        message: isUpscaled
          ? `Hardware encoded ${targetResLabel}/60fps video downloaded (Upscaled from ${sourceResLabel}).`
          : `Hardware encoded ${targetResLabel}/60fps video downloaded.`
      });
    } catch (err: any) {
      console.error('MP4 export failed:', err);
      diagnosticChannel.recordFrameDrop(err?.message || 'VideoEncoder runtime error during export');
      showToast({ type: 'error', title: 'MP4 Export Failed', message: err?.message || 'VideoEncoder error' });
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Hardware 20fps GIF Export
  const handleExportGif = async () => {
    if (!videoElement) return;
    setIsExportingGif(true);
    setExportGifProgress(0);
    setExportGifComplete(false);

    try {
      const exporter = new HardwareGifExporter();
      const config = GIF_QUALITY_PRESETS[gifPreset] || GIF_QUALITY_PRESETS.compact;
      const gifBlob = await exporter.exportGif({
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
        backgroundColor,
        backgroundImage,
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
      console.error('GIF export failed:', err);
      showToast({ type: 'error', title: 'GIF Export Failed', message: err?.message || 'GIF encoder error' });
    } finally {
      setIsExportingGif(false);
    }
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
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 border border-white/10 transition-colors"
            >
              <CircleDot className="w-3.5 h-3.5 text-red-400" />
              Record New Screen
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
          backgroundColor={backgroundColor}
          onSelectBackgroundColor={handleSelectBackgroundColor}
          backgroundImageUrl={backgroundImageUrl}
          onSelectBackgroundImage={handleSelectBackgroundImage}
          onBackgroundImageError={handleBackgroundImageError}
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
          backgroundColor={backgroundColor}
          backgroundImage={backgroundImage}
          onCanvasClickToAddZoom={handleAddPillAtPlayhead}
          showCaptions={showCaptions}
        />

        {/* Record Prompt Dialog Overlay */}
        {showRecordPrompt && !isRecordingLive && (
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
        {hasNoRecording && !videoElement && !isRecordingLive && !showRecordPrompt && (
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
      </div>

      {/* Bottom Magnetic Pill Multi-Track Timeline */}
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
        onUpdatePill={handleUpdatePill}
        onDeletePill={handleDeletePill}
        onAddPillAtPlayhead={() => handleAddPillAtPlayhead(0.5, 0.5)}
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

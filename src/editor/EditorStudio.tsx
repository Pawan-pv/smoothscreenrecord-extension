import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  TelemetryData,
  ZoomPill,
  SilenceSegment,
  AspectRatioType,
  VibePreset,
  CaptionBlock,
  CaptionStyle,
  CursorTheme,
  BackdropMatrixParams
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { generateAutoZoomPills } from '../engine/spring-physics';
import { CursorSplineEngine } from '../engine/cursor-spline';
import { AudioProcessor } from '../engine/audio-processor';
import { SfxSynthesizer } from '../engine/sfx-synthesizer';
import { HardwareMp4Exporter } from '../engine/mp4-exporter';
import { HardwareGifExporter } from '../engine/gif-exporter';
import { SopGuideExporter } from '../engine/sop-guide-exporter';
import { HtmlWidgetExporter } from '../engine/html-widget-exporter';
import { getRecordingBlob, loadTelemetry, setUseOpfs } from '../engine/opfs-storage';
import { ScreenCaptureEngine } from '../engine/screen-recorder';
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

export function EditorStudio() {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const latestTelemetryRef = useRef<TelemetryData | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | HTMLCanvasElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [durationMs, setDurationMs] = useState<number>(10000);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [showDoctor, setShowDoctor] = useState<boolean>(false);
  const [activeDegradation, setActiveDegradation] = useState<SystemDegradationEvent | null>(null);
  const [storageMode, setStorageMode] = useState<'opfs' | 'ram'>(diagnosticChannel.getStorageMode());
  const [encoderStreamMode, setEncoderStreamMode] = useState<'hardware-mp4' | 'client-webm'>(diagnosticChannel.getEncoderStreamMode());
  const [toasts, setToasts] = useState<ToastItem[]>([]);

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
  const [silences, setSilences] = useState<SilenceSegment[]>([]);
  const [autoCutSilences, setAutoCutSilences] = useState<boolean>(true);
  const [showSpotlight, setShowSpotlight] = useState<boolean>(true);
  const [showCursor, setShowCursor] = useState<boolean>(true);
  const [showHud, setShowHud] = useState<boolean>(true);
  const [showIntroCard, setShowIntroCard] = useState<boolean>(false);
  const [introHeadline, setIntroHeadline] = useState<string>('Introducing SmoothStudio 2.0');
  const [introSubheadline, setIntroSubheadline] = useState<string>('Cinematic screen demos in seconds');
  const [showOutroCard, setShowOutroCard] = useState<boolean>(false);
  const [outroHeadline, setOutroHeadline] = useState<string>('Ready to ship better demos?');
  const [outroCtaText, setOutroCtaText] = useState<string>('Try SmoothStudio Free →');
  const [followCursor, setFollowCursor] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Cursor & Auto-Captions State
  const [cursorTheme, setCursorTheme] = useState<CursorTheme>('mac-obsidian');
  const [cursorScale, setCursorScale] = useState<number>(1.2);
  const [showCaptions, setShowCaptions] = useState<boolean>(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('tiktok-bold');
  const [captionBackdrop, setCaptionBackdrop] = useState<number>(70);
  const [captions, setCaptions] = useState<CaptionBlock[]>([]);

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportComplete, setExportComplete] = useState<boolean>(false);

  // GIF Export State
  const [isExportingGif, setIsExportingGif] = useState<boolean>(false);
  const [exportGifProgress, setExportGifProgress] = useState<number>(0);
  const [exportGifComplete, setExportGifComplete] = useState<boolean>(false);

  const [copiedSop, setCopiedSop] = useState<boolean>(false);
  const [isRecordingLive, setIsRecordingLive] = useState<boolean>(false);

  // Engines
  const cursorEngineRef = useRef<CursorSplineEngine>(new CursorSplineEngine());
  const audioProcessorRef = useRef<AudioProcessor>(new AudioProcessor());
  const sfxSynthesizerRef = useRef<SfxSynthesizer>(new SfxSynthesizer(true));
  const captureEngineRef = useRef<ScreenCaptureEngine>(new ScreenCaptureEngine());
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  // Deduplicates procedural SFX so a single click/keystroke/zoom event never
  // fires more than once across adjacent animation frames.
  const firedSfxRef = useRef<Set<string>>(new Set());
  const currentTimeRef = useRef<number>(0);
  const demoRendererRef = useRef<((timeMs: number) => void) | null>(null);
  const handleStopLiveRecordingRef = useRef<((passedTelemetry?: TelemetryData | null, passedBlob?: Blob | null) => Promise<void>) | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const telemetryReceivedRef = useRef<boolean>(false);

  // 1. Initial Load: Try OPFS / storage or generate interactive demo
  useEffect(() => {
    // Register editor tab with service worker and listen for background stop capture
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'REGISTER_EDITOR_TAB' }, () => {
        void chrome.runtime?.lastError;
      });

      // Connect persistent keepalive port to prevent MV3 service worker dormancy
      let keepalivePort: chrome.runtime.Port | null = null;
      let pingInterval: any = null;
      try {
        keepalivePort = chrome.runtime.connect({ name: 'smoothstudio-keepalive' });
        keepalivePort.onDisconnect.addListener(() => {
          void chrome.runtime?.lastError;
        });
        pingInterval = setInterval(() => {
          try { keepalivePort?.postMessage('ping'); } catch {}
        }, 15000);
      } catch {}

      const messageListener = (msg: any) => {
        if (msg.type === 'STUDIO_STOP_CAPTURE') {
          console.log('[SmoothStudio] Received STUDIO_STOP_CAPTURE message from service worker:', msg.telemetry);
          handleStopLiveRecordingRef.current?.(msg.telemetry);
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
    // Immediately load demo workspace so canvas is active on initial render
    if (typeof window !== 'undefined' && !window.location.search.includes('record=true')) {
      loadDemoWorkspace();
    }

    async function loadInitial() {
      if (typeof window !== 'undefined' && window.location.search.includes('record=true')) {
        const urlParams = new URLSearchParams(window.location.search);
        const sourceTabStr = urlParams.get('sourceTab');
        const sourceTabId = sourceTabStr ? parseInt(sourceTabStr) : undefined;
        loadDemoWorkspace();
        // Automatically prompt capture after initial render
        setTimeout(() => {
          handleStartLiveRecording(sourceTabId);
        }, 400);
        return;
      }

      try {
        const storedTelemetry = await loadTelemetry();
        const storedBlob = await getRecordingBlob();

        if (storedBlob && storedTelemetry) {
          setupLoadedRecording(storedBlob, storedTelemetry);
        }
      } catch (err) {
        console.warn('[SmoothStudio] Failed to load stored recording:', err);
      }
    }
    loadInitial();
  }, []);

  const seedCaptionsFromTelemetry = (data: TelemetryData, durMs: number): CaptionBlock[] => {
    const seeded: CaptionBlock[] = [];
    const title = data.metadata?.title || 'Screen Walkthrough';

    const introEnd = Math.min(3200, Math.round(durMs * 0.28));
    const introText = `Welcome to ${title.length > 28 ? title.slice(0, 28) + '...' : title}`;
    const introWords = introText.split(' ').map((w, idx, arr) => {
      const step = (introEnd - 600) / arr.length;
      return {
        word: w,
        startTime: 600 + idx * step,
        endTime: 600 + (idx + 1) * step
      };
    });
    seeded.push({
      id: 'cap_intro',
      startTime: 600,
      endTime: introEnd,
      text: introText,
      words: introWords
    });

    data.clicks.forEach((c, idx) => {
      if (c.targetText && c.targetText.trim().length > 2) {
        const start = Math.max(0, c.t - 300);
        const end = Math.min(durMs, c.t + 2400);
        const text = `Interacting with ${c.targetText.trim().slice(0, 32)}`;
        const words = text.split(' ').map((w, wIdx, arr) => {
          const step = (end - start) / arr.length;
          return {
            word: w,
            startTime: start + wIdx * step,
            endTime: start + (wIdx + 1) * step
          };
        });
        seeded.push({
          id: `cap_click_${idx}`,
          startTime: start,
          endTime: end,
          text,
          words
        });
      }
    });

    data.keystrokes.forEach((k, idx) => {
      if (k.combo) {
        const start = Math.max(0, k.t - 200);
        const end = Math.min(durMs, k.t + 2200);
        const text = `Executing shortcut ${k.combo}`;
        const words = text.split(' ').map((w, wIdx, arr) => {
          const step = (end - start) / arr.length;
          return {
            word: w,
            startTime: start + wIdx * step,
            endTime: start + (wIdx + 1) * step
          };
        });
        seeded.push({
          id: `cap_key_${idx}`,
          startTime: start,
          endTime: end,
          text,
          words
        });
      }
    });

    return seeded.sort((a, b) => a.startTime - b.startTime);
  };

  const setupLoadedRecording = (blob: Blob, data: TelemetryData, measuredDurationMs?: number) => {
    firedSfxRef.current.clear();
    setVideoBlob(blob);
    setTelemetry(data);

    // Compute safe, finite duration fallback
    const safeDuration = (measuredDurationMs && measuredDurationMs > 0)
      ? measuredDurationMs
      : (data.metadata?.durationMs && data.metadata.durationMs > 0 ? data.metadata.durationMs : 10000);
    setDurationMs(safeDuration);

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

    video.onloadedmetadata = () => {
      let resolvedDur = safeDuration;
      // Guard against Chrome MediaRecorder WebM bug where video.duration === Infinity or NaN
      if (Number.isFinite(video.duration) && video.duration > 0) {
        resolvedDur = Math.round(video.duration * 1000);
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
      console.log('[SmoothStudio] Video element metadata loaded. Duration:', resolvedDur, 'Dimensions:', video.videoWidth, 'x', video.videoHeight);
      setDurationMs(resolvedDur);
      setVideoElement(video);
    };

    video.onerror = (err) => {
      console.error('[SmoothStudio] Video element failed to load recording blob URL:', newObjectUrl, err);
      showToast({
        type: 'error',
        title: 'Video Stream Error',
        message: 'Could not decode recorded WebM video stream in browser.'
      });
    };

    // Fallback: if onloadedmetadata hasn't fired after 250ms, ensure videoElement is set
    setTimeout(() => {
      setVideoElement((curr) => curr || video);
    }, 300);

    cursorEngineRef.current.setData(data.mousePoints || [], data.clicks || []);

    // Auto-generate smart zoom pills based on DOM bounding boxes & clicks
    const autoPills = generateAutoZoomPills(
      data.clicks || [],
      data.inputEvents || [],
      safeDuration,
      data.metadata?.width || 1920,
      data.metadata?.height || 1080
    );
    setPills(autoPills);

    if (data.captions && data.captions.length > 0) {
      setCaptions(data.captions);
    } else {
      setCaptions(seedCaptionsFromTelemetry(data, safeDuration));
    }

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
  };

  // Synthesize a high-res demo recording with mock DOM events and video
  const loadDemoWorkspace = () => {
    firedSfxRef.current.clear();
    setIsPlaying(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (prevBlobUrlRef.current) {
      URL.revokeObjectURL(prevBlobUrlRef.current);
      prevBlobUrlRef.current = null;
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }

    const demoCanvas = document.createElement('canvas');
    demoCanvas.width = 1920;
    demoCanvas.height = 1080;
    const ctx = demoCanvas.getContext('2d')!;

    // Draw realistic mock modern SaaS application dashboard
    function renderDemoFrame(timeMs: number) {
      // Background
      ctx.fillStyle = '#0F1117';
      ctx.fillRect(0, 0, 1920, 1080);

      // Top Navbar
      ctx.fillStyle = '#161922';
      ctx.fillRect(0, 0, 1920, 72);
      ctx.fillStyle = '#8B5CF6';
      ctx.beginPath();
      ctx.arc(60, 36, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 20px Inter, sans-serif';
      ctx.fillText('Acme Cloud Studio', 95, 43);

      // Search Bar with keystroke target
      ctx.fillStyle = '#202431';
      ctx.roundRect(1400, 18, 320, 38, 8);
      ctx.fill();
      ctx.fillStyle = '#9CA3AF';
      ctx.font = '14px Inter, sans-serif';
      ctx.fillText('Quick Search (Cmd + K)...', 1420, 42);

      // Metric Cards Grid
      const cards = [
        { label: 'Active Deployments', val: '1,428', change: '+18.4%' },
        { label: 'Hardware GPU Units', val: '64/64', change: '100% Load' },
        { label: 'Monthly API Cost', val: '$0.00', change: '100% Free' }
      ];

      cards.forEach((c, idx) => {
        const x = 120 + idx * 560;
        ctx.fillStyle = '#1A1D27';
        ctx.roundRect(x, 140, 520, 200, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.stroke();

        ctx.fillStyle = '#9CA3AF';
        ctx.font = '14px Inter, sans-serif';
        ctx.fillText(c.label, x + 32, 185);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 36px Inter, sans-serif';
        ctx.fillText(c.val, x + 32, 245);

        ctx.fillStyle = '#10B981';
        ctx.font = '500 14px Inter, sans-serif';
        ctx.fillText(c.change, x + 32, 285);
      });

      // Animated Chart in Main Card
      ctx.fillStyle = '#1A1D27';
      ctx.roundRect(120, 380, 1680, 620, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 22px Inter, sans-serif';
      ctx.fillText('Real-Time WebGPU Render Throughput (60 FPS)', 160, 435);

      // Animated wave lines
      ctx.beginPath();
      ctx.strokeStyle = '#8B5CF6';
      ctx.lineWidth = 4;
      for (let x = 160; x <= 1740; x += 10) {
        const y = 720 + Math.sin(x * 0.008 + timeMs * 0.003) * 120;
        if (x === 160) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    renderDemoFrame(0);
    demoRendererRef.current = renderDemoFrame;
    setVideoElement(demoCanvas);

    // Generate mock telemetry
    const demoDuration = 12000;
    setDurationMs(demoDuration);

    const mockMousePoints = [];
    for (let t = 0; t <= demoDuration; t += 20) {
      const progress = t / demoDuration;
      mockMousePoints.push({
        t,
        x: 400 + Math.sin(progress * Math.PI * 4) * 600,
        y: 300 + Math.cos(progress * Math.PI * 3) * 250,
        c: t > 4000 && t < 7000 ? 'pointer' : 'default'
      });
    }

    const mockClicks = [
      {
        t: 2200,
        x: 380,
        y: 240,
        button: 0,
        targetTag: 'div',
        targetText: 'Active Deployments Metric',
        containerBounds: { x: 120, y: 140, width: 520, height: 200 }
      },
      {
        t: 6500,
        x: 1240,
        y: 240,
        button: 0,
        targetTag: 'button',
        targetText: '$0.00 Server Cost Card',
        containerBounds: { x: 1240, y: 140, width: 520, height: 200 }
      }
    ];

    const mockKeystrokes = [
      { t: 4200, key: 'k', combo: '⌘ + K' },
      { t: 9000, key: 'Enter', combo: 'Enter' }
    ];

    const mockInputEvents = [
      {
        t: 4400,
        type: 'focus' as const,
        bounds: { x: 1400, y: 18, width: 320, height: 38 }
      }
    ];

    const mockTelemetry: TelemetryData = {
      metadata: {
        id: 'demo_recording',
        startTime: Date.now() - demoDuration,
        endTime: Date.now(),
        durationMs: demoDuration,
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        title: 'Acme SaaS Demo Walkthrough',
        url: 'https://app.acme.io/dashboard',
        brandColors: {
          primary: '#8B5CF6',
          secondary: '#6366F1',
          accent: '#EC4899',
          background: '#0F1117'
        }
      },
      mousePoints: mockMousePoints,
      clicks: mockClicks,
      keystrokes: mockKeystrokes,
      inputEvents: mockInputEvents
    };

    setTelemetry(mockTelemetry);
    cursorEngineRef.current.setData(mockMousePoints, mockClicks);

    const autoPills = generateAutoZoomPills(
      mockClicks,
      mockInputEvents,
      demoDuration,
      1920,
      1080
    );
    setPills(autoPills);

    // Mock silences (>1.2s without clicks or typing)
    setSilences([
      {
        id: 'silence_demo_1',
        startTime: 4800,
        endTime: 6200,
        duration: 1400,
        markedForCut: true
      },
      {
        id: 'silence_demo_2',
        startTime: 7800,
        endTime: 9600,
        duration: 1800,
        markedForCut: true
      }
    ]);

    // Mock viral TikTok/Linear auto-captions
    const mockCaptions: CaptionBlock[] = [
      {
        id: 'cap_1',
        startTime: 800,
        endTime: 3600,
        text: 'Welcome to Acme Cloud Studio dashboard',
        words: [
          { word: 'Welcome', startTime: 800, endTime: 1200 },
          { word: 'to', startTime: 1200, endTime: 1400 },
          { word: 'Acme', startTime: 1400, endTime: 1800 },
          { word: 'Cloud', startTime: 1800, endTime: 2200 },
          { word: 'Studio', startTime: 2200, endTime: 2800 },
          { word: 'dashboard', startTime: 2800, endTime: 3600 }
        ]
      },
      {
        id: 'cap_2',
        startTime: 4000,
        endTime: 7000,
        text: 'Checking real-time WebGPU throughput at 60 FPS',
        words: [
          { word: 'Checking', startTime: 4000, endTime: 4500 },
          { word: 'real-time', startTime: 4500, endTime: 5100 },
          { word: 'WebGPU', startTime: 5100, endTime: 5700 },
          { word: 'throughput', startTime: 5700, endTime: 6300 },
          { word: 'at', startTime: 6300, endTime: 6500 },
          { word: '60 FPS', startTime: 6500, endTime: 7000 }
        ]
      },
      {
        id: 'cap_3',
        startTime: 7500,
        endTime: 11000,
        text: 'Zero server cost with hardware accelerated local export',
        words: [
          { word: 'Zero', startTime: 7500, endTime: 8000 },
          { word: 'server', startTime: 8000, endTime: 8400 },
          { word: 'cost', startTime: 8400, endTime: 8800 },
          { word: 'with', startTime: 8800, endTime: 9100 },
          { word: 'hardware', startTime: 9100, endTime: 9600 },
          { word: 'accelerated', startTime: 9600, endTime: 10200 },
          { word: 'local', startTime: 10200, endTime: 10600 },
          { word: 'export', startTime: 10600, endTime: 11000 }
        ]
      }
    ];
    setCaptions(mockCaptions);
  };

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
      let next = currentTimeRef.current + dt;

      if (autoCutSilences) {
        const activeSilence = silences.find(
          (s) => s.markedForCut && next >= s.startTime && next < s.endTime
        );
        if (activeSilence) {
          // Never skip across the Outro CTA window: clamp the jump so the final
          // 1.5s always plays in full when the outro card is enabled.
          const clampEnd = showOutroCard
            ? Math.min(activeSilence.endTime, Math.max(activeSilence.startTime, safeDur - 1500))
            : activeSilence.endTime;
          if (clampEnd > next) {
            next = clampEnd;
          }
        }
      }

      if (next >= safeDur) {
        setIsPlaying(false);
        currentTimeRef.current = 0;
        setCurrentTimeMs(0);
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
  }, [isPlaying, durationMs, soundEnabled, telemetry, pills, silences, autoCutSilences, showOutroCard]);

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
    if (newPreset.backdrop) {
      setBackdropParams(newPreset.backdrop);
    }
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
        setIsPlaying((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        firedSfxRef.current.clear();
        setCurrentTimeMs((t) => Math.max(0, t - 1000));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        firedSfxRef.current.clear();
        setCurrentTimeMs((t) => Math.min(durationMs, t + 1000));
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        if (!e.metaKey && !e.ctrlKey) {
          handleAddPillAtPlayhead(0.5, 0.5);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [durationMs, currentTimeMs, handleAddPillAtPlayhead]);

  useEffect(() => { currentTimeRef.current = currentTimeMs; }, [currentTimeMs]);
  useEffect(() => { sfxSynthesizerRef.current.setEnabled(soundEnabled); }, [soundEnabled]);

  // Synchronize HTML5 video element currentTime if source is a real video
  useEffect(() => {
    if (videoElement instanceof HTMLVideoElement) {
      videoElement.currentTime = currentTimeMs / 1000;
    } else if (videoElement instanceof HTMLCanvasElement && demoRendererRef.current) {
      demoRendererRef.current(currentTimeMs);
    }
  }, [currentTimeMs, videoElement]);

  // Handle Live Screen Recording within the browser tab
  const handleStartLiveRecording = async (sourceTabId?: number) => {
    try {
      isStoppingRef.current = false;
      telemetryReceivedRef.current = false;
      setIsPlaying(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setIsRecordingLive(true);
      await captureEngineRef.current.start({
        includeMic: true,
        frameRate: 60,
        onStop: (stoppedBlob) => {
          console.log('[SmoothStudio] captureEngine onStop triggered with blob size:', stoppedBlob?.size);
          setIsRecordingLive(false);
          if (!isStoppingRef.current) {
            void handleStopLiveRecordingRef.current?.(null, stoppedBlob);
          }
        }
      });

      // Clear record=true query param without refreshing page
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      // Notify service worker to initiate 120Hz DOM tracking on target tab
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage(
          {
            type: 'START_STUDIO_RECORDING',
            tabId: sourceTabId,
            focusTarget: Boolean(sourceTabId)
          },
          () => {
            void chrome.runtime?.lastError;
          }
        );
      }
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
    if (passedTelemetry) {
      latestTelemetryRef.current = passedTelemetry;
    }

    // If already in-flight stopping, do not run concurrent pass
    if (isStoppingRef.current) {
      return;
    }
    isStoppingRef.current = true;
    setIsRecordingLive(false);

    try {
      // 1. Ensure capture engine stops and gives us the finalized blob
      let blob = passedBlob || (await captureEngineRef.current.stop());
      if (!blob) {
        blob = captureEngineRef.current.getLastBlob() || (await getRecordingBlob());
      }

      // 2. Obtain telemetry: priority passedTelemetry -> latestTelemetryRef -> loadTelemetry() -> service worker query
      let tel = latestTelemetryRef.current || (await loadTelemetry());
      if (!tel && typeof chrome !== 'undefined' && chrome.runtime) {
        try {
          await new Promise<void>((resolve) => {
            chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' }, () => {
              void chrome.runtime?.lastError;
              resolve();
            });
            setTimeout(resolve, 600);
          });
          tel = latestTelemetryRef.current || (await loadTelemetry());
        } catch {}
      }

      const measuredDur = captureEngineRef.current.getDurationMs() || 10000;

      // 3. Prepare complete telemetry with metadata
      const finalTelemetry: TelemetryData = (tel && tel.mousePoints && tel.mousePoints.length > 0)
        ? tel
        : {
            metadata: {
              id: 'live_' + Date.now(),
              startTime: Date.now() - measuredDur,
              endTime: Date.now(),
              durationMs: measuredDur,
              width: window.innerWidth,
              height: window.innerHeight,
              devicePixelRatio: window.devicePixelRatio || 1,
              title: tel?.metadata?.title || 'Screen Recording'
            },
            mousePoints: tel?.mousePoints || [],
            clicks: tel?.clicks || [],
            keystrokes: tel?.keystrokes || [],
            inputEvents: tel?.inputEvents || []
          };

      if (blob && blob.size > 0) {
        console.log('[SmoothStudio] Recording stopped successfully. Finalizing editor with blob size:', blob.size, 'duration:', measuredDur);
        setupLoadedRecording(blob, finalTelemetry, measuredDur);
        showToast({
          type: 'success',
          title: 'Recording Loaded',
          message: `Screen recording loaded with smart zoom pills (${(measuredDur / 1000).toFixed(1)}s).`
        });
      } else {
        console.warn('[SmoothStudio] Finished recording but no video frames were captured.');
        showToast({
          type: 'warning',
          title: 'Empty Recording',
          message: 'The screen recording stream produced zero bytes.'
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
      isStoppingRef.current = false;
      latestTelemetryRef.current = null;
    }
  };

  // Keep the latest stop handler in the ref so the message listener never uses a stale closure
  useEffect(() => {
    handleStopLiveRecordingRef.current = handleStopLiveRecording;
  });

  const handleUpdatePill = (updated: ZoomPill) => {
    setPills((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleDeletePill = (id: string) => {
    setPills((prev) => prev.filter((p) => p.id !== id));
  };

  // Timeline seek: reset SFX dedup so re-scrubbing can re-arm event triggers
  const handleSeek = (timeMs: number) => {
    firedSfxRef.current.clear();
    setCurrentTimeMs(timeMs);
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
    const text = 'Highlighting key product interaction';
    const words = text.split(' ').map((w, idx, arr) => {
      const step = (end - start) / arr.length;
      return {
        word: w,
        startTime: start + idx * step,
        endTime: start + (idx + 1) * step
      };
    });
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
        setTimeout(() => URL.revokeObjectURL(url), 5000);
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
        onRenderCanvasFrame: (timeMs) => {
          if (demoRendererRef.current) {
            demoRendererRef.current(timeMs);
          }
        },
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
        onProgress: (pct) => setExportProgress(pct)
      });

      HardwareMp4Exporter.downloadBlob(mp4Blob, `${telemetry?.metadata.title || 'SmoothStudio'}_Cinematic.mp4`);
      setExportComplete(true);
      showToast({ type: 'success', title: 'MP4 Exported', message: 'Hardware encoded 4K/60fps video downloaded.' });
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
      const gifBlob = await exporter.exportGif({
        videoSource: videoElement,
        onRenderCanvasFrame: (timeMs) => {
          if (demoRendererRef.current) {
            demoRendererRef.current(timeMs);
          }
        },
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
        fps: 20,
        maxDimension: 840,
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

  // 2. Step-by-Step Markdown / Notion SOP Guide Export
  const handleExportSopGuide = () => {
    if (!telemetry) return;
    const md = SopGuideExporter.generateMarkdownGuide(telemetry, captureEngineRef.current.getSnapshots());
    SopGuideExporter.downloadMarkdown(md, `${telemetry.metadata.title || 'SOP'}_Guide.md`);
    showToast({ type: 'success', title: 'SOP Guide Exported', message: 'Markdown guide downloaded.' });
  };

  const handleCopySopGuide = async () => {
    if (!telemetry) return;
    try {
      const md = SopGuideExporter.generateMarkdownGuide(telemetry, captureEngineRef.current.getSnapshots());
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
      captureEngineRef.current.getSnapshots()
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
              {telemetry?.metadata.title || 'Cinematic 3D Video Studio'} • 60 FPS WebGPU
            </p>
          </div>
        </div>

        {/* Live Recording / Demo Switcher */}
        <div className="flex items-center gap-2">
          {isRecordingLive ? (
            <button
              onClick={() => handleStopLiveRecording()}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center gap-2 shadow-lg shadow-red-600/30 animate-pulse"
            >
              <div className="w-2 h-2 rounded-sm bg-white" />
              Stop Live Recording
            </button>
          ) : (
            <button
              onClick={() => handleStartLiveRecording()}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 border border-white/10 transition-colors"
            >
              <CircleDot className="w-3.5 h-3.5 text-red-400" />
              Record New Screen
            </button>
          )}

          <button
            onClick={loadDemoWorkspace}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium flex items-center gap-1.5 border border-white/10 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            Reload Demo
          </button>

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
            title="Export animated lightweight 20fps GIF"
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

          {/* Hardware MP4 Exporter */}
          <button
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
                Export 4K/60fps MP4
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Studio Body: Sidebar + Center Canvas */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Vibe Presets & Controls */}
        <VibePresetsPanel
          currentPreset={preset}
          onSelectPreset={handleSelectPreset}
          aspectRatio={aspectRatio}
          onChangeAspectRatio={setAspectRatio}
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
        />
        {/* Center Canvas Preview Viewport */}
        <CanvasPreview
          video={videoElement}
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onRestart={() => {
            firedSfxRef.current.clear();
            setCurrentTimeMs(0);
          }}
          pills={pills}
          cursorEngine={cursorEngineRef.current}
          keystrokes={telemetry?.keystrokes || []}
          preset={preset}
          aspectRatio={aspectRatio}
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
          onCanvasClickToAddZoom={handleAddPillAtPlayhead}
          showCaptions={showCaptions}
        />
      </div>

      {/* Bottom Magnetic Pill Multi-Track Timeline */}
      <MagneticTimeline
        durationMs={durationMs}
        currentTimeMs={currentTimeMs}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onSeek={handleSeek}
        pills={pills}
        onUpdatePill={handleUpdatePill}
        onDeletePill={handleDeletePill}
        onAddPillAtPlayhead={() => handleAddPillAtPlayhead(0.5, 0.5)}
        silences={silences}
        onToggleSilenceCut={handleToggleSilenceCut}
        onCutAllSilences={handleCutAllSilences}
        autoCutSilences={autoCutSilences}
        onToggleAutoCutSilences={setAutoCutSilences}
        keystrokes={telemetry?.keystrokes || []}
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

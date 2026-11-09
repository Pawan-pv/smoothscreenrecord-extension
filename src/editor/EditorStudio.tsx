import React, { useState, useEffect, useRef } from 'react';
import {
  TelemetryData,
  ZoomPill,
  SilenceSegment,
  AspectRatioType,
  VibePreset
} from '../types/telemetry';
import { VIBE_PRESETS } from '../engine/renderer';
import { generateAutoZoomPills } from '../engine/spring-physics';
import { CursorSplineEngine } from '../engine/cursor-spline';
import { AudioProcessor } from '../engine/audio-processor';
import { HardwareMp4Exporter } from '../engine/mp4-exporter';
import { SopGuideExporter } from '../engine/sop-guide-exporter';
import { HtmlWidgetExporter } from '../engine/html-widget-exporter';
import { getRecordingBlob, loadTelemetry } from '../engine/opfs-storage';
import { ScreenCaptureEngine } from '../engine/screen-recorder';
import { CanvasPreview } from './CanvasPreview';
import { MagneticTimeline } from './MagneticTimeline';
import { VibePresetsPanel } from './VibePresetsPanel';
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
  Pause
} from 'lucide-react';

export function EditorStudio() {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | HTMLCanvasElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [durationMs, setDurationMs] = useState<number>(10000);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Settings & Timeline state
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('16:9');
  const [preset, setPreset] = useState<VibePreset>(VIBE_PRESETS['linear-dark']);
  const [pills, setPills] = useState<ZoomPill[]>([]);
  const [silences, setSilences] = useState<SilenceSegment[]>([]);
  const [showSpotlight, setShowSpotlight] = useState<boolean>(true);
  const [showCursor, setShowCursor] = useState<boolean>(true);
  const [showHud, setShowHud] = useState<boolean>(true);
  const [followCursor, setFollowCursor] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportComplete, setExportComplete] = useState<boolean>(false);
  const [copiedSop, setCopiedSop] = useState<boolean>(false);
  const [isRecordingLive, setIsRecordingLive] = useState<boolean>(false);

  // Engines
  const cursorEngineRef = useRef<CursorSplineEngine>(new CursorSplineEngine());
  const audioProcessorRef = useRef<AudioProcessor>(new AudioProcessor());
  const captureEngineRef = useRef<ScreenCaptureEngine>(new ScreenCaptureEngine());
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastPlayedSfxTimeRef = useRef<number>(0);
  const demoRendererRef = useRef<((timeMs: number) => void) | null>(null);

  // 1. Initial Load: Try OPFS / storage or generate interactive demo
  useEffect(() => {
    // Register editor tab with service worker and listen for background stop capture
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'REGISTER_EDITOR_TAB' }).catch(() => {});

      const messageListener = (msg: any) => {
        if (msg.type === 'STUDIO_STOP_CAPTURE') {
          handleStopLiveRecording(msg.telemetry);
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener);
      };
    }
  }, []);

  useEffect(() => {
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

      const storedTelemetry = await loadTelemetry();
      const storedBlob = await getRecordingBlob();

      if (storedBlob && storedTelemetry) {
        setupLoadedRecording(storedBlob, storedTelemetry);
      } else {
        // Generate interactive demo workspace so the editor is immediately playable
        loadDemoWorkspace();
      }
    }
    loadInitial();
  }, []);

  const setupLoadedRecording = (blob: Blob, data: TelemetryData) => {
    setVideoBlob(blob);
    setTelemetry(data);
    const dur = data.metadata.durationMs || 10000;
    setDurationMs(dur);

    const video = document.createElement('video');
    video.src = URL.createObjectURL(blob);
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      setVideoElement(video);
    };

    cursorEngineRef.current.setData(data.mousePoints, data.clicks);

    // Auto-generate smart zoom pills based on DOM bounding boxes & clicks
    const autoPills = generateAutoZoomPills(
      data.clicks,
      data.inputEvents,
      dur,
      data.metadata.width,
      data.metadata.height
    );
    setPills(autoPills);

    // Analyze silences
    audioProcessorRef.current
      .analyzeSilences(blob, data.clicks, data.keystrokes)
      .then((detected) => setSilences(detected));
  };

  // Synthesize a high-res demo recording with mock DOM events and video
  const loadDemoWorkspace = () => {
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

    // Mock silences
    setSilences([
      {
        id: 'silence_demo_1',
        startTime: 7800,
        endTime: 9600,
        duration: 1800,
        markedForCut: true
      }
    ]);
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

      setCurrentTimeMs((prev) => {
        const next = prev + dt;
        if (next >= durationMs) {
          setIsPlaying(false);
          return 0;
        }

        // Procedural Audio SFX Triggering during playback
        if (soundEnabled && telemetry) {
          // Play pop on clicks
          const activeClick = telemetry.clicks.find(
            (c) => Math.abs(c.t - next) < 25 && next - lastPlayedSfxTimeRef.current > 150
          );
          if (activeClick) {
            lastPlayedSfxTimeRef.current = next;
            audioProcessorRef.current.playClickPop();
          }

          // Play thock on keystrokes
          const activeKey = telemetry.keystrokes.find(
            (k) => Math.abs(k.t - next) < 25 && next - lastPlayedSfxTimeRef.current > 150
          );
          if (activeKey) {
            lastPlayedSfxTimeRef.current = next;
            audioProcessorRef.current.playKeyboardThock();
          }

          // Play whoosh when camera enters zoom pill
          const pillEntering = pills.find(
            (p) => Math.abs(p.startTime - next) < 25 && next - lastPlayedSfxTimeRef.current > 250
          );
          if (pillEntering) {
            lastPlayedSfxTimeRef.current = next;
            audioProcessorRef.current.playCameraWhoosh();
          }
        }

        return next;
      });

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, durationMs, soundEnabled, telemetry, pills]);

  // Keyboard shortcuts: Space (play/pause), ArrowLeft/Right (seek), Z (add zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setCurrentTimeMs((t) => Math.max(0, t - 1000));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setCurrentTimeMs((t) => Math.min(durationMs, t + 1000));
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        if (!e.metaKey && !e.ctrlKey) {
          handleAddPillAtPlayhead(0.5, 0.5);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [durationMs]);

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
      setIsRecordingLive(true);
      await captureEngineRef.current.start({
        includeMic: true,
        frameRate: 60,
        onStop: () => {
          handleStopLiveRecording();
        }
      });

      // Clear record=true query param without refreshing page
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      // Notify service worker to initiate 120Hz DOM tracking on target tab
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          type: 'START_STUDIO_RECORDING',
          tabId: sourceTabId,
          focusTarget: Boolean(sourceTabId)
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('Capture canceled or rejected:', err);
      setIsRecordingLive(false);
    }
  };

  const handleStopLiveRecording = async (passedTelemetry?: TelemetryData | null) => {
    await captureEngineRef.current.stop();
    setIsRecordingLive(false);

    // Notify background worker recording stopped
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' }).catch(() => {});
    }

    const blob = await getRecordingBlob();
    if (blob) {
      // 1. Check if real DOM telemetry was captured by the recorded tab
      const realTelemetry = passedTelemetry || (await loadTelemetry());
      if (realTelemetry && realTelemetry.mousePoints && realTelemetry.mousePoints.length > 0) {
        console.log('[SmoothStudio] Loaded live recording with DOM telemetry:', realTelemetry);
        setupLoadedRecording(blob, realTelemetry);
        return;
      }

      // 2. Fullscreen / Window Fallback: If recorded outside Chrome tab, maintain clean full-frame view
      const actualDuration = Math.max(3000, Date.now() - (realTelemetry?.metadata?.startTime || Date.now() - 10000));

      const fallbackTelemetry: TelemetryData = {
        metadata: {
          id: 'live_' + Date.now(),
          startTime: Date.now() - actualDuration,
          endTime: Date.now(),
          durationMs: actualDuration,
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          title: 'Screen Recording'
        },
        mousePoints: [],
        clicks: [],
        keystrokes: [],
        inputEvents: []
      };

      setupLoadedRecording(blob, fallbackTelemetry);
    }
  };

  // Timeline Interactions
  const handleAddPillAtPlayhead = (targetX = 0.5, targetY = 0.5) => {
    const newPill: ZoomPill = {
      id: 'pill_' + Date.now(),
      startTime: Math.max(0, currentTimeMs - 200),
      endTime: Math.min(durationMs, currentTimeMs + 2400),
      targetX,
      targetY,
      targetScale: 1.8,
      tiltX: targetX > 0.5 ? -4 : 4,
      tiltY: targetX > 0.5 ? 6 : -6,
      spotlight: true,
      label: 'Custom Zoom'
    };
    setPills((prev) => [...prev, newPill].sort((a, b) => a.startTime - b.startTime));
  };

  const handleUpdatePill = (updated: ZoomPill) => {
    setPills((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleDeletePill = (id: string) => {
    setPills((prev) => prev.filter((p) => p.id !== id));
  };

  const handleCutAllSilences = () => {
    setSilences((prev) => prev.map((s) => ({ ...s, markedForCut: true })));
  };

  const handleToggleSilenceCut = (id: string) => {
    setSilences((prev) => prev.map((s) => (s.id === id ? { ...s, markedForCut: !s.markedForCut } : s)));
  };

  // MULTI-FORMAT ASSET EXPORTS (3 Assets from 1 Recording)

  // 1. Hardware 60fps MP4 Export
  const handleExportMp4 = async () => {
    if (!videoElement) return;
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
        cutSilences: silences.some((s) => s.markedForCut),
        showSpotlight,
        showCursor,
        showHud,
        metadata: telemetry?.metadata,
        onProgress: (pct) => setExportProgress(pct)
      });

      HardwareMp4Exporter.downloadBlob(mp4Blob, `${telemetry?.metadata.title || 'SmoothStudio'}_Cinematic.mp4`);
      setExportComplete(true);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Step-by-Step Markdown / Notion SOP Guide Export
  const handleExportSopGuide = () => {
    if (!telemetry) return;
    const md = SopGuideExporter.generateMarkdownGuide(telemetry, captureEngineRef.current.getSnapshots());
    SopGuideExporter.downloadMarkdown(md, `${telemetry.metadata.title || 'SOP'}_Guide.md`);
  };

  const handleCopySopGuide = async () => {
    if (!telemetry) return;
    try {
      const md = SopGuideExporter.generateMarkdownGuide(telemetry, captureEngineRef.current.getSnapshots());
      await navigator.clipboard.writeText(md);
      setCopiedSop(true);
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

          {/* Hardware MP4 Exporter */}
          <button
            onClick={handleExportMp4}
            disabled={isExporting}
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
          onSelectPreset={setPreset}
          aspectRatio={aspectRatio}
          onChangeAspectRatio={setAspectRatio}
          metadata={telemetry?.metadata}
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
          onUpdatePresetBorderRadius={(r) => setPreset((p) => ({ ...p, borderRadius: r }))}
        />

        {/* Center Canvas Preview Viewport */}
        <CanvasPreview
          video={videoElement}
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onRestart={() => setCurrentTimeMs(0)}
          pills={pills}
          cursorEngine={cursorEngineRef.current}
          keystrokes={telemetry?.keystrokes || []}
          preset={preset}
          aspectRatio={aspectRatio}
          showSpotlight={showSpotlight}
          showCursor={showCursor}
          showHud={showHud}
          followCursor={followCursor}
          metadata={telemetry?.metadata}
          onCanvasClickToAddZoom={handleAddPillAtPlayhead}
        />
      </div>

      {/* Bottom Magnetic Pill Multi-Track Timeline */}
      <MagneticTimeline
        durationMs={durationMs}
        currentTimeMs={currentTimeMs}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onSeek={setCurrentTimeMs}
        pills={pills}
        onUpdatePill={handleUpdatePill}
        onDeletePill={handleDeletePill}
        onAddPillAtPlayhead={() => handleAddPillAtPlayhead(0.5, 0.5)}
        silences={silences}
        onToggleSilenceCut={handleToggleSilenceCut}
        onCutAllSilences={handleCutAllSilences}
        keystrokes={telemetry?.keystrokes || []}
      />
    </div>
  );
}

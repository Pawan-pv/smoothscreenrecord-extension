import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  AspectRatioType,
  VibePreset,
  ZoomPill,
  KeystrokeEvent,
  SilenceSegment,
  CaptionBlock,
  CaptionStyle,
  CursorTheme
} from '../types/telemetry';
import { StudioRenderer, getAspectDimensions } from './renderer';
import { computeCinematicCameraState, SpringCameraSolver } from './spring-physics';
import { CursorSplineEngine } from './cursor-spline';
import { diagnosticChannel } from './diagnostic-channel';
import {
  PcmTrack,
  webmHasAudioTrack,
  decodeRecordingPcm,
  keepRangesFromCuts,
  cutPcmToKeepRanges,
  encodeAac,
  AAC_OUTPUT_CHANNELS
} from './audio-track';

export interface ExportOptions {
  videoSource: HTMLVideoElement | HTMLCanvasElement;
  videoBlob?: Blob | null;
  onRenderCanvasFrame?: (timeMs: number) => void;
  durationMs: number;
  aspectRatio: AspectRatioType;
  preset: VibePreset;
  pills: ZoomPill[];
  silences: SilenceSegment[];
  cursorEngine: CursorSplineEngine;
  keystrokes: KeystrokeEvent[];
  cutSilences: boolean;
  showSpotlight: boolean;
  showCursor: boolean;
  showHud: boolean;
  metadata?: { width: number; height: number };
  cursorTheme?: CursorTheme;
  cursorScale?: number;
  captions?: CaptionBlock[];
  captionStyle?: CaptionStyle;
  captionBackdrop?: number;
  showCaptions?: boolean;
  showIntroCard?: boolean;
  introHeadline?: string;
  introSubheadline?: string;
  showOutroCard?: boolean;
  outroHeadline?: string;
  outroCtaText?: string;
  targetWidth?: number;
  onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
}

export class HardwareMp4Exporter {
  private renderer: StudioRenderer;

  /** Hard safety limit for a single video seek. Exceeding it is an error, never a silent wrong frame. */
  private static readonly SEEK_TIMEOUT_MS = 2000;

  /**
   * Grace period for requestVideoFrameCallback after `seeked`.
   * The element must be rendered for rVFC to fire; an offscreen/background
   * window never presents frames, so we fall back to the (already correct)
   * `seeked` frame and remember that rVFC is not usable for this element.
   */
  private static readonly RVFC_GRACE_MS = 250;
  private rvfcUsable = true;
  private rvfcPresented = false;

  constructor() {
    this.renderer = new StudioRenderer();
  }

  /**
   * Waits until the video element really holds the frame at `targetTimeSec`.
   *
   * The previous implementation raced `seeked` / `requestVideoFrameCallback`
   * against a 25ms timer. Under load (e.g. 4x CPU throttling) the timer won
   * and the encoder silently wrote the PREVIOUS frame, producing duplicated
   * frames in the export. Now we wait for the real frame and throw a visible
   * error when the seek does not complete within 2 seconds.
   */
  private async seekToFrame(video: HTMLVideoElement, targetTimeSec: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let rafHandle: number | null = null;
      let timer: number | null = null;
      let graceTimer: number | null = null;

      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        if (rafHandle !== null && typeof (video as any).cancelVideoFrameCallback === 'function') {
          try { (video as any).cancelVideoFrameCallback(rafHandle); } catch { /* ignore */ }
        }
        if (timer !== null) clearTimeout(timer);
        if (graceTimer !== null) clearTimeout(graceTimer);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(reason));
      };

      const onSeeked = () => {
        if (settled) return;
        // `seeked` guarantees the decoder produced the frame for the new
        // currentTime, so the frame is already the CORRECT one.
        // requestVideoFrameCallback additionally guarantees the frame was
        // presented to the compositor. It only fires while the element is
        // actually being rendered (an offscreen/background window never
        // presents), so it is awaited with a bounded grace period and skipped
        // entirely once we know this element is not presented.
        if (this.rvfcUsable && typeof (video as any).requestVideoFrameCallback === 'function') {
          rafHandle = (video as any).requestVideoFrameCallback(() => {
            this.rvfcPresented = true;
            succeed();
          });
          graceTimer = window.setTimeout(() => {
            if (!this.rvfcPresented) this.rvfcUsable = false;
            succeed();
          }, HardwareMp4Exporter.RVFC_GRACE_MS);
        } else {
          succeed();
        }
      };

      video.addEventListener('seeked', onSeeked);
      timer = window.setTimeout(() => {
        fail(
          `Seek timeout: the video frame at ${targetTimeSec.toFixed(3)}s was not presented within ${HardwareMp4Exporter.SEEK_TIMEOUT_MS}ms.`
        );
      }, HardwareMp4Exporter.SEEK_TIMEOUT_MS);

      try {
        video.currentTime = targetTimeSec;
      } catch (err) {
        fail(`Seek failed at ${targetTimeSec.toFixed(3)}s: ${(err as any)?.message || err}`);
      }
    });
  }

  public async exportMp4(options: ExportOptions): Promise<Blob> {
    const {
      videoSource,
      videoBlob,
      onRenderCanvasFrame,
      durationMs,
      aspectRatio,
      preset,
      pills,
      silences,
      cursorEngine,
      keystrokes,
      cutSilences,
      showSpotlight,
      showCursor,
      showHud,
      onProgress
    } = options;

    const sourceW = (options.metadata?.width && options.metadata.width > 0) ? options.metadata.width : 1920;
    const targetBaseW = options.targetWidth || sourceW;
    const { width: outW, height: outH } = getAspectDimensions(aspectRatio, targetBaseW);

    // Create offscreen export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = outW;
    exportCanvas.height = outH;

    let video: HTMLVideoElement | HTMLCanvasElement = videoSource;
    let exportVideoUrl: string | null = null;
    let attachedExportVideo: HTMLVideoElement | null = null;
    if (videoBlob) {
      try {
        const dedicatedVideo = document.createElement('video');
        dedicatedVideo.muted = true;
        dedicatedVideo.playsInline = true;
        dedicatedVideo.preload = 'auto';
        // The element must live in the document, otherwise the compositor never
        // presents its frames and requestVideoFrameCallback never fires.
        dedicatedVideo.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(dedicatedVideo);
        attachedExportVideo = dedicatedVideo;
        exportVideoUrl = URL.createObjectURL(videoBlob);
        dedicatedVideo.src = exportVideoUrl;
        await new Promise<void>((resolve) => {
          if (dedicatedVideo.readyState >= 1) return resolve();
          dedicatedVideo.onloadedmetadata = () => resolve();
          dedicatedVideo.onerror = () => resolve();
          setTimeout(resolve, 1000);
        });
        video = dedicatedVideo;
      } catch (err) {
        console.warn('[SmoothStudio MP4 Exporter] Could not create dedicated video element:', err);
      }
    }

    const fps = 60;
    const frameIntervalMs = 1000 / fps;

    // Filter cut silences if requested.
    // When the Outro CTA card is enabled, clamp cut windows so the final 1.5s
    // (the outro animation) is never skipped in the exported video.
    const activeCutSilences = cutSilences
      ? silences
          .filter((s) => s.markedForCut)
          .map((s) =>
            options.showOutroCard
              ? { ...s, endTime: Math.min(s.endTime, Math.max(s.startTime, durationMs - 1500)) }
              : s
          )
          .filter((s) => s.endTime > s.startTime)
      : [];

    // C2: audio. If the recording has an audio track it MUST be decoded and
    // encoded; a failure aborts the export (no silent video-only MP4). The audio
    // is cut at exactly the same spans as the video timeline.
    let audioTrack: PcmTrack | null = null;
    if (videoBlob && (await webmHasAudioTrack(new Uint8Array(await videoBlob.slice(0, 4 * 1024 * 1024).arrayBuffer())))) {
      const decoded = await decodeRecordingPcm(videoBlob);
      audioTrack = cutPcmToKeepRanges(decoded, keepRangesFromCuts(activeCutSilences, durationMs));
    }

    // Build timeline frames to render (skipping cut silences)
    const timelineTimestamps: number[] = [];
    for (let t = 0; t <= durationMs; t += frameIntervalMs) {
      const isCut = activeCutSilences.some((s) => t >= s.startTime && t <= s.endTime);
      if (!isCut) {
        timelineTimestamps.push(t);
      }
    }

    const totalFrames = timelineTimestamps.length;
    console.log(`[SmoothStudio MP4 Exporter] Starting hardware export: ${totalFrames} frames at 60fps (${outW}x${outH})`);

    // Check if WebCodecs VideoEncoder is available
    const hasWebCodecs = typeof VideoEncoder !== 'undefined';

    try {
      if (hasWebCodecs) {
        return await this.exportWithWebCodecs({
          video,
          onRenderCanvasFrame,
          exportCanvas,
          outW,
          outH,
          fps,
          durationMs,
          totalFrames,
          timelineTimestamps,
          pills,
          preset,
          aspectRatio,
          cursorEngine,
          keystrokes,
          showSpotlight,
          showCursor,
          showHud,
          metadata: options.metadata,
          cursorTheme: options.cursorTheme,
          cursorScale: options.cursorScale,
          captions: options.captions,
          captionStyle: options.captionStyle,
          captionBackdrop: options.captionBackdrop,
          showCaptions: options.showCaptions,
          showIntroCard: options.showIntroCard,
          introHeadline: options.introHeadline,
          introSubheadline: options.introSubheadline,
          showOutroCard: options.showOutroCard,
          outroHeadline: options.outroHeadline,
          outroCtaText: options.outroCtaText,
          onProgress,
          audioTrack
        });
      }

      if (audioTrack) {
        throw new Error('This browser has no WebCodecs support, so the MP4 export cannot include the recording audio. Export aborted.');
      }

      // Fallback exporter only if WebCodecs is completely unavailable
      return await this.exportWithCanvasStream({
        video,
        onRenderCanvasFrame,
        exportCanvas,
        durationMs,
        timelineTimestamps,
        pills,
        preset,
        aspectRatio,
        cursorEngine,
        keystrokes,
        showSpotlight,
        showCursor,
        showHud,
        metadata: options.metadata,
        cursorTheme: options.cursorTheme,
        cursorScale: options.cursorScale,
        captions: options.captions,
        captionStyle: options.captionStyle,
        captionBackdrop: options.captionBackdrop,
        showCaptions: options.showCaptions,
        showIntroCard: options.showIntroCard,
        introHeadline: options.introHeadline,
        introSubheadline: options.introSubheadline,
        showOutroCard: options.showOutroCard,
        outroHeadline: options.outroHeadline,
        outroCtaText: options.outroCtaText,
        onProgress
      });
    } finally {
      if (exportVideoUrl) {
        URL.revokeObjectURL(exportVideoUrl);
      }
      if (attachedExportVideo) {
        try { attachedExportVideo.remove(); } catch { /* ignore */ }
      }
    }
  }

  private async exportWithWebCodecs(params: {
    video: HTMLVideoElement | HTMLCanvasElement;
    audioTrack?: PcmTrack | null;
    onRenderCanvasFrame?: (timeMs: number) => void;
    exportCanvas: HTMLCanvasElement;
    outW: number;
    outH: number;
    fps: number;
    durationMs: number;
    totalFrames: number;
    timelineTimestamps: number[];
    pills: ZoomPill[];
    preset: VibePreset;
    aspectRatio: AspectRatioType;
    cursorEngine: CursorSplineEngine;
    keystrokes: KeystrokeEvent[];
    showSpotlight: boolean;
    showCursor: boolean;
    showHud: boolean;
    metadata?: { width: number; height: number };
    cursorTheme?: CursorTheme;
    cursorScale?: number;
    captions?: CaptionBlock[];
    captionStyle?: CaptionStyle;
    captionBackdrop?: number;
    showCaptions?: boolean;
    showIntroCard?: boolean;
    introHeadline?: string;
    introSubheadline?: string;
    showOutroCard?: boolean;
    outroHeadline?: string;
    outroCtaText?: string;
    onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
  }): Promise<Blob> {
    const {
      video,
      audioTrack,
      onRenderCanvasFrame,
      exportCanvas,
      outW,
      outH,
      fps,
      durationMs,
      totalFrames,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
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
      onProgress
    } = params;

    if (totalFrames <= 0) {
      throw new Error('No timeline frames to encode into MP4.');
    }

    let isFinalized = false;
    let encodedChunksCount = 0;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: outW,
        height: outH
      },
      ...(audioTrack ? {
        audio: {
          codec: 'aac' as const,
          numberOfChannels: AAC_OUTPUT_CHANNELS,
          sampleRate: audioTrack.sampleRate
        }
      } : {}),
      fastStart: 'in-memory'
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (!isFinalized) {
          try {
            encodedChunksCount++;
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const durationMicros = (typeof chunk.duration === 'number' && Number.isFinite(chunk.duration) && chunk.duration > 0)
              ? chunk.duration
              : Math.round((1 / fps) * 1_000_000);

            muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, durationMicros, meta);
          } catch (muxErr) {
            console.error('[SmoothStudio VideoEncoder Output Mux Error]', muxErr);
          }
        }
      },
      error: (e) => {
        console.error('[SmoothStudio VideoEncoder Error]', e);
        diagnosticChannel.recordFrameDrop((e as any)?.message || String(e));
      }
    });

    const is4K = outW >= 3840 || outH >= 2160;
    let targetBitrate = 14_000_000;
    if (is4K) {
      targetBitrate = 38_000_000; // 4K60 ~38 Mbps (35-40 Mbps)
    } else if (outW >= 2560 || outH >= 1440) {
      targetBitrate = 22_000_000; // 1440p ~22 Mbps
    } else if (outW >= 1920 || outH >= 1080) {
      targetBitrate = 14_000_000; // 1080p ~14 Mbps
    } else {
      targetBitrate = 6_000_000;  // 720p ~6 Mbps
    }
    let chosenCodec = is4K ? 'avc1.640033' : 'avc1.640028';
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: chosenCodec,
        width: outW,
        height: outH,
        bitrate: targetBitrate,
        framerate: fps
      });
      if (!support.supported) {
        chosenCodec = is4K ? 'avc1.4d0033' : 'avc1.4D002A';
      }
    } catch {
      chosenCodec = is4K ? 'avc1.4d0033' : 'avc1.4D002A';
    }

    // Configure H.264 profile
    videoEncoder.configure({
      codec: chosenCodec,
      width: outW,
      height: outH,
      bitrate: targetBitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime'
    });

    const springCamera = new SpringCameraSolver();
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(
        timelineTimestamps[0],
        pills,
        cursorEngine.getCursorAt(timelineTimestamps[0]),
        metadata?.width || outW,
        metadata?.height || outH,
        true
      );
      springCamera.snapTo(firstTarget);
    }

    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      const cursor = cursorEngine.getCursorAt(currentMs);
      const targetCamera = computeCinematicCameraState(
        currentMs,
        pills,
        cursor,
        metadata?.width || outW,
        metadata?.height || outH,
        true
      );
      springCamera.setTarget(targetCamera);
      const camera = f === 0 ? targetCamera : springCamera.update(1 / fps);
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);

      // Seek video to frame timestamp or render canvas frame
      if (video instanceof HTMLVideoElement) {
        const targetTimeSec = currentMs / 1000;
        if (Math.abs(video.currentTime - targetTimeSec) > 0.005) {
          video.currentTime = targetTimeSec;
          await this.seekToFrame(video, targetTimeSec);
        }
      } else if (onRenderCanvasFrame) {
        onRenderCanvasFrame(currentMs);
      }

      // Render composite frame
      this.renderer.renderFrame({
        canvas: exportCanvas,
        video,
        currentTimeMs: currentMs,
        durationMs,
        camera,
        activePill,
        cursorEngine,
        keystrokes,
        preset,
        aspectRatio,
        showSpotlight,
        showCursor,
        showHud,
        metadata,
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
        outroCtaText
      });

      // Encode frame
      const frameTimestampMicroseconds = Math.round((f / fps) * 1_000_000);
      const frameDurationMicroseconds = Math.round((1 / fps) * 1_000_000);
      const videoFrame = new VideoFrame(exportCanvas, {
        timestamp: frameTimestampMicroseconds,
        duration: frameDurationMicroseconds
      });

      const isKeyFrame = f === 0 || f % 120 === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Yield to the event loop and apply backpressure only if encoder queue is filling excessively
      if (videoEncoder.encodeQueueSize > 30) {
        while (videoEncoder.encodeQueueSize > 15) {
          await new Promise((r) => setTimeout(r, 2));
        }
      }

      if (f % 60 === 0) {
        const percent = Math.round(((f + 1) / totalFrames) * 100);
        console.log(`[SmoothStudio MP4 Exporter] Encoded frame ${f}/${totalFrames} (${percent}%)`);
        if (onProgress) {
          onProgress(percent, f + 1, totalFrames);
        }
      } else if (f % 15 === 0 && onProgress) {
        const percent = Math.round(((f + 1) / totalFrames) * 100);
        onProgress(percent, f + 1, totalFrames);
      }
    }

    if (onProgress) {
      onProgress(100, totalFrames, totalFrames);
    }

    // Drain remaining encoder queue before flushing
    let drainWait = 0;
    while (videoEncoder.encodeQueueSize > 0 && drainWait < 200) {
      await new Promise((r) => setTimeout(r, 10));
      drainWait++;
    }

    try {
      await Promise.race([
        videoEncoder.flush(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Flush timeout')), 5000))
      ]);
    } catch (flushErr) {
      console.warn('[SmoothStudio MP4 Exporter] Flush completed or notice:', flushErr);
    }

    if (encodedChunksCount === 0) {
      throw new Error(`VideoEncoder did not produce any encoded video chunks for ${totalFrames} frames.`);
    }

    // C2: encode the cut audio and mux it next to the video. Errors propagate.
    if (audioTrack) {
      const audioChunkCount = await encodeAac(audioTrack, (chunk) => {
        muxer.addAudioChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration, chunk.meta);
      });
      if (audioChunkCount === 0) {
        throw new Error('The AAC encoder produced no audio chunks. Export aborted.');
      }
      console.log(`[SmoothStudio MP4 Exporter] Muxed ${audioChunkCount} AAC chunks (${audioTrack.sampleRate} Hz).`);
    }

    isFinalized = true;
    muxer.finalize();
    try {
      videoEncoder.close();
    } catch {
      // Ignored if already closed
    }

    const buffer = muxer.target.buffer;
    const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
    console.log('[SmoothStudio MP4 Exporter] Hardware MP4 export completed! Size:', (mp4Blob.size / 1024 / 1024).toFixed(2), 'MB');
    return mp4Blob;
  }

  // Fallback using HTML5 Canvas captureStream + MediaRecorder
  private async exportWithCanvasStream(params: {
    video: HTMLVideoElement | HTMLCanvasElement;
    onRenderCanvasFrame?: (timeMs: number) => void;
    exportCanvas: HTMLCanvasElement;
    durationMs: number;
    timelineTimestamps: number[];
    pills: ZoomPill[];
    preset: VibePreset;
    aspectRatio: AspectRatioType;
    cursorEngine: CursorSplineEngine;
    keystrokes: KeystrokeEvent[];
    showSpotlight: boolean;
    showCursor: boolean;
    showHud: boolean;
    metadata?: { width: number; height: number };
    cursorTheme?: CursorTheme;
    cursorScale?: number;
    captions?: CaptionBlock[];
    captionStyle?: CaptionStyle;
    captionBackdrop?: number;
    showCaptions?: boolean;
    showIntroCard?: boolean;
    introHeadline?: string;
    introSubheadline?: string;
    showOutroCard?: boolean;
    outroHeadline?: string;
    outroCtaText?: string;
    onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
  }): Promise<Blob> {
    const {
      video,
      onRenderCanvasFrame,
      exportCanvas,
      durationMs,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
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
      onProgress
    } = params;

    const stream = exportCanvas.captureStream(60);
    const chunks: Blob[] = [];
    let fallbackBps = 14_000_000;
    const canW = exportCanvas.width;
    const canH = exportCanvas.height;
    if (canW >= 3840 || canH >= 2160) {
      fallbackBps = 38_000_000;
    } else if (canW >= 2560 || canH >= 1440) {
      fallbackBps = 22_000_000;
    } else if (canW >= 1920 || canH >= 1080) {
      fallbackBps = 14_000_000;
    } else {
      fallbackBps = 6_000_000;
    }

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm; codecs=vp9') ? 'video/webm; codecs=vp9' : 'video/webm',
      videoBitsPerSecond: fallbackBps
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();

    const totalFrames = timelineTimestamps.length;
    const springCameraFallback = new SpringCameraSolver();
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(
        timelineTimestamps[0],
        pills,
        cursorEngine.getCursorAt(timelineTimestamps[0]),
        metadata?.width || exportCanvas.width,
        metadata?.height || exportCanvas.height,
        true
      );
      springCameraFallback.snapTo(firstTarget);
    }

    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      const cursor = cursorEngine.getCursorAt(currentMs);
      const targetCamera = computeCinematicCameraState(
        currentMs,
        pills,
        cursor,
        metadata?.width || exportCanvas.width,
        metadata?.height || exportCanvas.height,
        true
      );
      springCameraFallback.setTarget(targetCamera);
      const camera = f === 0 ? targetCamera : springCameraFallback.update(1 / 60);
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
      if (video instanceof HTMLVideoElement) {
        const targetTimeSec = currentMs / 1000;
        video.currentTime = targetTimeSec;
        await this.seekToFrame(video, targetTimeSec);
      } else if (onRenderCanvasFrame) {
        onRenderCanvasFrame(currentMs);
      }

      this.renderer.renderFrame({
        canvas: exportCanvas,
        video,
        currentTimeMs: currentMs,
        durationMs,
        camera,
        activePill,
        cursorEngine,
        keystrokes,
        preset,
        aspectRatio,
        showSpotlight,
        showCursor,
        showHud,
        metadata,
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
        outroCtaText
      });

      if (f % 10 === 0) {
        await new Promise((r) => setTimeout(r, 2));
      }

      if (f % 15 === 0 && onProgress) {
        onProgress(Math.round(((f + 1) / totalFrames) * 100), f + 1, totalFrames);
      }
    }

    if (onProgress) {
      onProgress(100, totalFrames, totalFrames);
    }

    return new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        resolve(new Blob(chunks, { type: 'video/webm' }));
      };
      mediaRecorder.stop();
    });
  }

  // Trigger browser file download
  public static downloadBlob(blob: Blob, filename = 'SmoothStudio_Export.mp4') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }
}

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
import { computeCinematicCameraState } from './spring-physics';
import { CursorSplineEngine } from './cursor-spline';
import { diagnosticChannel } from './diagnostic-channel';
import {
  PcmTrack,
  webmHasAudioTrack,
  decodeRecordingPcm,
  keepRangesFromCuts,
  cutPcmToKeepRanges,
  encodeAac,
  pcmDurationMs,
  AAC_OUTPUT_CHANNELS
} from './audio-track';
import { VideoFrameSeeker } from './video-seeker';
import { SequentialVideoFrameSource } from './sequential-frame-source';
import { resolveExportTimelineMs, clampTrimBounds } from './export-timeline';

function abortError(): Error {
  const err = new Error('The export was cancelled.');
  err.name = 'AbortError';
  return err;
}


export interface ExportOptions {
  videoSource?: HTMLVideoElement | HTMLCanvasElement;
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
  framePadding?: number;
  backgroundColor?: string | null;
  backgroundImage?: CanvasImageSource | null;
  targetWidth?: number;
  /** Cancels the export during a seek or between frames. */
  signal?: AbortSignal;
  /** Real container duration of the recording, when known. */
  mediaDurationMs?: number;
  trimStartMs?: number;
  trimEndMs?: number;
  onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
}

export class HardwareMp4Exporter {
  private renderer: StudioRenderer;

  constructor() {
    this.renderer = new StudioRenderer();
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
      framePadding,
      backgroundColor,
      backgroundImage,
      signal,
      onProgress
    } = options;
    if (signal?.aborted) throw abortError();
    const wallClockDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    const containerDurationMs = Number.isFinite(options.mediaDurationMs) && (options.mediaDurationMs as number) > 0
      ? (options.mediaDurationMs as number)
      : 0;

    const sourceW = (options.metadata?.width && options.metadata.width > 0) ? options.metadata.width : 1920;
    const targetBaseW = options.targetWidth || sourceW;
    const { width: outW, height: outH } = getAspectDimensions(aspectRatio, targetBaseW);

    // Create offscreen export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = outW;
    exportCanvas.height = outH;

    let video: HTMLVideoElement | HTMLCanvasElement = videoSource || document.createElement('canvas');
    let exportVideoUrl: string | null = null;
    let attachedExportVideo: HTMLVideoElement | null = null;
    let frameSource: SequentialVideoFrameSource | null = null;
    let stagingCanvas: HTMLCanvasElement | null = null;
    // Every resource below is released in the finally block, including when
    // audio decoding or cut validation throws before the frame loop starts.
    try {
    // QA-001: decode the recording once, in order, with WebCodecs. Seeking a
    // <video> per output frame re-decodes from the previous keyframe every time
    // (O(GOP) per frame) and is only kept as the fallback path.
    if (videoBlob && typeof VideoEncoder !== 'undefined') {
      const opened = await SequentialVideoFrameSource.open(videoBlob);
      if (opened.ok) {
        frameSource = opened.source;
        stagingCanvas = document.createElement('canvas');
        stagingCanvas.width = frameSource.width || sourceW;
        stagingCanvas.height = frameSource.height || Math.round(sourceW * 9 / 16);
        video = stagingCanvas;
        console.log(`[SmoothStudio MP4 Exporter] Frame source: sequential ${frameSource.codec} decode (${frameSource.frameCount} frames).`);
      } else {
        console.warn(`[SmoothStudio MP4 Exporter] Frame source: <video> seeks (${opened.reason}).`);
      }
    }
    if (videoBlob && !frameSource) {
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

    // C2: audio. If the recording has an audio track it MUST be decoded and
    // encoded; a failure aborts the export (no silent video-only MP4).
    // The decoded PCM is already on the media timeline (track-start aligned).
    let decodedPcm: PcmTrack | null = null;
    if (videoBlob && (await webmHasAudioTrack(new Uint8Array(await videoBlob.slice(0, 4 * 1024 * 1024).arrayBuffer())))) {
      decodedPcm = await decodeRecordingPcm(videoBlob);
    }
    const audioEndMs = decodedPcm ? pcmDurationMs(decodedPcm) : 0;

    // QA-002 + QA-009: the real tracks beat the padded durations. The video
    // ends on the last decoded frame PTS (the wall clock and the WebM container
    // both include ~190 ms of trailing encoder padding, which used to be
    // exported as a frozen tail); audio that outlives the video still extends
    // the timeline and the video holds its last frame for that tail.
    const timelineDurationMs = resolveExportTimelineMs({
      wallClockDurationMs,
      containerDurationMs,
      audioEndMs,
      lastVideoPtsMs: frameSource ? frameSource.lastTimestampUs / 1000 : 0
    });
    if (timelineDurationMs <= 0) {
      throw new Error('The recording has no timeline: duration, container and audio are all empty.');
    }

    const { trimStartMs: effTrimStart, trimEndMs: effTrimEnd } = clampTrimBounds(
      timelineDurationMs,
      options.trimStartMs,
      options.trimEndMs
    );

    // Filter cut silences if requested.
    // When the Outro CTA card is enabled, clamp cut windows so the final 1.5s
    // (the outro animation) is never skipped in the exported video.
    const activeCutSilences = cutSilences
      ? silences
          .filter((s) => s.markedForCut)
          .map((s) =>
            options.showOutroCard
              ? { ...s, endTime: Math.min(s.endTime, Math.max(s.startTime, effTrimEnd - 1500)) }
              : s
          )
          .filter((s) => s.endTime > s.startTime)
      : [];

    const audioTrack = decodedPcm
      ? cutPcmToKeepRanges(decodedPcm, keepRangesFromCuts(activeCutSilences, timelineDurationMs, effTrimStart, effTrimEnd))
      : null;

    // Build timeline frames to render (skipping cut silences)
    const timelineTimestamps: number[] = [];
    for (let t = effTrimStart; t <= effTrimEnd; t += frameIntervalMs) {
      const isCut = activeCutSilences.some((s) => t >= s.startTime && t <= s.endTime);
      if (!isCut) {
        timelineTimestamps.push(t);
      }
    }

    const totalFrames = timelineTimestamps.length;
    console.log(`[SmoothStudio MP4 Exporter] Starting hardware export: ${totalFrames} frames at 60fps (${outW}x${outH})`);

    // Check if WebCodecs VideoEncoder is available
    const hasWebCodecs = typeof VideoEncoder !== 'undefined';

      if (hasWebCodecs) {
        return await this.exportWithWebCodecs({
          video,
          frameSource,
          stagingCanvas,
          onRenderCanvasFrame,
          exportCanvas,
          outW,
          outH,
          fps,
          durationMs: effTrimEnd,
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
          signal,
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
          framePadding,
          backgroundColor,
          backgroundImage,
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
        durationMs: effTrimEnd,
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
        framePadding,
        backgroundColor,
        backgroundImage,
        onProgress
      });
    } finally {
      frameSource?.close();
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
    /** Sequential decoder of the recording; when set, `stagingCanvas` is the render source. */
    frameSource?: SequentialVideoFrameSource | null;
    stagingCanvas?: HTMLCanvasElement | null;
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
    framePadding?: number;
    backgroundColor?: string | null;
    backgroundImage?: CanvasImageSource | null;
    /** Cancels the export during a seek or between frames. */
    signal?: AbortSignal;
    onProgress?: (percent: number, currentFrame: number, totalFrames: number) => void;
  }): Promise<Blob> {
    const {
      video,
      frameSource,
      stagingCanvas,
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
      framePadding,
      backgroundColor,
      backgroundImage,
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
      signal,
      onProgress
    } = params;

    if (totalFrames <= 0) {
      throw new Error('No timeline frames to encode into MP4.');
    }
    if (signal?.aborted) throw abortError();

    // QA-001: one deterministic seeker for the whole export. It clamps to the
    // real seekable range, assigns currentTime once, and treats "already on the
    // requested frame" as a success instead of waiting for an event Chrome will
    // never fire. Disposed in the finally block below.
    const frameSeeker = !frameSource && video instanceof HTMLVideoElement ? new VideoFrameSeeker(video) : null;
    if (frameSeeker) {
      await frameSeeker.waitUntilReady(signal);
    }
    const stagingCtx = frameSource && stagingCanvas ? stagingCanvas.getContext('2d') : null;
    if (frameSource && !stagingCtx) {
      throw new Error('Could not create the 2D context that receives the decoded recording frames.');
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

    try {
    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      const cursor = cursorEngine.getCursorAt(currentMs);
      const camera = computeCinematicCameraState(
        currentMs,
        pills,
        cursor,
        metadata?.width || outW,
        metadata?.height || outH,
        true
      );
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);

      if (signal?.aborted) throw abortError();
      // Select the recording frame on screen at this timeline time.
      if (frameSource && stagingCanvas && stagingCtx) {
        if (videoEncoder.encodeQueueSize > 12) {
          while (videoEncoder.encodeQueueSize > 6) {
            if (signal?.aborted) throw abortError();
            await new Promise((r) => setTimeout(r, 2));
          }
        }
        const frame = await frameSource.frameAt(currentMs, signal);
        if (stagingCanvas.width !== frame.displayWidth || stagingCanvas.height !== frame.displayHeight) {
          stagingCanvas.width = frame.displayWidth;
          stagingCanvas.height = frame.displayHeight;
        }
        stagingCtx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
      } else if (video instanceof HTMLVideoElement && frameSeeker) {
        // Backpressure BEFORE the seek: a saturated encoder queue starves the
        // decoder, which is what made a healthy seek look like a timeout.
        if (videoEncoder.encodeQueueSize > 12) {
          while (videoEncoder.encodeQueueSize > 6) {
            if (signal?.aborted) throw abortError();
            await new Promise((r) => setTimeout(r, 2));
          }
        }
        await frameSeeker.seekTo(currentMs / 1000, signal);
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
        outroCtaText,
        framePadding,
        backgroundColor,
        backgroundImage
      });

      // Encode frame
      const frameTimestampMicroseconds = Math.round((f / fps) * 1_000_000);
      const frameDurationMicroseconds = Math.round((1 / fps) * 1_000_000);
      const videoFrame = new VideoFrame(exportCanvas, {
        timestamp: frameTimestampMicroseconds,
        duration: frameDurationMicroseconds
      });

      const isKeyFrame = f === 0 || f % 120 === 0;
      // encode() can throw (a closed encoder, an invalid frame); the frame must
      // be released on that path too, not only after a successful encode.
      try {
        videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      } finally {
        videoFrame.close();
      }

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
    if (frameSource) {
      console.log(`[SmoothStudio MP4 Exporter] Frame source decoded ${frameSource.decodedChunks} of ${frameSource.frameCount} recording frames (${frameSource.restarts} keyframe restarts).`);
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
    } catch (err) {
      // Stop the encoder from muxing into a half-written file and release it.
      isFinalized = true;
      try { videoEncoder.close(); } catch { /* already closed */ }
      throw err;
    } finally {
      frameSeeker?.dispose();
    }
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
    framePadding?: number;
    backgroundColor?: string | null;
    backgroundImage?: CanvasImageSource | null;
    /** Cancels the export during a seek or between frames. */
    signal?: AbortSignal;
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
      framePadding,
      backgroundColor,
      backgroundImage,
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
    const fallbackSeeker = video instanceof HTMLVideoElement ? new VideoFrameSeeker(video) : null;
    if (fallbackSeeker) {
      await fallbackSeeker.waitUntilReady();
    }

    try {
    for (let f = 0; f < totalFrames; f++) {
      const currentMs = timelineTimestamps[f];

      const cursor = cursorEngine.getCursorAt(currentMs);
      const camera = computeCinematicCameraState(
        currentMs,
        pills,
        cursor,
        metadata?.width || exportCanvas.width,
        metadata?.height || exportCanvas.height,
        true
      );
      const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
      if (video instanceof HTMLVideoElement && fallbackSeeker) {
        await fallbackSeeker.seekTo(currentMs / 1000);
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
        outroCtaText,
        framePadding,
        backgroundColor,
        backgroundImage
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
    } finally {
      fallbackSeeker?.dispose();
    }
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

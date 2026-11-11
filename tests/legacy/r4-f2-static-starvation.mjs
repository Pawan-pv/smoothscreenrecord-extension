/**
 * F2 — Static-page frame starvation must be fixed INSIDE THE RECORDER.
 *
 * Fixture: tests/test-target.html is FULLY STATIC (no rAF, no setInterval, no CSS animation).
 * Recording: 10s total, with the last 6s completely idle.
 *
 * PASS criteria:
 *   - raw WebM duration within +/-0.3s of the wall clock duration of the session
 *   - the raw frame timeline has no holes (max gap between consecutive frames < 0.5s)
 *   - exported MP4 (auto-cut OFF) within +/-0.1s of the raw duration
 *
 * NOTE: no --use-fake-device-for-media-stream is used anywhere.
 */
import path from 'path';
import fs from 'fs';
import {
  serveFixture, launch, extensionId, ffprobeJson, ffprobeText,
  framePts, videoSize, outDir, sleep, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-f2');
const PORT = 8811;

const server = await serveFixture('test-target.html', PORT);
console.log(`[F2] Static fixture server on http://localhost:${PORT}`);

const context = await launch({
  args: [
    '--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App'
  ]
});

let failed = false;
try {
  const extId = await extensionId(context);
  console.log('[F2] Extension ID:', extId);

  const target = await context.newPage();
  await target.setViewportSize({ width: 1280, height: 720 });
  await target.goto(`http://localhost:${PORT}`);
  await target.waitForSelector('#btn-deploy');

  // Prove the fixture really is static: sample the DOM twice, 2s apart.
  const htmlA = await target.evaluate(() => document.body.innerHTML.length + '|' + document.body.innerText.length);
  await sleep(2000);
  const htmlB = await target.evaluate(() => document.body.innerHTML.length + '|' + document.body.innerText.length);
  console.log('[F2] Fixture DOM signature t0:', htmlA);
  console.log('[F2] Fixture DOM signature t+2s:', htmlB);
  if (htmlA !== htmlB) {
    console.error('[F2] FAIL: the fixture page is not static.');
    failed = true;
  }
  const rafCount = await target.evaluate(async () => {
    let n = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const loop = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(loop); else res(); };
      requestAnimationFrame(loop);
    });
    return n;
  });
  console.log('[F2] Fixture rAF ticks in 1s (proof the page renders on demand only):', rafCount);

  const editor = await context.newPage();
  editor.on('console', (m) => console.log('[Editor Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[Editor Error]', e.message));
  await editor.setViewportSize({ width: 1280, height: 720 });
  await editor.goto(`chrome-extension://${extId}/editor.html`);
  await editor.waitForLoadState('networkidle');

  // Start the recording programmatically so the captured window keeps focus.
  await target.bringToFront();
  await sleep(800);
  await editor.evaluate(() => window.__startLiveRecording(undefined, false));
  await editor.waitForFunction(() => !!window.__captureEngine?.getTimelineOriginEpoch(), { timeout: 20000 });
  const originEpoch = await editor.evaluate(() => window.__captureEngine.getTimelineOriginEpoch());
  console.log('[F2] Timeline origin (epoch ms):', originEpoch);

  // --- 4s of activity -------------------------------------------------
  const actStart = Date.now();
  for (let i = 0; i < 20; i++) {
    await target.mouse.move(120 + i * 25, 480 + Math.sin(i * 0.4) * 60);
    await sleep(100);
  }
  await target.click('#btn-deploy');
  console.log(`[F2] Activity phase done after ${Date.now() - actStart}ms`);
  console.log('[F2] Target page visibility after activity:', JSON.stringify(await target.evaluate(() => ({ v: document.visibilityState, h: document.hidden, focus: document.hasFocus() }))));

  // --- 6s completely idle ---------------------------------------------
  const idleStart = Date.now();
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    const s = await editor.evaluate(() => ({
      pump: window.__captureEngine.getPumpFrameCount(),
      vis: document.visibilityState,
      hidden: document.hidden,
      now: Date.now()
    }));
    samples.push(s);
  }
  const idleDuration = Date.now() - idleStart;
  console.log(`[F2] Idle phase duration: ${idleDuration}ms`);
  for (const s of samples) {
    console.log(`[F2]   sample pump=${s.pump} visibility=${s.vis} hidden=${s.hidden} t=${s.now - originEpoch}ms`);
  }

  const stopEpoch = Date.now();
  await editor.evaluate(() => window.__stopLiveRecording());
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 30000 });
  await sleep(500);

  const wallClockMs = stopEpoch - originEpoch;
  console.log('[F2] Wall-clock recording duration (stopEpoch - originEpoch):', wallClockMs, 'ms');

  // --- Save the raw recording -----------------------------------------
  const rawBytes = await editor.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('smoothstudio_recording.webm');
    const f = await fh.getFile();
    return Array.from(new Uint8Array(await f.arrayBuffer()));
  });
  const rawPath = path.join(OUT, 'r4_f2_raw.webm');
  fs.writeFileSync(rawPath, Buffer.from(rawBytes));
  console.log('[F2] Raw WebM saved:', rawPath, fs.statSync(rawPath).size, 'bytes');

  const probe = ffprobeJson(['-show_format', '-show_streams', rawPath]);
  console.log('[F2] ffprobe format:', JSON.stringify(probe.format, null, 2));
  const vstream = probe.streams.find((s) => s.codec_type === 'video');
  console.log('[F2] ffprobe video stream:', JSON.stringify({
    codec: vstream.codec_name, width: vstream.width, height: vstream.height,
    duration: vstream.duration, avg_frame_rate: vstream.avg_frame_rate
  }));

  const pts = framePts(rawPath);
  const rawDuration = videoSize(rawPath).duration;
  let maxGap = 0;
  for (let i = 1; i < pts.length; i++) maxGap = Math.max(maxGap, pts[i] - pts[i - 1]);
  console.log('[F2] Raw frame count:', pts.length);
  console.log('[F2] Raw first PTS:', pts[0], 's   Raw last PTS:', pts[pts.length - 1], 's');
  console.log('[F2] Raw container duration:', rawDuration.toFixed(3), 's');
  console.log('[F2] Raw max inter-frame gap:', maxGap.toFixed(3), 's');

  // --- Export MP4 with auto-cut OFF ------------------------------------
  const mp4B64 = await editor.evaluate(async () => {
    const videoEl = window.__lastLoadedVideoElement || window.__smoothstudio_video;
    const blob = window.__lastLoadedVideoBlob;
    const exporter = new window.__HardwareMp4Exporter();
    const durationMs = window.__durationMs || 10000;
    const mp4 = await exporter.exportMp4({
      videoSource: videoEl,
      videoBlob: blob,
      durationMs,
      aspectRatio: '16:9',
      preset: window.__VIBE_PRESETS['keynote-pro'],
      pills: [],
      silences: [],
      cursorEngine: { getCursorAt: () => ({ x: 0.5, y: 0.5, visible: false }) },
      keystrokes: [],
      cutSilences: false,
      showSpotlight: false,
      showCursor: false,
      showHud: false,
      targetWidth: 1280
    });
    const reader = new FileReader();
    return new Promise((res) => {
      reader.onloadend = () => res(reader.result.split(',')[1]);
      reader.readAsDataURL(mp4);
    });
  });
  const mp4Path = path.join(OUT, 'r4_f2_export.mp4');
  fs.writeFileSync(mp4Path, Buffer.from(mp4B64, 'base64'));
  const mp4Duration = videoSize(mp4Path).duration;
  console.log('[F2] Exported MP4 duration (auto-cut OFF):', mp4Duration.toFixed(3), 's');

  // --- PASS checks ------------------------------------------------------
  const rawVsWall = Math.abs(rawDuration - wallClockMs / 1000);
  console.log(`[F2] |raw duration - wall clock| = ${rawVsWall.toFixed(3)}s  (limit 0.300s)`);
  if (rawVsWall > 0.3) { console.error('[F2] FAIL: raw duration is not within +/-0.3s of the wall clock.'); failed = true; }

  const lastVsWall = Math.abs(pts[pts.length - 1] - wallClockMs / 1000);
  console.log(`[F2] |last frame PTS - wall clock| = ${lastVsWall.toFixed(3)}s  (limit 0.300s)`);
  if (lastVsWall > 0.3) { console.error('[F2] FAIL: the recorded frame timeline does not end at the wall clock time.'); failed = true; }

  if (maxGap > 0.5) { console.error(`[F2] FAIL: frame starvation — a ${maxGap.toFixed(3)}s hole exists in the raw timeline.`); failed = true; }

  const exportVsRaw = Math.abs(mp4Duration - rawDuration);
  console.log(`[F2] |export duration - raw duration| = ${exportVsRaw.toFixed(3)}s  (limit 0.100s)`);
  if (exportVsRaw > 0.1) { console.error('[F2] FAIL: exported duration differs from the raw duration by more than 0.1s.'); failed = true; }

  console.log(failed ? '[F2] RESULT: FAIL' : '[F2] RESULT: PASS');
} catch (err) {
  console.error('[F2] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);

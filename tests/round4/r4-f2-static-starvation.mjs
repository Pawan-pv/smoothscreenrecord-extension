/**
 * F2 — Static-page frame starvation must be fixed INSIDE THE RECORDER.
 *
 * Fixture: tests/test-target.html is FULLY STATIC (no rAF, no setInterval, no CSS animation).
 * Recording: 10s total, with the last 6s completely idle.
 *
 * The recording is driven through the REAL product UI. The start/stop buttons
 * are clicked programmatically (element.click()) so that the OS focus stays on
 * the captured window - a focus change would pause the captured surface's
 * compositor, which is an environment artifact, not a product defect.
 *
 * PASS criteria:
 *   - raw WebM duration within +/-0.3s of the wall-clock duration of the session
 *   - exported MP4 (auto-cut OFF) within +/-0.1s of the raw duration
 *
 * NOTE: no --use-fake-device-for-media-stream is used anywhere.
 */
import path from 'path';
import fs from 'fs';
import {
  serveFixture, launch, extensionId, ffprobeJson,
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
  const timers = await target.evaluate(() => ({
    raf: !!window.__rafProbe,
    intervals: typeof window.setInterval,
    html: document.querySelectorAll('*').length
  }));
  console.log('[F2] Fixture DOM node count:', timers.html);

  const editor = await context.newPage();
  editor.on('console', (m) => console.log('[Editor Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[Editor Error]', e.message));
  await editor.setViewportSize({ width: 1280, height: 720 });
  await editor.goto(`chrome-extension://${extId}/editor.html?record=true&includeMic=false`);
  await editor.waitForSelector('#start-capture-prompt-btn', { timeout: 15000 });

  // Keep the OS focus on the captured window: programmatic clicks do not move focus.
  await target.bringToFront();
  await sleep(800);

  await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
  await editor.waitForFunction(() => {
    const b = document.querySelector('#stop-live-recording-top-btn');
    return !!b;
  }, { timeout: 25000 });
  console.log('[F2] Recording started.');

  // --- 4s of activity -------------------------------------------------
  const actStart = Date.now();
  for (let i = 0; i < 38; i++) {
    await target.mouse.move(120 + i * 25, 480 + Math.sin(i * 0.4) * 60);
    await sleep(100);
  }
  await target.click('#btn-deploy');
  console.log(`[F2] Activity phase done after ${Date.now() - actStart}ms`);

  // --- 6s completely idle ---------------------------------------------
  const idleStart = Date.now();
  await sleep(6000);
  const idleDuration = Date.now() - idleStart;
  console.log(`[F2] Idle phase duration: ${idleDuration}ms`);

  const stopEpoch = Date.now();
  await editor.evaluate(() => document.querySelector('#stop-live-recording-top-btn').click());
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 40000 });
  await sleep(800);

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

  // --- Read the telemetry to recover the shared timeline origin ---------
  const tel = await editor.evaluate(async () => {
    const data = await new Promise((res) => {
      chrome.storage.local.get(['smoothstudio_telemetry'], (d) => res(d.smoothstudio_telemetry || null));
    });
    return data;
  });
  console.log('[F2] Telemetry metadata:', JSON.stringify(tel?.metadata ?? null));
  console.log('[F2] Telemetry clicks:', JSON.stringify(tel?.clicks ?? []));
  console.log('[F2] Telemetry keystrokes:', JSON.stringify(tel?.keystrokes ?? []));
  console.log('[F2] Telemetry typingSessions:', JSON.stringify(tel?.typingSessions ?? []));
  const originEpoch = tel?.metadata?.startTime || 0;
  console.log('[F2] Shared timeline origin (telemetry metadata.startTime):', originEpoch, 'ms');
  const wallClockMs = stopEpoch - originEpoch;
  console.log('[F2] Wall-clock recording duration (stopEpoch - originEpoch):', wallClockMs, 'ms');

  const probe = ffprobeJson(['-show_format', '-show_streams', rawPath]);
  console.log('[F2] ffprobe format:', JSON.stringify(probe.format));
  const vstream = probe.streams.find((s) => s.codec_type === 'video');
  console.log('[F2] ffprobe video stream:', JSON.stringify({
    codec: vstream.codec_name, width: vstream.width, height: vstream.height,
    duration: vstream.duration, avg_frame_rate: vstream.avg_frame_rate
  }));
  console.log('[F2] audio streams:', probe.streams.filter((s) => s.codec_type === 'audio').length);

  const pts = framePts(rawPath);
  const rawDuration = videoSize(rawPath).duration;
  let maxGap = 0;
  for (let i = 1; i < pts.length; i++) maxGap = Math.max(maxGap, pts[i] - pts[i - 1]);
  console.log('[F2] Raw frame count:', pts.length);
  console.log('[F2] Raw first PTS:', pts[0], 's   Raw last PTS:', pts[pts.length - 1], 's');
  console.log('[F2] Raw container duration:', rawDuration.toFixed(3), 's');
  console.log('[F2] Raw max inter-frame gap:', maxGap.toFixed(3), 's');

  // --- Export the MP4 through the real UI (auto-cut defaults to OFF) ---
  const [download] = await Promise.all([
    editor.waitForEvent('download', { timeout: 180000 }),
    editor.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /Export 1080p|Export MP4|Export .*MP4/i.test(b.textContent || ''));
      if (!btn) throw new Error('Export MP4 button not found');
      btn.click();
    })
  ]);
  const mp4Path = path.join(OUT, 'r4_f2_export.mp4');
  await download.saveAs(mp4Path);
  const mp4Duration = videoSize(mp4Path).duration;
  console.log('[F2] Exported MP4 duration (auto-cut OFF):', mp4Duration.toFixed(3), 's');

  // --- PASS checks ------------------------------------------------------
  const rawVsWall = Math.abs(rawDuration - wallClockMs / 1000);
  console.log(`[F2] |raw duration - wall clock| = ${rawVsWall.toFixed(3)}s  (limit 0.300s)`);
  if (rawVsWall > 0.3) { console.error('[F2] FAIL: raw duration is not within +/-0.3s of the wall clock.'); failed = true; }

  const lastVsWall = Math.abs(pts[pts.length - 1] - wallClockMs / 1000);
  console.log(`[F2] |last frame PTS - wall clock| = ${lastVsWall.toFixed(3)}s  (limit 0.300s)`);
  if (lastVsWall > 0.3) { console.error('[F2] FAIL: the recorded frame timeline does not end at the wall clock time.'); failed = true; }

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

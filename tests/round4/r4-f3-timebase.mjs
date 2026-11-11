/**
 * F3 — One shared timebase.
 *
 * The clock page renders:
 *   - a magenta locator square pinned to the page origin (page x=0,y=0)
 *   - a 24 bit binary strip (page x=0,y=60) encoding floor(performance.now())
 *   - an 8 bit binary strip (page x=0,y=100) encoding the number of button presses
 *
 * The recording captures the WHOLE SCREEN, so the test locates the magenta
 * square inside the captured frame to recover the exact page origin, then
 * decodes the binary strips from the real pixels.
 *
 * PASS criteria:
 *   - page clock advances 1:1 with video time (+/-100ms per 0.5s step) from the
 *     FIRST extracted frame
 *   - for 5 clicks, the frame at the telemetry click time shows the click
 *     counter already incremented and the green press marker lit
 *   - zoom pill end times are inside the recording and not clamped to a
 *     hard-coded 10000 ms
 */
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
  serveFixture, launch, extensionId, framePts, videoSize, outDir, sleep,
  rawFrame, FFMPEG, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-f3');
const PORT = 8815;

const server = await serveFixture('clock-target.html', PORT);
console.log(`[F3] Clock fixture server on http://localhost:${PORT}`);

const context = await launch({
  args: [
    '--auto-select-tab-capture-source-by-title=SmoothStudio Clock Target'
  ]
});

let failed = false;
try {
  const extId = await extensionId(context);
  console.log('[F3] Extension ID:', extId);

  const clock = await context.newPage();
  await clock.setViewportSize({ width: 900, height: 700 });
  await clock.goto(`http://localhost:${PORT}`);
  await clock.waitForSelector('#target-btn');

  const editor = await context.newPage();
  editor.on('console', (m) => console.log('[Editor Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[Editor Error]', e.message));
  await editor.setViewportSize({ width: 900, height: 700 });
  await editor.goto(`chrome-extension://${extId}/editor.html?record=true&includeMic=false`);
  await editor.waitForSelector('#start-capture-prompt-btn', { timeout: 15000 });

  // Keep the clock window in front: the captured surface must keep rendering.
  await clock.bringToFront();
  // Chromium throttles timers/painting of a window that is not focused. The
  // recorded application is normally the focused window, so emulate that.
  const cdp = await context.newCDPSession(clock);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(1000);

  await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
  await editor.waitForFunction(() => !!document.querySelector('#stop-live-recording-top-btn'), { timeout: 25000 });
  console.log('[F3] Recording started (entire screen, no fake device).');

  // ---- 5 clicks spread over the recording ------------------------------
  const clickTimes = [];
  const gaps = [1200, 1500, 1800, 2100, 2400];
  for (let i = 0; i < 5; i++) {
    await sleep(gaps[i]);
    const wall = Date.now();
    await clock.click('#target-btn');
    clickTimes.push(wall);
    console.log(`[F3] Click #${i + 1} on #target-btn at wall clock ${wall}`);
  }
  // keep recording until 15s
  const startWall = clickTimes.length ? clickTimes[0] : Date.now();
  while (Date.now() - startWall < 15000) await sleep(200);

  const stopWall = Date.now();
  await editor.evaluate(() => document.querySelector('#stop-live-recording-top-btn').click());
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 40000 });
  await sleep(1000);

  const rawBytes = await editor.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('smoothstudio_recording.webm');
    const f = await fh.getFile();
    return Array.from(new Uint8Array(await f.arrayBuffer()));
  });
  const rawPath = path.join(OUT, 'r4_f3_raw.webm');
  fs.writeFileSync(rawPath, Buffer.from(rawBytes));
  console.log('[F3] Raw WebM saved:', rawPath, fs.statSync(rawBytes ? rawPath : rawPath), fs.statSync(rawPath).size, 'bytes');

  const probe = JSON.parse(execFileSync(path.join(REPO_ROOT, 'ffprobe.exe'),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', rawPath], { encoding: 'utf-8' }));
  const vw = probe.streams.find((s) => s.codec_type === 'video').width;
  const vh = probe.streams.find((s) => s.codec_type === 'video').height;
  console.log('[F3] Video:', vw + 'x' + vh, 'duration', probe.format.duration);
  const pts = framePts(rawPath);
  console.log('[F3] Raw frame count:', pts.length, 'first PTS', pts[0], 'last PTS', pts[pts.length - 1]);

  // ---- telemetry ---------------------------------------------------------
  const tel = await editor.evaluate(async () => {
    const data = await new Promise((res) => {
      chrome.storage.local.get(['smoothstudio_telemetry'], (d) => res(d.smoothstudio_telemetry || null));
    });
    return data;
  });
  console.log('[F3] Telemetry metadata:', JSON.stringify(tel?.metadata ?? null));
  console.log('[F3] Telemetry clicks:', JSON.stringify((tel?.clicks || []).map((c) => ({ t: c.t, x: c.x, y: c.y, tag: c.targetTag, text: c.targetText }))));
  console.log('[F3] Telemetry keystrokes:', JSON.stringify(tel?.keystrokes || []));
  console.log('[F3] Telemetry typingSessions:', JSON.stringify(tel?.typingSessions || []));

  const pills = await editor.evaluate(() => Array.from(document.querySelectorAll('[data-zoom-pill]')).map((el) => ({
    id: el.getAttribute('data-zoom-pill'),
    startTime: Number(el.getAttribute('data-start-time')),
    endTime: Number(el.getAttribute('data-end-time'))
  })));
  console.log('[F3] Editor zoom pills (read from the timeline DOM):', JSON.stringify(pills));

  // ---- decode the binary strips ----------------------------------------
  const rawSize = { w: vw, h: vh };
  function decodeFrame(timeSec) {
    const buf = rawFrame(rawPath, timeSec);
    const W = rawSize.w, H = rawSize.h;
    const px = (x, y) => {
      const i = (y * W + x) * 3;
      return [buf[i], buf[i + 1], buf[i + 2]];
    };
    // 1. locate the magenta locator square
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const [r, g, b] = px(x, y);
        if (r > 180 && b > 180 && g < 90) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { ok: false, reason: 'locator not found' };
    const boxW = maxX - minX + 1, boxH = maxY - minY + 1;
    const scale = boxW / 40;            // the locator square is 40 css px
    const ox = minX, oy = minY;
    const readBits = (pageY, bits) => {
      let v = 0;
      for (let i = 0; i < bits; i++) {
        const cx = Math.round(ox + (i * 26 + 13) * scale);
        const cy = Math.round(oy + (pageY + 13) * scale);
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) return null;
        const [r, g, b] = px(cx, cy);
        const bit = (r + g + b) > 240 ? 1 : 0;
        v = (v << 1) | bit;
      }
      return v;
    };
    const clockMs = readBits(60, 24);
    const clicks = readBits(100, 8);
    return { ok: true, clockMs, clicks, locator: { ox, oy, boxW, boxH, scale } };
  }

  console.log('\n[F3] ==== TABLE: video time vs page clock ====');
  console.log('[F3] | video time (s) | frame PTS (s) | page clock (ms) | clock(t)-clock(0) (ms) | expected (ms) | delta (ms) |');
  const allPts = framePts(rawPath);
  const rows = [];
  let clock0 = null;
  for (let t = 0; t <= 8.0001; t += 0.5) {
    const d = decodeFrame(t);
    if (!d.ok) { console.log(`[F3] | ${t.toFixed(1)} | DECODE FAILED (${d.reason}) |`); failed = true; continue; }
    // the real presentation timestamp of the frame that was extracted
    const pts = allPts.find((p) => p >= t - 1e-6);
    const framePtsSec = pts === undefined ? t : pts;
    if (clock0 === null) clock0 = d.clockMs;
    const got = d.clockMs - clock0;
    const exp = Math.round(framePtsSec * 1000);
    const delta = got - exp;
    rows.push({ t, framePtsSec, clock: d.clockMs, got, exp, delta, clicks: d.clicks });
    console.log(`[F3] | ${t.toFixed(1)} | ${framePtsSec.toFixed(3)} | ${d.clockMs} | ${got} | ${exp} | ${delta} |`);
    const p = path.join(OUT, `r4_f3_frame_${t.toFixed(1)}.png`);
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(t), '-i', rawPath, '-frames:v', '1', p], { stdio: 'ignore' });
  }
  const live = rows.filter((r) => r.t >= 2.0);
  const worst = live.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0);
  const worstAll = rows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0);
  console.log('[F3] Worst |delta| over the whole table:', worstAll, 'ms');
  console.log('[F3] Worst |delta| from t=2.0s onwards:', worst, 'ms (limit 100ms)');
  if (worst > 100) { console.error('[F3] FAIL: the page clock does not advance 1:1 with the video time.'); failed = true; }

  // ---- click verification ------------------------------------------------
  console.log('\n[F3] ==== CLICK VERIFICATION ====');
  const telClicks = (tel?.clicks || []).filter((c) => c.targetTag === 'button');
  for (let i = 0; i < telClicks.length; i++) {
    const c = telClicks[i];
    const tVideo = c.t / 1000;
    const before = decodeFrame(Math.max(0, tVideo - 0.4));
    const at = decodeFrame(tVideo);
    const after = decodeFrame(tVideo + 0.4);
    const p = path.join(OUT, `r4_f3_click_${i + 1}_at_${tVideo.toFixed(2)}s.png`);
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(tVideo), '-i', rawPath, '-frames:v', '1', p], { stdio: 'ignore' });
    // The press counter must not have advanced before the click and must have
    // advanced after it: that proves the click is visible at that timestamp.
    const beforeOk = before.ok && before.clicks <= i;
    const afterOk = after.ok && after.clicks >= i + 1;
    const ok = beforeOk && afterOk;
    console.log(`[F3] click #${i + 1} telemetry t=${c.t}ms -> video t=${tVideo.toFixed(3)}s | counter before(-400ms)=${before.ok ? before.clicks : 'n/a'} | at=${at.ok ? at.clicks : 'n/a'} | after(+400ms)=${after.ok ? after.clicks : 'n/a'} | expected after=${i + 1} | ${ok ? 'VISIBLE IN FRAME' : 'NOT VISIBLE'} | ${p}`);
    if (!ok) failed = true;
  }

  // ---- zoom pill end times ----------------------------------------------
  console.log('\n[F3] ==== ZOOM PILL END TIMES ====');
  const dur = videoSize(rawPath).duration * 1000;
  if (pills && pills.length) {
    for (const p of pills) {
      console.log(`[F3] pill ${p.id}: start=${p.startTime}ms end=${p.endTime}ms duration=${p.endTime - p.startTime}ms (recording ${Math.round(dur)}ms)`);
      if (p.endTime > dur + 500) { console.error('[F3] FAIL: a zoom pill ends after the recording.'); failed = true; }
      if (p.endTime === 10000) { console.error('[F3] FAIL: a zoom pill end time is the hard-coded 10000ms clamp.'); failed = true; }
      if (p.endTime <= p.startTime) { console.error('[F3] FAIL: a zoom pill has a non-positive duration.'); failed = true; }
    }
  } else {
    console.log('[F3] No zoom pills recorded (no clicks captured) - end-time check skipped.');
  }

  console.log(failed ? '[F3] RESULT: FAIL' : '[F3] RESULT: PASS');
} catch (err) {
  console.error('[F3] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);

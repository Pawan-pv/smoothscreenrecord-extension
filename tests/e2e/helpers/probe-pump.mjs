/**
 * Diagnostic (M1 / QA-008): how many frames does each frame-pump strategy get
 * into MediaRecorder while the recording page is HIDDEN (background tab)?
 *
 *   node tests/e2e/helpers/probe-pump.mjs
 *
 * Strategies (each records 6 s of the real screen while the page is hidden):
 *   raw        MediaRecorder on the getDisplayMedia track itself
 *   canvas     MediaStreamTrackProcessor -> 2D canvas drawImage -> captureStream(0).requestFrame
 *   generator  MediaStreamTrackProcessor -> MediaStreamTrackGenerator (no copy)
 *   rvfc       <video> requestVideoFrameCallback -> canvas (the pre-M1 driver)
 * Prints frames read, frames recorded (ffprobe), and the worst main-thread stall.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures');
const OUT = path.join(REPO, 'tests', 'e2e', 'out', 'probe-pump');
fs.mkdirSync(OUT, { recursive: true });
const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';

const server = http.createServer((req, res) => {
  const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'clock.html';
  const file = path.join(FIXTURES, rel);
  if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-probe-pump-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: CHROME_CFT, viewport: null,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1536,864', '--window-position=0,0', ...(process.env.PROBE_ARGS ? process.env.PROBE_ARGS.split(' ') : [])]
});
const target = await context.newPage();
await target.goto(`${base}/clock.html`);
try {
  console.log('raise:', execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'raise-window.ps1'), '-ProfileDir', profile, '-Mode', 'top'], { encoding: 'utf8' }).trim());
} catch (e) { console.log('raise failed'); }

const strategies = (process.argv[2] || 'source,raw,canvas,generator,rvfc').split(',');
for (const strategy of strategies) {
  // A TAB in the fixture's window (window.open without features), so that
  // bringing the fixture to the front really hides it - like the editor tab.
  const [prober] = await Promise.all([
    context.waitForEvent('page'),
    target.evaluate((u) => { window.open(u); }, `${base}/static.html`)
  ]);
  await prober.waitForLoadState('domcontentloaded');
  await prober.bringToFront();
  await prober.evaluate(async () => {
    (window).__stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
  });
  await target.bringToFront(); // the prober is now a HIDDEN background tab
  await target.waitForTimeout(500);
  console.log('  prober visibility before measuring:', await prober.evaluate(() => document.visibilityState));
  const result = await prober.evaluate(async (strategy) => {
    const stream = window.__stream;
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    let read = 0;
    let recStream;
    let stopPump = () => {};
    if (strategy === 'raw') {
      recStream = stream;
    } else if (strategy === 'source') {
      const proc = new MediaStreamTrackProcessor({ track });
      const reader = proc.readable.getReader();
      let running = true;
      stopPump = () => { running = false; reader.cancel().catch(() => {}); };
      (async () => { while (running) { const { value, done } = await reader.read(); if (done) break; read++; value.close(); } })();
      recStream = new MediaStream([track.clone()]);
    } else if (strategy === 'canvas' || strategy === 'generator') {
      const proc = new MediaStreamTrackProcessor({ track });
      const reader = proc.readable.getReader();
      let running = true;
      stopPump = () => { running = false; reader.cancel().catch(() => {}); };
      if (strategy === 'canvas') {
        const c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
        const ctx = c.getContext('2d', { alpha: false });
        recStream = c.captureStream(0);
        const out = recStream.getVideoTracks()[0];
        (async () => { while (running) { const { value, done } = await reader.read(); if (done) break; read++; ctx.drawImage(value, 0, 0, c.width, c.height); value.close(); out.requestFrame(); } })();
      } else {
        const gen = new MediaStreamTrackGenerator({ kind: 'video' });
        const writer = gen.writable.getWriter();
        recStream = new MediaStream([gen]);
        (async () => { while (running) { const { value, done } = await reader.read(); if (done) break; read++; await writer.write(value); } })();
      }
    } else {
      const v = document.createElement('video'); v.muted = true; v.srcObject = stream; document.body.appendChild(v); await v.play().catch(() => {});
      const c = document.createElement('canvas'); c.width = s.width; c.height = s.height;
      const ctx = c.getContext('2d', { alpha: false });
      recStream = c.captureStream(0);
      const out = recStream.getVideoTracks()[0];
      let running = true; stopPump = () => { running = false; };
      const cb = () => { if (!running) return; read++; ctx.drawImage(v, 0, 0, c.width, c.height); out.requestFrame(); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
    }
    // main-thread stall meter (MessageChannel tasks are not timer-throttled)
    let worst = 0; let last = performance.now(); let meter = true;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; if (meter) setTimeout(() => ch.port2.postMessage(0), 0); };
    ch.port2.postMessage(0);
    const chunks = [];
    const rec = new MediaRecorder(recStream, { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 10_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(250);
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 6000));
    const elapsed = performance.now() - t0;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    stopPump(); meter = false;
    stream.getTracks().forEach((t) => t.stop());
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { read, elapsedMs: Math.round(elapsed), worstStallMs: Math.round(worst), hidden: document.visibilityState, b64: btoa(bin), w: s.width, h: s.height };
  }, strategy);
  const pageFps = await target.locator('#fps').innerText().catch(() => '?');
  console.log(`  fixture page renders at: ${pageFps}`);
  const file = path.join(OUT, `${strategy}.webm`);
  fs.writeFileSync(file, Buffer.from(result.b64, 'base64'));
  const frames = execFileSync(path.join(REPO, 'ffprobe.exe'), ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
  console.log(`${strategy.padEnd(9)} visibility=${result.hidden} ${result.w}x${result.h} read=${result.read} recordedFrames=${frames} ` +
    `fps=${(parseInt(frames, 10) / (result.elapsedMs / 1000)).toFixed(1)} worstMainThreadStall=${result.worstStallMs}ms elapsed=${result.elapsedMs}ms`);
  await prober.close();
}
await context.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });

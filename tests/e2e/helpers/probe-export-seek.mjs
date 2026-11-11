/**
 * Probe for QA-001 (MP4 export seek timeout).
 *
 * The MP4 exporter (src/engine/mp4-exporter.ts) does NOT drive the editor's
 * preview <video>; it creates its own element from the recording blob
 * (mp4-exporter.ts:186-205) and seeks that one, 60 times per second.
 *
 * This probe runs the exporter's exact seekToFrame() logic inside the REAL
 * editor page (chrome-extension://<id>/editor.html) with a REAL recorded
 * WebM, and compares the element setups that the exporter could use:
 *
 *   product  - the element the exporter creates today (2x2 px, opacity 0.01,
 *              z-index -1, i.e. behind the opaque editor background)
 *   onTop    - the same element but on top of the page (z-index 2147483647)
 *   visible  - a normal, visible <video> (the clean-room probe used this)
 *
 * Each variant seeks 120 times (2 s of a 60 fps timeline) and reports how
 * many seeks did not complete within the exporter's 2000 ms limit.
 *
 * Usage: node tests/e2e/helpers/probe-export-seek.mjs <webm file>
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(REPO, 'dist');
const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';
const CHROMIUM_PW = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

const file = process.argv[2] || path.join(REPO, 'tests', 'e2e', 'out', 'j11', 'raw_recording.webm');
if (!fs.existsSync(file)) {
  console.error('usage: node probe-export-seek.mjs <webm file>');
  process.exit(2);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/rec.webm')) {
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>probe</title><body>probe</body>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const recUrl = `http://127.0.0.1:${port}/rec.webm`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-probe-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: fs.existsSync(CHROME_CFT) ? CHROME_CFT : CHROMIUM_PW,
  viewport: null,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,800',
    '--window-position=0,0',
  ],
});
let sw = context.serviceWorkers()[0];
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
const extensionId = new URL(sw.url()).host;

const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text().slice(0, 200)); });
await page.goto(`chrome-extension://${extensionId}/editor.html`);
await page.waitForTimeout(1500);

const result = await page.evaluate(async ({ recUrl, frames, full }) => {
  const SEEK_TIMEOUT_MS = 2000;
  const RVFC_GRACE_MS = 250;

  // Exactly the exporter's seekToFrame() (src/engine/mp4-exporter.ts:87-153),
  // including the requestVideoFrameCallback grace period.
  const makeSeeker = (video, state) => (targetTimeSec) => new Promise((resolve, reject) => {
    let settled = false;
    let rafHandle = null;
    let timer = null;
    let graceTimer = null;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      if (rafHandle !== null && typeof video.cancelVideoFrameCallback === 'function') {
        try { video.cancelVideoFrameCallback(rafHandle); } catch { /* ignore */ }
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
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(reason));
    };
    const onSeeked = () => {
      if (settled) return;
      if (state.rvfcUsable && typeof video.requestVideoFrameCallback === 'function') {
        rafHandle = video.requestVideoFrameCallback(() => { state.rvfcPresented = true; succeed(); });
        graceTimer = setTimeout(() => { if (!state.rvfcPresented) state.rvfcUsable = false; succeed(); }, RVFC_GRACE_MS);
      } else {
        succeed();
      }
    };
    video.addEventListener('seeked', onSeeked);
    timer = setTimeout(() => {
      fail(`Seek timeout: the video frame at ${targetTimeSec.toFixed(3)}s was not presented within ${SEEK_TIMEOUT_MS}ms.`);
    }, SEEK_TIMEOUT_MS);
    try { video.currentTime = targetTimeSec; } catch (e) { fail(String(e.message || e)); }
  });

  const runVariant = async (name, style, useBlob, full = false) => {
    const buf = await (await fetch(recUrl)).arrayBuffer();
    const src = useBlob ? URL.createObjectURL(new Blob([buf], { type: 'video/webm' })) : recUrl;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    if (style) v.style.cssText = style;
    document.body.appendChild(v);
    v.src = src;
    await new Promise((res) => {
      if (v.readyState >= 1) return res();
      v.onloadedmetadata = () => res();
      v.onerror = () => res();
      setTimeout(res, 3000);
    });
    const meta = {
      duration: v.duration, readyState: v.readyState, w: v.videoWidth, h: v.videoHeight,
      error: v.error ? v.error.code + ':' + v.error.message : null,
      seekable: v.seekable.length ? [v.seekable.start(0), v.seekable.end(v.seekable.length - 1)] : null,
      box: (() => { const r = v.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top)]; })(),
    };
    const seek = makeSeeker(v, { rvfcUsable: true, rvfcPresented: false });
    const failures = [];
    const latencies = [];
    const worst = [];
    const step = 1 / 60;
    const total = full ? Math.floor((meta.duration || 20) * 60) : frames;
    for (let f = 0; f < total; f++) {
      const target = f * step;
      const t0 = performance.now();
      try {
        await seek(target);
        const dt = performance.now() - t0;
        latencies.push(dt);
        worst.push({ at: +target.toFixed(3), ms: +dt.toFixed(1) });
      } catch (e) {
        failures.push({ at: +target.toFixed(3), error: String(e.message || e), readyState: v.readyState, currentTime: v.currentTime });
        if (failures.length >= 3) break;
      }
    }
    worst.sort((a, b) => b.ms - a.ms);
    v.remove();
    if (useBlob) URL.revokeObjectURL(src);
    latencies.sort((a, b) => a - b);
    const pct = (p) => latencies.length ? +latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))].toFixed(1) : null;
    return {
      name, meta,
      seeks: latencies.length + failures.length,
      failures: failures.length,
      failureDetail: failures,
      latencyP50Ms: pct(0.5),
      latencyP95Ms: pct(0.95),
      latencyMaxMs: latencies.length ? +latencies[latencies.length - 1].toFixed(1) : null,
      worstSeeks: worst.slice(0, 8),
    };
  };

  const out = [];
  out.push(await runVariant('product FULL (2x2, opacity .01, z-index -1, blob)',
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;', true, true));
  out.push(await runVariant('product (2x2, opacity .01, z-index -1, blob)',
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;', true, false));
  out.push(await runVariant('onTop  (32x32, opacity .01, z-index max, blob)', 'position:fixed;left:0;top:0;width:32px;height:32px;opacity:0.01;pointer-events:none;z-index:2147483647;', true, false));
  out.push(await runVariant('visible (default size, blob)', '', true, false));
  out.push(await runVariant('product (2x2, opacity .01, z-index -1, http url)', 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;', false, false));
  return { visibilityState: document.visibilityState, hasFocus: document.hasFocus(), out };
}, { recUrl, frames: 120, full: true });

console.log('document.visibilityState =', result.visibilityState, ' hasFocus =', result.hasFocus);
for (const v of result.out) {
  console.log('\n=== ' + v.name);
  console.log('  meta:', JSON.stringify(v.meta));
  console.log(`  seeks=${v.seeks} failures=${v.failures} p50=${v.latencyP50Ms}ms p95=${v.latencyP95Ms}ms max=${v.latencyMaxMs}ms`);
  console.log('  worst seeks:', JSON.stringify(v.worstSeeks));
  if (v.failureDetail.length) console.log('  failureDetail:', JSON.stringify(v.failureDetail, null, 1));
}

await context.close();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* profile still locked */ }
process.exit(result.out.some((v) => v.failures > 0) ? 1 : 0);

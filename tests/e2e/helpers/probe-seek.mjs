/**
 * Clean-room reproduction of the MP4 exporter's seek loop
 * (src/engine/mp4-exporter.ts seekToFrame()).
 *
 * Loads a real recorded WebM into a <video> element and walks the timeline the
 * way the exporter does (1/60 s steps, wait for `seeked`, 2000 ms limit) and
 * reports every seek that does not complete.
 *
 * Usage: node tests/e2e/helpers/probe-seek.mjs <webm file>
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const file = process.argv[2];

if (!file || !fs.existsSync(file)) {
  console.error('usage: node probe-seek.mjs <webm file>');
  process.exit(2);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/rec.webm')) {
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>seek probe</title><body>seek probe</body>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/rec.webm`;
const pageUrl = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ headless: false, args: ['--window-size=1280,800'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(pageUrl);

const result = await page.evaluate(async (src) => {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.src = src;
  document.body.appendChild(v);
  await new Promise((res) => {
    v.addEventListener('loadedmetadata', res, { once: true });
    v.addEventListener('error', res, { once: true });
    setTimeout(res, 5000);
  });
  const meta = {
    duration: v.duration, readyState: v.readyState, videoWidth: v.videoWidth, videoHeight: v.videoHeight,
    error: v.error ? v.error.code + ':' + v.error.message : null
  };
  // exactly the exporter's seekToFrame()
  const seekToFrame = (targetTimeSec) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      reject(new Error(`Seek timeout: the video frame at ${targetTimeSec.toFixed(3)}s was not presented within 2000ms.`));
    }, 2000);
    v.addEventListener('seeked', () => {
      if (settled) return; settled = true; clearTimeout(timer); resolve();
    }, { once: true });
    try { v.currentTime = targetTimeSec; } catch (e) { settled = true; clearTimeout(timer); reject(e); }
  });

  const failures = [];
  const step = 1 / 60;
  const duration = Number.isFinite(v.duration) ? v.duration : 20;
  let seeks = 0;
  for (let t = 0; t <= duration; t += step) {
    const target = t;
    if (Math.abs(v.currentTime - target) > 0.005) {
      seeks++;
      try { await seekToFrame(target); }
      catch (e) {
        failures.push({ at: target.toFixed(3), currentTime: v.currentTime, readyState: v.readyState, error: String(e.message || e) });
        if (failures.length >= 5) break;
      }
    }
  }
  return { meta, seeks, failures, finalCurrentTime: v.currentTime };
}, url);

console.log('video meta:', JSON.stringify(result.meta));
console.log('seeks attempted:', result.seeks);
console.log('failures:', JSON.stringify(result.failures, null, 1));
await browser.close();
server.close();
process.exit(result.failures.length ? 1 : 0);

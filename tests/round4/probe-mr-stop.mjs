/**
 * Part A.1 evidence — why the Round-3 recording produced ZERO chunks.
 *
 * Compares the four stop sequences on the SAME real desktop capture
 * (no fake device). Only the sequence that calls MediaRecorder.requestData()
 * before the encoder has produced output loses the encoded video.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Probe MR</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}</style></head>
<body><h1>MEDIARECORDER STOP PROBE</h1></body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8823, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrprobe-'));
const context = await chromium.launchPersistentContext(dir, {
  headless: false, executablePath: CHROME, viewport: { width: 1280, height: 720 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen', '--window-size=1280,760']
});
const page = await context.newPage();
await page.goto('http://localhost:8823');

const res = await page.evaluate(async () => {
  const log = [];
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  for (const variant of ['requestData+120ms+stop', 'plain stop', 'stop at 250ms', 'stop at 1000ms + 250ms settle']) {
    const events = [];
    const t0 = performance.now();
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    mr.ondataavailable = (e) => events.push({ ev: 'data', size: e.data ? e.data.size : -1, t: Math.round(performance.now() - t0) });
    mr.onstop = () => events.push({ ev: 'stop', t: Math.round(performance.now() - t0) });
    mr.start(1000);
    if (variant === 'requestData+120ms+stop') {
      await new Promise((r) => setTimeout(r, 1000));
      mr.requestData();
      await new Promise((r) => setTimeout(r, 120));
      mr.stop();
    } else if (variant === 'plain stop') {
      await new Promise((r) => setTimeout(r, 1000));
      mr.stop();
    } else if (variant === 'stop at 250ms') {
      await new Promise((r) => setTimeout(r, 250));
      mr.stop();
    } else {
      await new Promise((r) => setTimeout(r, 1250));
      mr.stop();
    }
    await new Promise((r) => setTimeout(r, 600));
    log.push({ variant, events });
  }
  stream.getTracks().forEach((t) => t.stop());
  return log;
});

console.log(JSON.stringify(res, null, 2));
await context.close();
server.close();

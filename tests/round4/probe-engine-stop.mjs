/**
 * Part A.1 evidence — the REAL product engine (no fake device) recorded 0 chunks
 * because the stop path called MediaRecorder.requestData() before the encoder
 * had produced any output. The snapshot fallback then synthesised an MP4.
 *
 * This probe drives the shipped ScreenCaptureEngine directly.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CHROME = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Probe Engine</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}</style></head>
<body><h1>ENGINE STOP PROBE</h1></body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8824, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engprobe-'));
const context = await chromium.launchPersistentContext(dir, {
  headless: false, executablePath: CHROME, viewport: { width: 1280, height: 720 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen', '--window-size=1280,760',
    `--disable-extensions-except=${path.join(REPO_ROOT, 'dist')}`,
    `--load-extension=${path.join(REPO_ROOT, 'dist')}`]
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = new URL(sw.url()).host;
const page = await context.newPage();
page.on('console', (m) => console.log('[Editor Log]', m.text()));
await page.goto(`chrome-extension://${extensionId}/editor.html`);
await page.waitForLoadState('networkidle');
if (typeof (await page.evaluate(() => typeof window.__ScreenCaptureEngine)) !== 'string') {
  console.log('[Probe3] NOTE: window.__ScreenCaptureEngine is missing - build with "npm run build:test"');
}

const res = await page.evaluate(async () => {
  // The shipped engine, loaded from the extension build in dist/
  const engine = new window.__ScreenCaptureEngine();
  const stream = await engine.start({ includeMic: false, frameRate: 60 });
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  await new Promise((r) => setTimeout(r, 1000));
  let blob = null;
  let error = null;
  try {
    blob = await engine.stop();
  } catch (e) {
    error = e.message;
  }
  return {
    settings,
    blobSize: blob ? blob.size : null,
    blobType: blob ? blob.type : null,
    durationMs: engine.getDurationMs(),
    error
  };
});

console.log('[Probe3] RESULT:', JSON.stringify(res, null, 2));
await context.close();
server.close();

import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';
const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));

console.log('[Smoke] Launching Chrome for Testing headed (no fake device)...');
const context = await chromium.launchPersistentContext(tempUserDataDir, {
  headless: false,
  executablePath: CHROME_EXECUTABLE,
  viewport: { width: 1280, height: 720 },
  args: [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--window-size=1280,720'
  ]
});

try {
  const http = await import('http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="background:#123"><h1>smoke</h1></body></html>');
  });
  await new Promise((r) => server.listen(8799, r));

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://localhost:8799');
  const res = await page.evaluate(async () => {
    const out = {};
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      out.settings = track.getSettings();
      let frames = 0;
      const v = document.createElement('video');
      v.srcObject = stream; v.muted = true; v.play().catch(() => {});
      const tick = () => { frames++; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, 3000));
      out.rafFrames = frames;
      out.videoSize = [v.videoWidth, v.videoHeight];
      out.readyState = v.readyState;
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {
      out.error = e.name + ': ' + e.message;
    }
    return out;
  });
  console.log('[Smoke] Result:', JSON.stringify(res, null, 2));
  server.close();
  await context.close();
} catch (e) {
  console.error('[Smoke] FAILED', e);
  try { server.close(); } catch {}
  await context.close();
  process.exit(1);
}

import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>SmoothStudio Autonomous Test Target App</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}</style></head>
<body><h1>WINDOW TITLE PROBE</h1></body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8820, r));

const candidates = ['DCS Screen recorder automation', 'DCS Screen recorder automatio', 'Project architecture and feat'];

for (const title of candidates) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false, executablePath: CHROME, viewport: { width: 900, height: 700 },
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-fake-ui-for-media-stream',
      `--auto-select-desktop-capture-source=${title}`, '--window-size=900,760']
  });
  try {
    const page = await ctx.newPage();
    await page.goto('http://localhost:8820');
    await page.waitForSelector('h1');
    const info = await page.evaluate(async () => {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const t = s.getVideoTracks()[0].getSettings();
      s.getTracks().forEach((x) => x.stop());
      return { displaySurface: t.displaySurface, deviceId: t.deviceId, w: t.width, h: t.height };
    });
    console.log(`[title="${title}"] ->`, JSON.stringify(info));
  } catch (e) {
    console.log(`[title="${title}"] -> ERROR ${e.message}`);
  } finally {
    await ctx.close();
  }
}
server.close();

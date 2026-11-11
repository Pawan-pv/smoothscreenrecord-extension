import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe8-'));

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Probe Static2</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}
#hud{position:fixed;bottom:20px;right:20px;background:#14161D;padding:10px 16px;border-radius:999px}
#dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#EF4444;animation:p 1.4s infinite}
@keyframes p{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}</style></head>
<body><h1>STATIC PROBE 2</h1><div id="hud"><span id="dot"></span> <span id="t">0</span></div>
<script>let s=0;setInterval(()=>{document.getElementById('t').textContent=(++s);},1000);</script>
</body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8808, r));

const context = await chromium.launchPersistentContext(dir, {
  headless: false, executablePath: CHROME, viewport: { width: 1280, height: 720 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--auto-select-tab-capture-source-by-title=Probe Static2', '--window-size=1280,760']
});

const target = await context.newPage();
await target.goto('http://localhost:8808');
await target.waitForSelector('h1');
const editor = await context.newPage();
await editor.goto('http://localhost:8808');
await target.bringToFront();
await new Promise((r) => setTimeout(r, 800));

const res = await editor.evaluate(async () => {
  const out = [];
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });

  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;';
  document.body.appendChild(video);
  await video.play().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  for (const pumpHz of [0, 15, 30, 60]) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d', { alpha: false });
    const pumped = canvas.captureStream(0);
    const track = pumped.getVideoTracks()[0];

    const mr = new MediaRecorder(pumpHz === 0 ? stream : pumped, { mimeType: 'video/webm; codecs=vp9' });
    const evs = [];
    mr.ondataavailable = (e) => evs.push({ size: e.data ? e.data.size : -1, t: Math.round(performance.now()) });
    mr.start(250);

    let ticks = 0, srcRvfc = 0;
    video.requestVideoFrameCallback(function cb() { srcRvfc++; video.requestVideoFrameCallback(cb); });
    const t0 = performance.now();
    const iv = pumpHz > 0 ? setInterval(() => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      track.requestFrame();
      ticks++;
    }, Math.round(1000 / pumpHz)) : null;

    await new Promise((r) => setTimeout(r, 9000));
    if (iv) clearInterval(iv);
    mr.stop();
    await new Promise((r) => setTimeout(r, 800));
    out.push({
      pumpHz, ticks, srcRvfc,
      firstDataAt: evs.length ? evs[0].t : null,
      dataEvents: evs.length,
      totalBytes: evs.reduce((a, b) => a + Math.max(0, b.size), 0),
      sizes: evs.slice(0, 12).map((e) => e.size)
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  return out;
});

console.log(JSON.stringify(res, null, 2));
await context.close();
server.close();

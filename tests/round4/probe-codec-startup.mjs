import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe9-'));

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Probe Static3</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}
#hud{position:fixed;bottom:20px;right:20px;background:#14161D;padding:10px 16px;border-radius:999px}
#dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#EF4444;animation:p 1.4s infinite}
@keyframes p{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}</style></head>
<body><h1>STATIC PROBE 3</h1><div id="hud"><span id="dot"></span> <span id="t">0</span></div>
<script>let s=0;setInterval(()=>{document.getElementById('t').textContent=(++s);},1000);</script>
</body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8809, r));

const context = await chromium.launchPersistentContext(dir, {
  headless: false, executablePath: CHROME, viewport: { width: 1280, height: 720 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--auto-select-tab-capture-source-by-title=Probe Static3', '--window-size=1280,760']
});

const target = await context.newPage();
await target.goto('http://localhost:8809');
await target.waitForSelector('h1');
const editor = await context.newPage();
await editor.goto('http://localhost:8809');
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

  const variants = [
    { name: 'vp9 default', mime: 'video/webm; codecs=vp9', opts: {} },
    { name: 'vp9 8Mbps', mime: 'video/webm; codecs=vp9', opts: { videoBitsPerSecond: 8_000_000 } },
    { name: 'vp8 default', mime: 'video/webm; codecs=vp8', opts: {} },
    { name: 'vp8 8Mbps', mime: 'video/webm; codecs=vp8', opts: { videoBitsPerSecond: 8_000_000 } }
  ];

  for (const variant of variants) {
    if (!MediaRecorder.isTypeSupported(variant.mime)) { out.push({ name: variant.name, unsupported: true }); continue; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d', { alpha: false });
    const pumped = canvas.captureStream(0);
    const track = pumped.getVideoTracks()[0];
    const mr = new MediaRecorder(pumped, { mimeType: variant.mime, ...variant.opts });
    const evs = [];
    mr.ondataavailable = (e) => evs.push({ size: e.data ? e.data.size : -1, t: Math.round(performance.now()) });
    const t0 = performance.now();
    mr.start(250);
    const iv = setInterval(() => { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); track.requestFrame(); }, 16);
    await new Promise((r) => setTimeout(r, 8000));
    clearInterval(iv);
    mr.stop();
    await new Promise((r) => setTimeout(r, 800));
    out.push({
      name: variant.name,
      firstDataAfterMs: evs.length ? evs[0].t - t0 : null,
      dataEvents: evs.length,
      totalBytes: evs.reduce((a, b) => a + Math.max(0, b.size), 0)
    });
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
});

console.log(JSON.stringify(res, null, 2));
await context.close();
server.close();

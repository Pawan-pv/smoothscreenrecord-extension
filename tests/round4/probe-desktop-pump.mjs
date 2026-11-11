import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const OUT = path.resolve(__dirname, '../../test-results/r4-probe');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const FFPROBE = path.resolve(__dirname, '../../ffprobe.exe');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Probe Desk</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}
#hud{position:fixed;bottom:20px;right:20px;background:#14161D;padding:10px 16px;border-radius:999px}
#dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#EF4444;animation:p 1.4s infinite}
@keyframes p{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}</style></head>
<body><h1>DESKTOP PROBE</h1><div id="hud"><span id="dot"></span> <span id="t">0</span></div>
<script>let s=0;setInterval(()=>{document.getElementById('t').textContent=(++s);},1000);</script>
</body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8814, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probeB-'));
const ctx = await chromium.launchPersistentContext(dir, {
  headless: false, executablePath: CHROME, viewport: { width: 1280, height: 720 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--window-size=1280,760']
});
const target = await ctx.newPage();
await target.goto('http://localhost:8814');
await target.waitForSelector('h1');
const editor = await ctx.newPage();
await editor.goto('http://localhost:8814');
await target.bringToFront();
await new Promise((r) => setTimeout(r, 800));

const out = await editor.evaluate(async () => {
  const res = [];
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;';
  document.body.appendChild(video);
  await video.play().catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  for (const mode of ['ts1000','ts500','ts2000','ts1000raw']) {
    let source = stream;
    let iv = null;
    let track = null;
    let canvas = null, c2 = null;
    if (mode !== 'ts1000raw') {
      canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      if (false) {
        canvas.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(canvas);
      }
      c2 = canvas.getContext('2d', { alpha: false });
      const pumped = canvas.captureStream(0);
      track = pumped.getVideoTracks()[0];
      source = pumped;
    }
    const chunks = [];
    const mr = new MediaRecorder(source, { mimeType: 'video/webm; codecs=vp9' });
    const t0 = performance.now();
    let firstData = null;
    mr.ondataavailable = (e) => { if (e.data) { if (firstData === null && e.data.size > 1) firstData = Math.round(performance.now() - t0); chunks.push(e.data); } };
    mr.start(mode === 'ts1000' ? 1000 : mode === 'ts500' ? 500 : mode === 'ts2000' ? 2000 : 1000);
    if (mode !== 'ts1000raw') iv = setInterval(() => { c2.drawImage(video, 0, 0, canvas.width, canvas.height); track.requestFrame(); }, 16);
    await new Promise((r) => setTimeout(r, 9000));
    if (iv) clearInterval(iv);
    mr.stop();
    await new Promise((r) => setTimeout(r, 900));
    const blob = new Blob(chunks, { type: 'video/webm' });
    const reader = new FileReader();
    const b64 = await new Promise((res2) => { reader.onloadend = () => res2(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
    res.push({ mode, firstData, chunks: chunks.length, bytes: blob.size, b64 });
    await new Promise((r) => setTimeout(r, 400));
  }
  return res;
});

for (const r of out) {
  const file = path.join(OUT, `desk_${r.mode}.webm`);
  fs.writeFileSync(file, Buffer.from(r.b64, 'base64'));
  let pts = [];
  try {
    const o = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf-8' });
    pts = o.split('\n').map((x) => parseFloat(x)).filter((x) => !isNaN(x));
  } catch (e) { console.log('probe failed for', r.mode); }
  let maxGap = 0, gapAt = 0;
  for (let i = 1; i < pts.length; i++) { const g = pts[i] - pts[i - 1]; if (g > maxGap) { maxGap = g; gapAt = pts[i - 1]; } }
  console.log(`[desk:${r.mode}] firstData=${r.firstData}ms chunks=${r.chunks} bytes=${r.bytes} frames=${pts.length} firstPts=${pts[0]} lastPts=${pts[pts.length - 1]} maxGap=${maxGap.toFixed(3)}@${gapAt}`);
}
await ctx.close();
server.close();

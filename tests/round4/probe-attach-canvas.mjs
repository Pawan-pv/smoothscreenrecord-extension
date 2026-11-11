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

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Probe Static4</title>
<style>body{background:#0F172A;color:#fff;font-family:monospace;padding:40px}h1{font-size:40px}
#hud{position:fixed;bottom:20px;right:20px;background:#14161D;padding:10px 16px;border-radius:999px}
#dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#EF4444;animation:p 1.4s infinite}
@keyframes p{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}</style></head>
<body><h1>STATIC PROBE 4</h1><div id="hud"><span id="dot"></span> <span id="t">0</span></div>
<script>let s=0;setInterval(()=>{document.getElementById('t').textContent=(++s);},1000);</script>
</body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HTML); });
await new Promise((r) => server.listen(8812, r));

async function run(label, attachCanvas) {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'probeA-'));
  const ctx = await chromium.launchPersistentContext(d2, {
    headless: false, executablePath: CHROME, viewport: { width: 1280, height: 720 },
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--auto-select-tab-capture-source-by-title=Probe Static4', '--window-size=1280,760']
  });
  try {
    const target = await ctx.newPage();
    await target.goto('http://localhost:8812');
    await target.waitForSelector('h1');
    const editor = await ctx.newPage();
    await editor.goto('http://localhost:8812');
    await target.bringToFront();
    await new Promise((r) => setTimeout(r, 800));

    const b64 = await editor.evaluate(async (attach) => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;';
      document.body.appendChild(video);
      await video.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 400));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      if (attach) {
        canvas.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(canvas);
      }
      const c2 = canvas.getContext('2d', { alpha: false });
      const pumped = canvas.captureStream(0);
      const track = pumped.getVideoTracks()[0];
      const chunks = [];
      const mr = new MediaRecorder(pumped, { mimeType: 'video/webm; codecs=vp9' });
      const t0 = performance.now();
      let firstData = null;
      mr.ondataavailable = (e) => {
        if (e.data) { if (firstData === null && e.data.size > 1) firstData = Math.round(performance.now() - t0); chunks.push(e.data); }
      };
      mr.start(250);
      const iv = setInterval(() => { c2.drawImage(video, 0, 0, canvas.width, canvas.height); track.requestFrame(); }, 16);
      await new Promise((r) => setTimeout(r, 8000));
      clearInterval(iv);
      mr.stop();
      await new Promise((r) => setTimeout(r, 900));
      const blob = new Blob(chunks, { type: 'video/webm' });
      const reader = new FileReader();
      const b64 = await new Promise((res) => { reader.onloadend = () => res(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
      return { b64, firstData, chunks: chunks.length, bytes: blob.size };
    }, attachCanvas);

    const file = path.join(OUT, `probe_${label}.webm`);
    fs.writeFileSync(file, Buffer.from(b64.b64, 'base64'));
    const ptsOut = execFileSync(path.resolve(__dirname, '../../ffprobe.exe'),
      ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file], { encoding: 'utf-8' });
    const pts = ptsOut.split('\n').map((x) => parseFloat(x)).filter((x) => !isNaN(x));
    let maxGap = 0, gapAt = 0;
    for (let i = 1; i < pts.length; i++) { const g = pts[i] - pts[i - 1]; if (g > maxGap) { maxGap = g; gapAt = pts[i - 1]; } }
    console.log(`[${label}] firstData=${b64.firstData}ms chunks=${b64.chunks} bytes=${b64.bytes} frames=${pts.length} firstPts=${pts[0]} lastPts=${pts[pts.length - 1]} maxGap=${maxGap.toFixed(3)}s @${gapAt}`);
  } finally {
    await ctx.close();
  }
}

await run('detached', false);
await run('attached', true);
server.close();

/**
 * Diagnostic (M1): how long does MediaRecorder take to emit its FIRST encoded
 * chunk, per codec, for a 1920x1080 canvas fed at 30 fps (10 Mbps, 250 ms
 * timeslice - the recorder's own settings)? A recording shorter than that
 * latency contains no video at all.
 *
 *   node tests/e2e/helpers/probe-recorder-start.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';
const server = http.createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<title>rec probe</title><body></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-recstart-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: CHROME_CFT,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--enable-features=WebCodecs', ...(process.env.PROBE_ARGS ? process.env.PROBE_ARGS.split(' ') : [])]
});
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const mimes = (process.argv[2] || 'video/webm;codecs=vp9,video/webm;codecs=vp8,video/webm;codecs=h264,video/mp4;codecs=avc1').split(',');
for (const mime of mimes) {
  const r = await page.evaluate(async ({ mime, w, h }) => {
    if (!MediaRecorder.isTypeSupported(mime)) return { mime, supported: false };
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { alpha: false });
    const stream = c.captureStream(0);
    const track = stream.getVideoTracks()[0];
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = `hsl(${(frame * 7) % 360},70%,40%)`; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.font = '120px sans-serif'; ctx.fillText(String(frame), 100 + (frame % 50) * 20, 300);
      for (let i = 0; i < 40; i++) ctx.fillRect((i * 97 + frame * 13) % w, (i * 53) % h, 60, 60);
      frame++; track.requestFrame();
    };
    const timer = setInterval(draw, 33);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const t0 = performance.now();
    let first = null, startEvt = null, bytes = 0, chunks = 0;
    rec.onstart = () => { startEvt = performance.now() - t0; };
    rec.ondataavailable = (e) => { if (e.data.size > 0) { chunks++; bytes += e.data.size; if (first === null) first = performance.now() - t0; } };
    rec.start(250);
    await new Promise((res) => setTimeout(res, 8000));
    await new Promise((res) => { rec.onstop = res; rec.stop(); });
    clearInterval(timer);
    return { mime, supported: true, onstartMs: Math.round(startEvt), firstChunkMs: first === null ? null : Math.round(first), chunks, kb: Math.round(bytes / 1024), framesDrawn: frame };
  }, { mime, w: 1920, h: 1080 });
  console.log(JSON.stringify(r));
}
await ctx.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });

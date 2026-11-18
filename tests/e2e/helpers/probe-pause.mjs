/**
 * Probe: does MediaRecorder.pause() exclude the paused interval from the
 * resulting WebM timeline? (QA-029 candidate fix.)
 *
 * Headless Chromium, a canvas captureStream(0) driven by requestFrame().
 * 1 s of frames, 1.5 s paused, 1 s of frames. If the blob duration is ~2 s,
 * pause is excluded; if ~3.5 s, the paused gap is part of the timeline.
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
const result = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const draw = (n) => { ctx.fillStyle = n % 2 ? '#ff00c8' : '#00e63c'; ctx.fillRect(0, 0, 320, 240); };
  draw(0);
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const frame = (n) => { draw(n); track.requestFrame(); };
  rec.start(100);
  const pauseAt = performance.now();
  rec.pause();                       // before any frame is requested
  await new Promise((r) => setTimeout(r, 1500));
  const resumeAt = performance.now();
  rec.resume();
  for (let i = 0; i < 20; i++) { frame(i); await new Promise((r) => setTimeout(r, 50)); }
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(s), pausedMs: Math.round(resumeAt - pauseAt), states: rec.state };
});
await browser.close();
fs.writeFileSync('tests/e2e/out/probe-pause.webm', Buffer.from(result.b64, 'base64'));
console.log(JSON.stringify({ pausedMs: result.pausedMs, bytes: fs.statSync('tests/e2e/out/probe-pause.webm').size }));

/**
 * Probe: does the REAL microphone, opened by Chrome with the PRODUCT's own
 * constraints (echoCancellation/noiseSuppression/autoGainControl = true), hear
 * the fixture WAV played through the speakers by a process OUTSIDE Chrome?
 *
 * No fake device flag is used. Usage:
 *   node tests/e2e/helpers/probe-real-mic.mjs <out.webm> [seconds]
 * Prints ffmpeg volumedetect / silencedetect of what Chrome recorded.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const WAV = path.join(REPO, 'tests', 'fixtures', 'audio', 'test.wav');
const FFMPEG = path.join(REPO, 'ffmpeg.exe');
const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';
const out = process.argv[2] || path.join(os.tmpdir(), 'probe-real-mic.webm');
const seconds = Number(process.argv[3] || 22);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-mic-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: fs.existsSync(CHROME_CFT) ? CHROME_CFT : undefined,
  args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});
// a secure context is needed for getUserMedia: serve a blank page on 127.0.0.1
const server = http.createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<title>mic probe</title>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const started = page.evaluate(async (ms) => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  const label = stream.getAudioTracks()[0].label;
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { label, inputs: devices.filter((d) => d.kind === 'audioinput').map((d) => d.label), b64: btoa(s) };
}, seconds * 1000);
// play the WAV through the speakers from a process outside Chrome
await new Promise((r) => setTimeout(r, 1000));
const player = spawn('powershell', ['-NoProfile', '-Command',
  `(New-Object System.Media.SoundPlayer '${WAV}').PlaySync()`], { stdio: 'ignore' });
const res = await started;
player.kill();
fs.writeFileSync(out, Buffer.from(res.b64, 'base64'));
await ctx.close();
server.close();
console.log('mic track label:', res.label);
console.log('audio inputs:', JSON.stringify(res.inputs));
for (const af of ['volumedetect', 'silencedetect=noise=-42dB:d=0.5', 'silencedetect=noise=-50dB:d=0.5']) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', out, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' });
  const lines = (r.stderr || '').split('\n').filter((l) => /mean_volume|max_volume|silence_(start|end)/.test(l));
  console.log(`--- ${af}\n` + lines.map((l) => l.replace(/^\[.*?\]\s*/, '')).join('\n'));
}

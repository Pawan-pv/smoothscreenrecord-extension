/**
 * Diagnostic: which surface does getDisplayMedia actually pick?
 *
 * Usage:
 *   node tests/e2e/helpers/probe-capture-surface.mjs <mode> <arg>
 *     mode=tab     arg=<exact tab title>
 *     mode=screen  arg=ignored
 *     mode=window  arg=<window title>
 *
 * Prints the track settings (displaySurface / resolution) and writes one frame
 * of the captured surface to tests/e2e/out/probe-capture-surface.png so a human
 * can look at what was captured.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(REPO, 'dist');
const FIXTURES = path.join(REPO, 'tests', 'fixtures');
const OUT = path.join(REPO, 'tests', 'e2e', 'out');
const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';

const mode = process.argv[2] || 'tab';
const arg = process.argv[3] || 'Clock Fixture - SmoothStudio QA';

const server = http.createServer((req, res) => {
  const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'clock.html';
  if (rel === 'probe-title.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>PROBETAB</title><body style="background:#0022aa;color:#fff;font:40px sans-serif">PROBETAB PAGE</body>');
    return;
  }
  const file = path.join(FIXTURES, rel);
  if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const args = [
  `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`,
  '--no-sandbox', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
  '--enable-features=WebCodecs', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--window-size=1920,1080', ...(process.env.PROBE_KIOSK ? ['--kiosk'] : []), '--window-position=0,0'
];
if (mode === 'tab') args.push(`--auto-select-tab-capture-source-by-title=${arg}`);
else if (mode === 'screen') args.push('--auto-select-desktop-capture-source=Entire screen');
else if (mode === 'window') args.push(`--auto-select-desktop-capture-source=${arg}`);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-probe-'));
const RAISE = path.join(__dirname, 'raise-window.ps1');
const context = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: process.env.PROBE_CHROME || CHROME_CFT, viewport: null, args
});

const target = await context.newPage();
await target.goto(`${base}/probe-title.html`, { waitUntil: 'domcontentloaded' });
await target.waitForTimeout(800);
console.log('open tabs:');
for (const p of context.pages()) console.log('  -', p.url(), '|', await p.title().catch(() => '?'));

await new Promise((r) => setTimeout(r, 500));
try { const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RAISE, '-ProfileDir', profile, '-Mode', 'top'], { encoding: 'utf8' }); console.log('raise:', out.trim()); } catch (e) { console.log('raise failed:', String(e).slice(0, 300)); }
await new Promise((r) => setTimeout(r, 800));
const prober = await context.newPage();
await prober.goto(`${base}/static.html`);
const result = await prober.evaluate(async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
    });
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const v = document.createElement('video');
    v.srcObject = stream; v.muted = true; await v.play();
    await new Promise((r) => setTimeout(r, 1200));
    const c = document.createElement('canvas');
    c.width = 960; c.height = 540;
    c.getContext('2d').drawImage(v, 0, 0, 960, 540);
    return { settings, dataUrl: c.toDataURL('image/png') };
  } catch (e) {
    return { error: e.name + ': ' + e.message };
  }
});
if (result.dataUrl) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, 'probe-capture-surface.png');
  fs.writeFileSync(p, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  console.log('frame written:', p);
}
delete result.dataUrl;
console.log('mode=' + mode, 'arg=' + arg);
console.log('result:', JSON.stringify(result, null, 2));

await context.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(0);

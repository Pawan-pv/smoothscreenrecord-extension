/**
 * Diagnostic: does the 48-bit epoch band decode from a LIVE page screenshot
 * (and does it decode from a captured video frame)?
 *
 * Usage: node tests/e2e/helpers/probe-epoch-band.mjs <url>
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO, 'tests', 'fixtures');
const OUT = path.join(REPO, 'tests', 'e2e', 'out');

const server = http.createServer((req, res) => {
  const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'clock.html';
  const file = path.join(FIXTURES, rel);
  if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: false, args: ['--window-size=1536,864', '--window-position=0,0'] });
const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
await page.goto(`${base}/clock.html`);
await page.waitForTimeout(700);
fs.mkdirSync(OUT, { recursive: true });
const shot = path.join(OUT, 'probe-epoch-live.png');
await page.screenshot({ path: shot });

const raw = execFileSync('ffmpeg.exe', ['-v', 'error', '-i', shot, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  { maxBuffer: 1 << 28 });
const size = execFileSync('ffprobe.exe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height', '-of', 'csv=p=0', shot], { encoding: 'utf8' }).trim();
const [w, h] = size.split(',').map(Number);
const shown = await page.locator('#epochms').innerText();
const shownEpoch = BigInt((shown.match(/(\d+)/) || [])[1] || '0');
console.log('live screenshot:', shot, `${w}x${h}`);
console.log('page shows:', shown, '=> epoch', shownEpoch.toString());

for (let y = 0; y < h; y += 4) {
  for (const cw of [w / 48]) {
    let v = 0n;
    for (let c = 0; c < 48; c++) {
      const x = Math.min(w - 1, Math.round((c + 0.5) * cw));
      const i = (y * w + x) * 3;
      const l = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
      v = v * 2n + (l > 128 ? 1n : 0n);
    }
    if (v === shownEpoch) console.log(`MATCH at y=${y} cellW=${cw.toFixed(2)}`);
  }
}
await browser.close();
server.close();

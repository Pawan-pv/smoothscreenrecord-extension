/**
 * Shared real-browser harness for the SmoothStudio e2e journeys.
 *
 * Everything here drives the REAL built extension (dist/) inside REAL Chrome
 * for Testing, exactly like a user would: real clicks, real typing, real
 * getDisplayMedia. No product internals are called to make things happen;
 * state is only READ for verification.
 */
import { chromium, BrowserContext, Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO = path.resolve(__dirname, '..', '..', '..');
export const DIST = path.join(REPO, 'dist');
export const FFPROBE = path.join(REPO, 'ffprobe.exe');
export const FFMPEG = path.join(REPO, 'ffmpeg.exe');
export const FIXTURES = path.join(REPO, 'tests', 'fixtures');
export const OUT_ROOT = path.join(REPO, 'tests', 'e2e', 'out');
export const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';
export const CHROMIUM_PW = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

/** The known audio timeline of tests/fixtures/audio/test.wav (see generate-test-wav.mjs). */
export const AUDIO = {
  file: path.join(FIXTURES, 'audio', 'test.wav'),
  durationSec: 20,
  silences: [[4.0, 6.0], [14.0, 16.0]],
  beeps: [2.0, 8.0, 18.0]
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function outDir(name: string): string {
  const dir = path.join(OUT_ROOT, name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ------------------------------------------------------------------ media */
export function ffprobeText(args: string[]): string {
  return execFileSync(FFPROBE, ['-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}
export function ffprobeJson(args: string[]): any {
  const out = ffprobeText(['-print_format', 'json', ...args]);
  return JSON.parse(out);
}
export function mediaInfo(file: string) {
  const p = ffprobeJson(['-show_entries', 'format=duration,size', '-show_entries',
    'stream=index,codec_type,codec_name,duration,width,height,sample_rate,channels,nb_frames', file]);
  const fmt = p.format || {};
  const streams = (p.streams || []).map((s: any) => ({ ...s, durationSec: s.duration ? parseFloat(s.duration) : null }));
  return {
    durationSec: fmt.duration ? parseFloat(fmt.duration) : null,
    sizeBytes: fmt.size ? parseInt(fmt.size, 10) : null,
    streams
  };
}
export function countFrames(file: string): number {
  const out = ffprobeText(['-select_streams', 'v:0', '-count_frames', '-show_entries',
    'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', file]).trim();
  return parseInt(out, 10) || 0;
}
/** End timestamp (s) of the last packet of a stream: the real length of that track. */
export function streamEndTime(file: string, kind: 'v' | 'a'): number {
  const out = ffprobeText(['-select_streams', kind === 'v' ? 'v:0' : 'a:0', '-show_entries',
    'packet=pts_time,duration_time', '-of', 'csv=p=0', file]).trim().split('\n').filter(Boolean);
  let end = 0;
  for (const line of out) {
    const [pts, dur] = line.split(',').map((n) => parseFloat(n));
    if (isFinite(pts)) end = Math.max(end, pts + (isFinite(dur) ? dur : 0));
  }
  return end;
}
export function ffmpeg(args: string[]): string {
  return execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
}
/** Silent spans of a media file, detected by ffmpeg (independent of the product). */
export function detectSilences(file: string, noise = '-42dB', minDur = 0.5) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-vn', '-af',
    `silencedetect=noise=${noise}:d=${minDur}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = (r.stderr || '') + (r.stdout || '');
  const starts = [...text.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...text.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? NaN }));
}
/** Extracts one frame as PNG. Output seeking (-ss after -i) is used on purpose:
 *  input seeking lands on the nearest keyframe, which can be hundreds of
 *  milliseconds away from the requested time. */
export function extractFrame(file: string, timeSec: number, outPng: string): string {
  ffmpeg(['-i', file, '-ss', String(timeSec), '-frames:v', '1', outPng]);
  return outPng;
}
/** Extracts one frame of a GIF. GIF frames are all key frames, so the seek is
 *  done on the input side; ffmpeg's output seeking does not work on GIFs. */
export function extractGifFrame(gif: string, timeSec: number, outPng: string): string {
  ffmpeg(['-i', gif, '-vsync', '0', '-f', 'image2', '-ss', String(timeSec), '-frames:v', '1', outPng]);
  return outPng;
}
/** Raw RGB24 pixels of an image. */
export function rawPixels(file: string): { buf: Buffer; w: number; h: number } {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 28 });
  const size = ffprobeText(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).trim();
  const [w, h] = size.split(',').map((n) => parseInt(n, 10));
  return { buf, w, h };
}
export function pixelAt(file: string, x: number, y: number): [number, number, number] {
  const { buf, w } = rawPixels(file);
  const i = (y * w + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}
export function meanLuma(file: string, rect: { x: number; y: number; w: number; h: number }): number {
  const { buf, w, h } = rawPixels(file);
  let sum = 0, n = 0;
  for (let py = rect.y; py < Math.min(h, rect.y + rect.h); py++) {
    for (let px = rect.x; px < Math.min(w, rect.x + rect.w); px++) {
      const i = (py * w + px) * 3;
      sum += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      n++;
    }
  }
  return n ? sum / n : 0;
}
/** Counts pixels close to a colour inside a rectangle. */
export function countColor(file: string, rect: { x: number; y: number; w: number; h: number },
  rgb: [number, number, number], tol = 40): number {
  const { buf, w, h } = rawPixels(file);
  let n = 0;
  for (let py = rect.y; py < Math.min(h, rect.y + rect.h); py++) {
    for (let px = rect.x; px < Math.min(w, rect.x + rect.w); px++) {
      const i = (py * w + px) * 3;
      if (Math.abs(buf[i] - rgb[0]) <= tol && Math.abs(buf[i + 1] - rgb[1]) <= tol && Math.abs(buf[i + 2] - rgb[2]) <= tol) n++;
    }
  }
  return n;
}

/**
 * Counts the connected components (8-connectivity) of the pixels that differ
 * between two frames. Used to count how many separate objects moved (for
 * example the OS cursor) between two moments of a recording.
 */
export function countChangedBlobs(fileA: string, fileB: string, minPixels = 8): {
  changed: number; blobs: number; boxes: { x: number; y: number; w: number; h: number; pixels: number }[];
} {
  const A = rawPixels(fileA);
  const B = rawPixels(fileB);
  const w = Math.min(A.w, B.w);
  const h = Math.min(A.h, B.h);
  const mask = new Uint8Array(w * h);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const d = Math.abs(A.buf[i] - B.buf[i]) + Math.abs(A.buf[i + 1] - B.buf[i + 1]) + Math.abs(A.buf[i + 2] - B.buf[i + 2]);
      if (d > 60) { mask[y * w + x] = 1; changed++; }
    }
  }
  const seen = new Uint8Array(w * h);
  const blobs: { x: number; y: number; w: number; h: number; pixels: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, pixels = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      pixels++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    if (pixels >= minPixels) blobs.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels });
  }
  return { changed, blobs: blobs.length, boxes: blobs };
}

/**
 * Decodes the 48-bit millisecond epoch readout that clock.html and avsync.html
 * draw as a row of black/white cells across the top of the page.
 *
 * The band sits at the top of the PAGE viewport, so in a screen capture it is
 * below the browser chrome - the row is therefore searched for instead of
 * being assumed. Returns the epoch milliseconds, or null when no row decodes
 * to a plausible epoch.
 */
/** Presentation timestamps (seconds) of every frame in the file. */
export function framePts(file: string): number[] {
  const out = ffprobeText(['-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file]);
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map(Number);
}
/** Extracts the frame with the given index (0-based) as PNG. */
export function extractFrameByIndex(file: string, index: number, outPng: string): string {
  ffmpeg(['-i', file, '-vf', `select=eq(n\\,${index})`, '-vsync', '0', '-frames:v', '1', outPng]);
  return outPng;
}

export function decodeEpochCandidates(png: string): number[] {
  const { buf, w, h } = rawPixels(png);
  const cellW = w / 48;
  const found: number[] = [];
  for (let frac = 0.02; frac <= 0.30; frac += 0.0025) {
    const y = Math.min(h - 2, Math.round(h * frac));
    let value = 0;
    for (let c = 0; c < 48; c++) {
      const x = Math.min(w - 1, Math.round((c + 0.5) * cellW));
      const i = (y * w + x) * 3;
      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      value = value * 2 + (luma > 128 ? 1 : 0);
    }
    if (value >= 1_600_000_000_000 && value <= 4_000_000_000_000 && !found.includes(value)) found.push(value);
  }
  return found;
}

/**
 * Decodes the 48-bit millisecond epoch readout that clock.html and avsync.html
 * draw as a row of black/white cells across the top of the page.
 *
 * The band sits at the top of the PAGE viewport, so in a screen capture it is
 * below the browser chrome - the row is therefore searched for instead of
 * being assumed. Returns the epoch milliseconds, or null when no row decodes
 * to a plausible epoch.
 */
export function decodeEpochBits(png: string): number | null {
  const candidates = decodeEpochCandidates(png);
  return candidates.length ? candidates[0] : null;
}

/** Band energy (RMS dB) of a media file in a 4-5 kHz band around a time window. */
export function bandRmsDb(file: string, startSec: number, durSec: number): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(startSec), '-t', String(durSec), '-i', file,
    '-af', 'highpass=f=4000,lowpass=f=5000,astats', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  const m = /RMS level dB: (-?[\d.]+|[-]inf)/.exec((r.stderr || '') + (r.stdout || ''));
  if (!m) return -Infinity;
  return m[1] === '-inf' ? -Infinity : parseFloat(m[1]);
}

/* --------------------------------------------------------------- browser */
export interface LaunchOptions {
  /** Which surface getDisplayMedia should pick. */
  capture?: 'screen' | 'tab' | 'window';
  /** Tab title for tab capture. */
  tabTitle?: string;
  /** Window title for window capture. */
  windowTitle?: string;
  /**
   * Opens the given URL in a separate kiosk-style app window that covers the
   * screen. Chrome for Testing 157 ignores --auto-select-tab-capture-source-by-title
   * and --auto-select-desktop-capture-source=<title> (proven: displaySurface is
   * always "monitor"), so the only way to record REAL PAGE CONTENT is to let
   * the page fill the screen and capture the screen.
   */
  appUrl?: string;
  /** Feed the microphone from AUDIO.file (mic journeys only). */
  mic?: boolean;
  /** Extra Chrome flags. */
  extraArgs?: string[];
  /** Push the browser window to the top of the z-order while the test runs. */
  raiseWindow?: boolean;
  width?: number;
  height?: number;
}

export async function launchApp(opts: LaunchOptions = {}): Promise<{
  context: BrowserContext; extensionId: string; cleanup: () => Promise<void>; profile: string;
}> {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error('dist/manifest.json missing - run "npm run build" first');
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-qa-'));
  const args = [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-features=WebCodecs',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    `--window-size=${opts.width || 1536},${opts.height || 864}`,
    '--window-position=0,0'
  ];
  if (opts.capture === 'screen') {
    args.push('--auto-select-desktop-capture-source=Entire screen');
  } else if (opts.capture === 'tab' && opts.tabTitle) {
    args.push(`--auto-select-tab-capture-source-by-title=${opts.tabTitle}`);
  } else if (opts.capture === 'window' && opts.windowTitle) {
    args.push(`--auto-select-desktop-capture-source=${opts.windowTitle}`);
  }
  if (opts.appUrl) {
    // A separate app window (no browser chrome) that covers the whole screen.
    args.push(`--app=${opts.appUrl}`, '--window-position=0,0');
  }
  if (opts.mic) {
    // ONLY for mic journeys: the fake device replaces the microphone only.
    // The captured video surface is never faked.
    args.push('--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${AUDIO.file}`);
  }
  if (opts.extraArgs) args.push(...opts.extraArgs);

  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: fs.existsSync(CHROME_CFT) ? CHROME_CFT : CHROMIUM_PW,
    viewport: null,
    acceptDownloads: true,
    args
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(sw.url()).host;

  // The desktop in this environment has other windows (an always-on-top IDE)
  // that would otherwise be captured instead of the page under test, so the
  // browser window is pushed to the top of the z-order for the duration of the
  // test and restored afterwards.
  const raise = async (mode: 'top' | 'normal') => {
    if (!opts.raiseWindow) return;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'raise-window.ps1'), '-ProfileDir', profile, '-Mode', mode],
        { encoding: 'utf8', timeout: 20000 });
    } catch { /* the window could not be raised - the capture will show what it shows */ }
  };
  await raise('top');

  return {
    context,
    extensionId,
    profile,
    cleanup: async () => {
      await raise('normal');
      await context.close().catch(() => undefined);
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return; }
        catch { await sleep(300); }
      }
    }
  };
}

/* --------------------------------------------------------------- fixtures */
export interface FixtureServer {
  base: string;
  /** Payloads received by POST /echo (url-encoded form bodies). */
  echoPayloads(): string[];
  close(): Promise<void>;
}

export function serveFixtures(): Promise<FixtureServer> {
  const payloads: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && (req.url || '').split('?')[0] === '/echo') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        payloads.push(body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('echo received: ' + body.length + ' bytes');
      });
      return;
    }
    const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
    const file = path.join(FIXTURES, rel);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found: ' + rel);
      return;
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        echoPayloads: () => payloads.slice(),
        close: () => new Promise<void>((r) => server.close(() => r()))
      });
    });
  });
}

/* ---------------------------------------------------------------- editor */
export interface RecordedSession {
  target: Page;
  editor: Page;
  wallClockSec: number;
  startedAt: number;
}

/**
 * Records the given page the way a user does: the editor tab is opened and
 * started, then the TARGET page is brought to the front (the editor stays in
 * the background), then the on-page HUD button stops the recording.
 */
export async function recordPage(
  context: BrowserContext,
  extensionId: string,
  targetUrl: string,
  opts: { seconds: number; includeMic: boolean; target?: Page; editor?: Page; interact?: (p: Page) => Promise<void> }
): Promise<RecordedSession> {
  const target = opts.target || (await context.newPage());
  if (!opts.target) {
    await target.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await target.waitForTimeout(500);
  }
  let editor = opts.editor;
  if (!editor) {
    editor = await context.newPage();
    await editor.goto(`chrome-extension://${extensionId}/editor.html?record=true&includeMic=${opts.includeMic}`);
    await editor.bringToFront();
    await editor.locator('#start-capture-prompt-btn').click({ timeout: 20000 });
  } else {
    // A pre-opened editor (e.g. one opened by the popup's Start Studio
    // Recording button) still has to be started the way a user starts it.
    await editor.bringToFront();
    const startPrompt = editor.locator('#start-capture-prompt-btn');
    if (await startPrompt.count()) {
      await startPrompt.click({ timeout: 20000 });
    } else {
      await editor.locator('#record-new-screen-top-btn').click({ timeout: 20000 });
    }
  }
  await editor.locator('#stop-live-recording-top-btn').waitFor({ state: 'visible', timeout: 30000 });

  await target.bringToFront();
  // The on-page HUD only appears once the recorder is actually running, so this
  // is the true "recording is live" instant - the wall clock is measured from
  // here, not from the click that started it.
  await target.locator('#smoothstudio-stop-btn').waitFor({ state: 'visible', timeout: 20000 });
  const startedAt = Date.now();

  if (opts.interact) await opts.interact(target);
  await target.waitForTimeout(opts.seconds * 1000);
  await target.locator('#smoothstudio-stop-btn').click();
  const wallClockSec = (Date.now() - startedAt) / 1000;

  await editor.bringToFront();
  await editor.locator('#smoothstudio-source-video').waitFor({ state: 'attached', timeout: 60000 });
  return { target, editor, wallClockSec, startedAt };
}

/** Reads the recorder's own output file out of OPFS (verification only). */
export async function readOpfsFile(page: Page, name: string): Promise<Buffer | null> {
  const b64 = await page.evaluate(async (fileName) => {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(fileName);
      const file = await handle.getFile();
      const buf = new Uint8Array(await file.arrayBuffer());
      let s = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      return btoa(s);
    } catch { return null; }
  }, name);
  return b64 ? Buffer.from(b64, 'base64') : null;
}

/** Saves the recorder's raw output file to disk and returns its path. */
export async function saveRawRecording(page: Page, dir: string): Promise<string | null> {
  const bytes = await readOpfsFile(page, 'smoothstudio_recording.webm');
  if (!bytes) return null;
  const p = path.join(dir, 'raw_recording.webm');
  fs.writeFileSync(p, bytes);
  return p;
}

/** Console errors and page crashes of a page, collected for the report. */
export function collectPageProblems(page: Page): { errors: string[]; crashes: string[] } {
  const errors: string[] = [];
  const crashes: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 400)));
  page.on('crash', () => crashes.push('page crashed'));
  return { errors, crashes };
}

/**
 * Shared helpers for the Round 4 verification suites.
 * Every capture test in this folder runs WITHOUT --use-fake-device-for-media-stream.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const EXTENSION_DIST_PATH = path.resolve(REPO_ROOT, 'dist');
export const FFPROBE = path.resolve(REPO_ROOT, 'ffprobe.exe');
export const FFMPEG = path.resolve(REPO_ROOT, 'ffmpeg.exe');
export const CHROME_CFT = 'C:\\Users\\pawan\\.cache\\puppeteer\\chrome\\win64-157.0.8103.50\\chrome-win64\\chrome.exe';
export const CHROMIUM_PW = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

export function outDir(name) {
  // NOTE: artifacts live OUTSIDE test-results/ because the Playwright runner
  // wipes test-results/ on every `playwright test` run.
  const dir = path.resolve(REPO_ROOT, 'tests', 'round4', 'out', name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function serveFixture(fixtureName, port) {
  const html = fs.readFileSync(path.resolve(REPO_ROOT, 'tests', fixtureName), 'utf8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise((r) => server.listen(port, r));
  return server;
}

export async function launch(opts = {}) {
  const {
    executablePath = CHROME_CFT,
    args = [],
    viewport = { width: 1280, height: 720 },
    headless = false
  } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-'));
  const context = await chromium.launchPersistentContext(dir, {
    headless,
    executablePath,
    viewport,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
      `--load-extension=${EXTENSION_DIST_PATH}`,
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--window-size=1280,760',
      ...args
    ]
  });
  return context;
}

export async function extensionId(context) {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker', { timeout: 15000 });
  return new URL(background.url()).host;
}

export function ffprobeJson(args) {
  const out = execFileSync(FFPROBE, ['-v', 'quiet', '-print_format', 'json', ...args], { encoding: 'utf-8' });
  return JSON.parse(out);
}

export function ffprobeText(args) {
  return execFileSync(FFPROBE, ['-v', 'error', ...args], { encoding: 'utf-8' });
}

export function ffmpeg(args) {
  return execFileSync(FFMPEG, ['-y', ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** All video frame presentation timestamps (seconds) of a media file. */
export function framePts(file) {
  const out = ffprobeText(['-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file]);
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map(Number);
}

/** md5 of every frame (framemd5) used for duplicate detection. */
export function frameMd5(file) {
  const out = execFileSync(FFMPEG, ['-i', file, '-f', 'framemd5', '-'], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 256 });
  return out.split('\n').filter((l) => l.startsWith('0,')).map((l) => l.split(',')[5].trim());
}

/** Extract a single frame as raw rgb24 so pixel values can be inspected. */
export function rawFrame(file, timeSec) {
  const buf = execFileSync(FFMPEG, [
    '-v', 'error', '-ss', String(timeSec), '-i', file, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
  ], { maxBuffer: 1024 * 1024 * 256 });
  return buf;
}

export function videoSize(file) {
  const probe = ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-show_entries', 'format=duration', file]);
  const s = probe.streams?.[0] || {};
  return { width: s.width, height: s.height, duration: parseFloat(probe.format?.duration || '0') };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

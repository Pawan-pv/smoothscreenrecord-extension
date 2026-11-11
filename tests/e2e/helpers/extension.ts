// Real-browser helpers for SmoothStudio e2e tests.
// Everything here uses the real built extension (dist/) in a real Chromium.
// No hooks from the product are used: the test drives the UI like a user.
import { chromium, BrowserContext, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The npm scripts run from the repo root (package.json is "type": "module", so
// __dirname is not available).
export const REPO = process.cwd();
if (!fs.existsSync(path.join(REPO, 'package.json'))) {
  throw new Error(`Run tests from the repo root. cwd=${REPO}`);
}
export const DIST = path.join(REPO, 'dist');
export const FFPROBE = path.join(REPO, 'ffprobe.exe');
export const AUDIO_FIXTURE = path.join(REPO, 'tests', 'fixtures', 'test-audio.wav');
/**
 * QA-020: the speech-like fixture (2.00 s digital silences at 4-6 s and 14-16 s).
 * Used for the real-mic journeys: test-audio.wav is STATIONARY noise, which the
 * product's (correct) WebRTC noise suppression treats as room noise in a real room.
 */
export const SPEECH_WAV = path.join(REPO, 'tests', 'fixtures', 'audio', 'test.wav');
export const TARGET_PAGE = path.join(REPO, 'tests', 'fixtures', 'test-page.html');

export interface LaunchOptions {
  /**
   * Mic journeys: grant the REAL microphone without a prompt. (QA-020: the fake
   * capture device must never be used - it replaces the screen picture too.
   * Play AUDIO_FIXTURE through the speakers with helpers/speaker.ts.)
   */
  realMic?: boolean;
  /** Raise the browser window above every other window so the screen capture records it. */
  raiseWindow?: boolean;
}

export async function launchExtension(opts: LaunchOptions = {}): Promise<{
  context: BrowserContext;
  extensionId: string;
  cleanup: () => Promise<void>;
}> {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(`dist/manifest.json missing. Run "npm run build" first (looked in ${DIST}).`);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-e2e-'));
  const args = [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    // Auto-pick the entire screen in the getDisplayMedia picker (real capture, no fake device).
    '--auto-select-desktop-capture-source=Entire screen',
    '--start-maximized',
  ];
  if (opts.realMic) {
    if (!fs.existsSync(AUDIO_FIXTURE)) {
      throw new Error(`Audio fixture missing: ${AUDIO_FIXTURE}. Run: python tests/fixtures/generate_audio.py`);
    }
    // Only the permission prompt is auto-accepted; the devices are real.
    args.push('--use-fake-ui-for-media-stream');
  }
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: 'chromium',
    viewport: null,
    acceptDownloads: true,
    args,
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = sw.url().split('/')[2];
  // Real screen capture records whatever is on top: raise the browser window
  // (same helper as harness.ts) so the capture is the page under test.
  const raise = (mode: 'top' | 'normal') => {
    if (!opts.raiseWindow) return;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(REPO, 'tests', 'e2e', 'helpers', 'raise-window.ps1'), '-ProfileDir', profile, '-Mode', mode],
        { encoding: 'utf8', timeout: 20000 });
    } catch (e) { console.log('[launchExtension] could not raise the window:', String(e).slice(0, 200)); }
  };
  raise('top');
  return {
    context,
    extensionId,
    cleanup: async () => {
      raise('normal');
      // If the browser already died, report it but let the test's own error surface.
      await context.close().catch((e) => console.log('[cleanup] context.close failed:', String(e).slice(0, 200)));
      // Windows keeps the profile directory locked for a short while after the
      // browser exits. Retry the delete so a teardown race cannot mask the
      // real assertion failure that ended the test.
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
          return;
        } catch (err) {
          if (attempt === 9) {
            console.log('[cleanup] profile delete failed:', String(err).slice(0, 200));
            return;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    },
  };
}

/** Reads a file from the editor page's OPFS root (the raw recording written by the recorder). */
export async function readOpfsFile(page: Page, name: string): Promise<Buffer | null> {
  const b64 = await page.evaluate(async (fileName) => {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(fileName);
      const file = await handle.getFile();
      const buf = new Uint8Array(await file.arrayBuffer());
      let s = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      return btoa(s);
    } catch {
      return null;
    }
  }, name);
  return b64 ? Buffer.from(b64, 'base64') : null;
}

export interface FfprobeStream {
  codec_type: 'video' | 'audio' | string;
  codec_name?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

export function ffprobeStreams(file: string): { streams: FfprobeStream[]; format: { duration?: string } } {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration,sample_rate,channels',
    '-show_entries', 'format=duration', '-of', 'json', file,
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}

export function writeScratch(name: string, data: Buffer): string {
  const dir = path.join(os.tmpdir(), 'ss-e2e-artifacts');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
}

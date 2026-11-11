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
export const TARGET_PAGE = path.join(REPO, 'tests', 'fixtures', 'test-page.html');

export interface LaunchOptions {
  /** Feed the microphone from AUDIO_FIXTURE. Only for mic/audio tests (rule 4). */
  fakeMicFile?: boolean;
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
  ];
  if (opts.fakeMicFile) {
    if (!fs.existsSync(AUDIO_FIXTURE)) {
      throw new Error(`Audio fixture missing: ${AUDIO_FIXTURE}. Run: python tests/fixtures/generate_audio.py`);
    }
    args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO_FIXTURE}`);
  }
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: 'chromium',
    args,
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = sw.url().split('/')[2];
  return {
    context,
    extensionId,
    cleanup: async () => {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
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

// Shared real-flow helpers: serve fixture pages, record a session like a user,
// and analyse media files with the real ffmpeg/ffprobe binaries.
import { expect, BrowserContext, Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { REPO } from './extension';
import { prepareSpeaker } from './speaker';
import { raiseContextWindows, loadedRecordingBytes } from './harness';
import { guardRecording } from './marker';

export const FFMPEG = path.join(REPO, 'ffmpeg.exe');

export function serveFixtures(): Promise<{ base: string; close: () => Promise<void> }> {
  const dir = path.join(REPO, 'tests', 'fixtures');
  const server = http.createServer((req, res) => {
    const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'test-page.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

export interface RecordedSession {
  target: Page;
  editor: Page;
  wallClockSec: number;
  /** Seconds between "recording live" and the start of the speaker audio (null without speakerWav). */
  audioOffsetSec: number | null;
}

/**
 * Starts a recording from the editor, puts the recorded page in front (editor
 * in the background, as users do), waits, and returns WITHOUT stopping.
 */
export async function startRecording(
  context: BrowserContext,
  extensionId: string,
  targetUrl: string,
  opts: { includeMic: boolean; existingTarget?: Page; existingEditor?: Page }
): Promise<{ target: Page; editor: Page; startedAt: number }> {
  const target = opts.existingTarget || (await context.newPage());
  if (!opts.existingTarget) await target.goto(targetUrl);
  raiseContextWindows(context); // AGENTS.md 3.8

  let editor = opts.existingEditor;
  if (!editor) {
    editor = await context.newPage();
    await editor.goto(`chrome-extension://${extensionId}/editor.html?record=true&includeMic=${opts.includeMic}`);
    await editor.locator('#start-capture-prompt-btn').click();
  } else {
    await editor.bringToFront();
    await editor.locator('#record-new-screen-top-btn').click();
  }
  await expect(editor.locator('#stop-live-recording-top-btn')).toBeVisible({ timeout: 30000 });
  const startedAt = Date.now();
  await target.bringToFront();
  return { target, editor, startedAt };
}

/** Records for `seconds`, then stops with the on-page HUD button. */
export async function recordSession(
  context: BrowserContext,
  extensionId: string,
  targetUrl: string,
  seconds: number,
  opts: { includeMic: boolean; speakerWav?: string }
): Promise<RecordedSession> {
  const speaker = opts.speakerWav ? await prepareSpeaker(opts.speakerWav) : null;
  const { target, editor, startedAt } = await startRecording(context, extensionId, targetUrl, opts);
  await expect(target.locator('#smoothstudio-stop-btn')).toBeVisible({ timeout: 15000 });
  let audioOffsetSec: number | null = null;
  if (speaker) {
    audioOffsetSec = ((await speaker.go()) - startedAt) / 1000;
    console.log(`[session] speaker playback started ${audioOffsetSec.toFixed(3)} s after the recording went live`);
  }
  await target.waitForTimeout(seconds * 1000);
  await target.locator('#smoothstudio-stop-btn').click();
  const wallClockSec = (Date.now() - startedAt) / 1000;
  speaker?.stop();
  await expect(editor.locator('#smoothstudio-source-video')).toHaveCount(1, { timeout: 60000 });
  // AGENTS.md 3.8: the recording is checked for the marker before anything views or saves it
  const loaded = await loadedRecordingBytes(editor);
  if (loaded) guardRecording(loaded, 'recordSession');
  return { target, editor, wallClockSec, audioOffsetSec };
}

/** silence_start / silence_end times (seconds) from ffmpeg silencedetect. */
export function detectSilences(file: string, minDur = 0.5): { start: number; end: number }[] {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-vn', '-af', `silencedetect=noise=-35dB:d=${minDur}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const text = r.stderr || '';
  const starts = [...text.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...text.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? NaN }));
}

/**
 * Times (seconds) at which the centre of the picture goes from dark to bright.
 * Uses the real decoded frames' presentation timestamps.
 */
export function detectFlashOnsets(file: string): number[] {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-an', '-vf',
    'crop=iw/4:ih/4:iw*3/8:ih*3/8,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const lines = (r.stdout || '').split(/\r?\n/);
  const onsets: number[] = [];
  let t = 0;
  let prevBright = false;
  let first = true;
  for (const line of lines) {
    const mt = /pts_time:([\d.]+)/.exec(line);
    if (mt) { t = parseFloat(mt[1]); continue; }
    const my = /YAVG=([\d.]+)/.exec(line);
    if (my) {
      const bright = parseFloat(my[1]) > 128;
      if (bright && !prevBright && !first) onsets.push(t);
      prevBright = bright;
      first = false;
    }
  }
  return onsets;
}

export function ffprobeRaw(file: string, ffprobe: string): string {
  return execFileSync(ffprobe, ['-v', 'error', '-show_entries',
    'stream=index,codec_type,codec_name,duration,start_time,nb_frames,sample_rate,channels',
    '-show_entries', 'format=duration', '-of', 'compact', file], { encoding: 'utf8' }).trim();
}

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
import { raiseContextWindows, loadedRecordingBytes, recordingOrigin } from './harness';
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
  // QA-037: the product declares the instant its first encoded picture really
  // shows the recorded surface; the HUD paint is ~1 s earlier.
  await target.bringToFront();
  const startedAt = await recordingOrigin(editor);
  await expect(target.locator('#smoothstudio-stop-btn')).toBeVisible({ timeout: 15000 });
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

function streamStartTime(file: string, kind: 'a' | 'v'): number {
  const r = spawnSync(path.join(REPO, 'ffprobe.exe'), ['-v', 'error', '-select_streams', `${kind}:0`,
    '-show_entries', 'stream=start_time', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const v = parseFloat((r.stdout || '').trim());
  return Number.isFinite(v) ? v : 0;
}

function decodeMono48k(file: string): Buffer {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000',
    '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (!r.stdout || r.stdout.length === 0) throw new Error(`could not decode audio from ${file}`);
  return r.stdout;
}

function rmsEnvelope(pcm: Buffer): Float64Array {
  const SR = 48000, WIN = 480, HOP = 48; // 10 ms window, 1 ms hop
  const n = Math.floor((pcm.length / 4 - WIN) / HOP);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const base = i * HOP;
    for (let j = 0; j < WIN; j++) {
      const s = pcm.readFloatLE((base + j) * 4);
      sum += s * s;
    }
    env[i] = Math.sqrt(sum / WIN);
  }
  return env;
}

/**
 * Shift (ms) the export applies to the audio timeline, measured against the
 * raw recording: the peak lag of the two RMS envelopes at 1 ms resolution,
 * corrected for the raw stream's own start_time (Opus starts at 0.049 s here,
 * and the exporter pads that span, so the content must stay at 0.049 s).
 *
 * The correlation coefficient is returned too: the export has to carry the
 * same audio, not silence or a different track.
 */
export function measureAudioShiftMs(sourceFile: string, exportFile: string): {
  shiftMs: number; correlation: number; lagMs: number; sourceStartMs: number;
} {
  const MAX = 100; // search +/- 100 ms
  const a = rmsEnvelope(decodeMono48k(sourceFile));
  const b = rmsEnvelope(decodeMono48k(exportFile));
  const from = MAX + 1;
  const to = Math.min(a.length, b.length) - MAX - 1;
  const mean = (v: Float64Array, lo: number, hi: number) => {
    let s = 0;
    for (let i = lo; i < hi; i++) s += v[i];
    return s / (hi - lo);
  };
  const ma = mean(a, from, to), mb = mean(b, from, to);
  let best = -Infinity, bestLag = 0;
  for (let lag = -MAX; lag <= MAX; lag++) {
    let num = 0, da = 0, db = 0;
    for (let i = from; i < to; i++) {
      const j = i + lag;
      const x = a[j] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    const r = num / Math.sqrt(da * db);
    if (r > best) { best = r; bestLag = lag; }
  }
  const sourceStartMs = streamStartTime(sourceFile, 'a') * 1000;
  return {
    shiftMs: -bestLag - sourceStartMs,
    correlation: best,
    lagMs: bestLag,
    sourceStartMs,
  };
}

export function ffprobeRaw(file: string, ffprobe: string): string {
  return execFileSync(ffprobe, ['-v', 'error', '-show_entries',
    'stream=index,codec_type,codec_name,duration,start_time,nb_frames,sample_rate,channels',
    '-show_entries', 'format=duration', '-of', 'compact', file], { encoding: 'utf8' }).trim();
}

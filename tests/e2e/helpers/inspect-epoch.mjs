/**
 * Standalone inspector: prints the wall-clock epoch that is painted into each
 * extracted frame of a recording, next to the video timestamp.
 *
 * clock.html and avsync.html draw the current Date.now() as 48 black/white
 * cells across the top of the page, so the wall-clock time of every recorded
 * frame can be read straight out of the video.
 *
 * Usage: node tests/e2e/helpers/inspect-epoch.mjs <media-file> [stepSec] [maxSec]
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const FFMPEG = path.join(REPO, 'ffmpeg.exe');
const FFPROBE = path.join(REPO, 'ffprobe.exe');

export function decodeEpochBits(buf, w, h) {
  const bandY = Math.max(1, Math.round(h * 0.015));
  const cellW = w / 48;
  let value = 0;
  for (let c = 0; c < 48; c++) {
    const x = Math.min(w - 1, Math.round((c + 0.5) * cellW));
    const i = (bandY * w + x) * 3;
    const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
    value = value * 2 + (luma > 128 ? 1 : 0);
  }
  if (value < 1_600_000_000_000 || value > 4_000_000_000_000) return null;
  return value;
}

export function frameEpoch(file, timeSec, tmpDir) {
  const png = path.join(tmpDir, `epoch_${String(timeSec).replace('.', '_')}.png`);
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(timeSec), '-i', file,
    '-frames:v', '1', png]);
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 28 });
  const size = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', png], { encoding: 'utf8' }).trim();
  const [w, h] = size.split(',').map((n) => parseInt(n, 10));
  return { epoch: decodeEpochBits(raw, w, h), png };
}

if (process.argv[2]) {
  const file = process.argv[2];
  const step = parseFloat(process.argv[3] || '1');
  const max = parseFloat(process.argv[4] || '21');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epoch-'));
  const rows = [];
  let first = null;
  for (let t = 0; t <= max; t += step) {
    const { epoch } = frameEpoch(file, t, tmp);
    if (epoch === null) { rows.push({ t, epoch: null }); continue; }
    if (first === null) first = epoch;
    rows.push({
      t,
      epoch,
      sinceStartMs: epoch - first,
      driftVsVideoMs: Math.round((epoch - first) - t * 1000)
    });
  }
  console.log(JSON.stringify(rows, null, 1));
  fs.rmSync(tmp, { recursive: true, force: true });
}

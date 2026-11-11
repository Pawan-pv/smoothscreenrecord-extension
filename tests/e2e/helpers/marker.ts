/**
 * Capture-content guard (AGENTS.md §3.8).
 *
 * Every page of the TEST browser (fixtures, editor, popup) carries a marker:
 * thick side/bottom strips in a colour chosen at random for this run, plus a
 * random token in large text (bottom-left). Before any test may view or save a
 * recording, every one of its frames is decoded IN MEMORY (ffmpeg via stdin,
 * nothing written to disk) and checked for the marker colour. A frame without
 * it shows something that is not the test browser (another application on
 * the desktop): the bytes are dropped unviewed, an abort file is written (no
 * frame data in it) and every later journey refuses to launch.
 *
 * The strips stay out of the top 6 vh, where clock.html / avsync.html paint the
 * epoch band the journeys decode, and the overlay ignores the pointer.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { BrowserContext } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const FFMPEG = path.join(REPO, 'ffmpeg.exe');
export const MARKER_ABORT_FILE = path.join(REPO, 'tests', 'e2e', 'out', 'MARKER_ABORT.json');

// Saturated colours far from the product's purple / the fixtures' cyan.
const PALETTE: [number, number, number][] = [[255, 0, 200], [0, 230, 60], [255, 120, 0], [230, 230, 0]];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const pick = (n: number) => Math.floor(Math.random() * n);

export const MARKER = {
  token: 'QA ' + Array.from({ length: 6 }, () => LETTERS[pick(LETTERS.length)]).join(''),
  rgb: PALETTE[pick(PALETTE.length)]
};

export function markerInitScript(token: string, rgb: [number, number, number]): string {
  const color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return `(() => {
    if (window.top !== window) return;
    const add = () => {
      if (document.getElementById('__qa_capture_marker')) return;
      const root = document.createElement('div');
      root.id = '__qa_capture_marker';
      root.setAttribute('data-smoothstudio-ignore', 'true');
      root.setAttribute('aria-hidden', 'true');
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
      const strip = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;background:${color};' + css; root.appendChild(d); };
      strip('left:0;top:6vh;bottom:0;width:24px;');
      strip('right:0;top:6vh;bottom:0;width:24px;');
      strip('left:0;right:0;bottom:0;height:24px;');
      const t = document.createElement('div');
      t.textContent = ${JSON.stringify(token)};
      t.style.cssText = 'position:absolute;left:32px;bottom:32px;padding:4px 10px;font:700 34px Consolas,monospace;color:#000;background:${color};';
      root.appendChild(t);
      (document.documentElement || document).appendChild(root);
    };
    if (document.documentElement) add();
    document.addEventListener('DOMContentLoaded', add);
    new MutationObserver(() => { if (!document.getElementById('__qa_capture_marker') && document.documentElement) add(); })
      .observe(document, { childList: true, subtree: true });
  })();`;
}

/** Installs the marker on every page of the test browser. Call right after launch. */
export async function installMarker(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: markerInitScript(MARKER.token, MARKER.rgb) });
}

/** Throws if an earlier journey of this run captured the wrong content. */
export function assertRunNotAborted(): void {
  if (fs.existsSync(MARKER_ABORT_FILE)) {
    throw new Error(`Run aborted: an earlier journey captured content without the test marker (${fs.readFileSync(MARKER_ABORT_FILE, 'utf8').slice(0, 300)}). ` +
      'Free the desktop, delete tests/e2e/out/MARKER_ABORT.json and start the run again.');
  }
}

export interface MarkerCheck { frames: number; missing: number; firstMissing: number | null }

/** Decodes every frame in memory (nothing is written) and counts frames without the marker. */
export function checkMarkerInMemory(bytes: Buffer, rgb: [number, number, number] = MARKER.rgb): MarkerCheck {
  const W = 320, H = 180, TOL = 60;
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', 'pipe:0', '-vsync', '0', '-vf', `scale=${W}:${H}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: bytes, maxBuffer: 1 << 30 });
  const raw: Buffer = r.stdout || Buffer.alloc(0);
  const fb = W * H * 3;
  let frames = 0, missing = 0, firstMissing: number | null = null;
  for (let off = 0; off + fb <= raw.length; off += fb, frames++) {
    const hit = (x: number, y: number) => {
      const i = off + (y * W + x) * 3;
      return Math.abs(raw[i] - rgb[0]) <= TOL && Math.abs(raw[i + 1] - rgb[1]) <= TOL && Math.abs(raw[i + 2] - rgb[2]) <= TOL;
    };
    // SHAPE: the colour must form a vertical strip at the left AND the right
    // edge of the frame (rows 30-80 %), not merely appear somewhere.
    const EDGE = 10;
    let rows = 0, leftRows = 0, rightRows = 0;
    for (let y = Math.round(H * 0.3); y < Math.round(H * 0.8); y++) {
      rows++;
      let l = false, r2 = false;
      for (let x = 0; x < EDGE && !l; x++) l = hit(x, y);
      for (let x = W - EDGE; x < W && !r2; x++) r2 = hit(x, y);
      if (l) leftRows++;
      if (r2) rightRows++;
    }
    if (!(leftRows >= 0.7 * rows && rightRows >= 0.7 * rows)) {
      missing++;
      if (firstMissing === null) firstMissing = frames;
    }
  }
  return { frames, missing, firstMissing };
}

/**
 * The gate every recording passes BEFORE it is saved or looked at. On failure
 * the bytes are dropped (never written), the run is marked aborted and the
 * test fails with counts only.
 */
export function guardRecording(bytes: Buffer, label: string): void {
  const c = checkMarkerInMemory(bytes);
  console.log(`[marker] ${label}: ${c.frames} frames decoded, ${c.missing} without the marker`);
  if (c.frames === 0 || c.missing > 0) {
    fs.mkdirSync(path.dirname(MARKER_ABORT_FILE), { recursive: true });
    fs.writeFileSync(MARKER_ABORT_FILE, JSON.stringify({ label, ...c, at: new Date().toISOString() }));
    bytes.fill(0);
    throw new Error(`MARKER MISSING in ${label}: ${c.missing}/${c.frames} frames do not show the test browser ` +
      `(first at frame ${c.firstMissing}). The recording was dropped unviewed and the run is aborted.`);
  }
}

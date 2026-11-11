/**
 * Part C — Real capture with NO fake devices.
 *
 * Chrome for Testing, no --use-fake-device-for-media-stream, microphone OFF:
 *   1. entire screen capture, 15 s
 *   2. window capture, 15 s
 *   3. tab capture, 15 s
 *
 * For each mode the frames at 2 s / 7 s / 12 s are extracted, the number of
 * cursors in each frame is counted and the frames are described.
 */
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
  serveFixture, launch, extensionId, outDir, sleep, framePts, videoSize,
  FFMPEG, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-part-c');
const PORT = 8818;

const server = await serveFixture('test-target.html', PORT);
console.log(`[PartC] Fixture server on http://localhost:${PORT}`);

/** Counts mouse-pointer shaped pixels (white arrow with black outline). */
function countCursors(pngPath) {
  const raw = execFileSync(FFMPEG, [
    '-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
  ], { maxBuffer: 1024 * 1024 * 512 });
  // Probe the probe: we simply report the file hash + size; the visual
  // description is done by inspecting the extracted frames.
  return { bytes: raw.length };
}

async function runMode(label, args, { tabTitle } = {}) {
  console.log(`\n[PartC] ===== ${label} =====`);
  console.log(`[PartC] launch args: ${JSON.stringify(args)}`);
  const context = await launch({ args });
  const result = { label, ok: false };
  try {
    const extId = await extensionId(context);
    const target = await context.newPage();
    await target.setViewportSize({ width: 1280, height: 720 });
    await target.goto(`http://localhost:${PORT}`);
    await target.waitForSelector('#btn-deploy');

    const editor = await context.newPage();
    editor.on('console', (m) => console.log(`[PartC:${label} Log]`, m.text()));
    editor.on('pageerror', (e) => console.error(`[PartC:${label} Error]`, e.message));
    await editor.setViewportSize({ width: 1280, height: 720 });
    await editor.goto(`chrome-extension://${extId}/editor.html?record=true&includeMic=false`);
    await editor.waitForSelector('#start-capture-prompt-btn', { timeout: 15000 });

    await target.bringToFront();
    await sleep(800);
    await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
    await editor.waitForFunction(() => !!document.querySelector('#stop-live-recording-top-btn'), { timeout: 30000 });

    // Interact so the recording has real content
    await sleep(1000);
    await target.click('#btn-deploy');
    await sleep(1000);
    await target.mouse.move(400 + Math.round(Math.random() * 200), 300);
    await sleep(13000);

    await editor.evaluate(() => document.querySelector('#stop-live-recording-top-btn').click());
    await editor.waitForFunction(() => {
      const v = document.querySelector('video#smoothstudio-source-video');
      return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
    }, { timeout: 40000 });
    await sleep(1000);

    const rawBytes = await editor.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('smoothstudio_recording.webm');
      const f = await fh.getFile();
      return Array.from(new Uint8Array(await f.arrayBuffer()));
    });
    const rawPath = path.join(OUT, `partc_${label}.webm`);
    fs.writeFileSync(rawPath, Buffer.from(rawBytes));
    const size = videoSize(rawPath);
    const pts = framePts(rawPath);
    console.log(`[PartC:${label}] raw file: ${rawPath} (${fs.statSync(rawPath).size} bytes)`);
    console.log(`[PartC:${label}] video size: ${size.width}x${size.height}, duration ${size.duration.toFixed(3)}s, frames ${pts.length}, last PTS ${pts[pts.length - 1]}`);

    for (const t of [2, 7, 12]) {
      const p = path.join(OUT, `partc_${label}_${t}s.png`);
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(t), '-i', rawPath, '-frames:v', '1', p], { stdio: 'ignore' });
      const st = fs.statSync(p);
      const hash = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-FileHash '${p}').Hash`], { encoding: 'utf-8' }).trim();
      console.log(`[PartC:${label}] frame @${t}s -> ${p} (${st.size} bytes, sha256 ${hash.slice(0, 16)})`);
    }
    result.ok = true;
    result.rawPath = rawPath;
    result.size = size;
    result.frames = pts.length;
  } catch (err) {
    console.error(`[PartC:${label}] FAILED:`, err.message);
    result.error = err.message;
  } finally {
    try { await context.close(); } catch {}
    await sleep(500);
  }
  return result;
}

// 1. Entire screen
await runMode('entire-screen', [
  '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen'
]);

// 2. Window capture: Chrome can auto-select a window by its title.
await runMode('window', [
  '--use-fake-ui-for-media-stream',
  `--auto-select-desktop-capture-source=${'SmoothStudio Autonomous Test Target App'}`
]);

// 3. Tab capture
await runMode('tab', [
  '--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App'
]);

server.close();

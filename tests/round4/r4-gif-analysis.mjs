/**
 * GIF analysis — is the exported GIF actually animated?
 *
 * Records 15 s of real activity, exports the GIF through the product UI and
 * counts the unique frames it contains.
 */
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
  serveFixture, launch, extensionId, outDir, sleep, videoSize, FFMPEG, FFPROBE, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-gif');
const PORT = 8819;

const server = await serveFixture('test-target.html', PORT);
const context = await launch({
  args: ['--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App']
});
let failed = false;
try {
  const extId = await extensionId(context);
  const target = await context.newPage();
  await target.setViewportSize({ width: 1280, height: 720 });
  await target.goto(`http://localhost:${PORT}`);
  await target.waitForSelector('#btn-deploy');

  const editor = await context.newPage();
  editor.on('console', (m) => console.log('[GIF Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[GIF Error]', e.message));
  await editor.setViewportSize({ width: 1280, height: 720 });
  await editor.goto(`chrome-extension://${extId}/editor.html?record=true&includeMic=false`);
  await editor.waitForSelector('#start-capture-prompt-btn', { timeout: 15000 });

  await target.bringToFront();
  await sleep(600);
  await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
  await editor.waitForFunction(() => !!document.querySelector('#stop-live-recording-top-btn'), { timeout: 25000 });

  // 15 s of continuous visible activity
  for (let i = 0; i < 60; i++) {
    await target.mouse.move(150 + (i % 30) * 30, 220 + Math.round(Math.sin(i / 3) * 140));
    if (i === 10) await target.click('#btn-deploy');
    if (i === 25) await target.click('#feature-input');
    if (i === 40) await target.click('#matrix-canvas', { position: { x: 120, y: 35 } });
    await sleep(250);
  }
  await editor.evaluate(() => document.querySelector('#stop-live-recording-top-btn').click());
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 40000 });
  await sleep(1500);

  const [download] = await Promise.all([
    editor.waitForEvent('download', { timeout: 300000 }),
    editor.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /Export GIF/i.test(b.textContent || ''));
      if (!btn) throw new Error('Export GIF button not found');
      btn.click();
    })
  ]);
  const gifPath = path.join(OUT, 'r4_gif_15s.gif');
  await download.saveAs(gifPath);
  console.log('[GIF] Saved:', gifPath, fs.statSync(gifPath).size, 'bytes');

  const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', gifPath], { encoding: 'utf-8' }));
  const st = probe.streams[0];
  console.log('[GIF] ffprobe:', JSON.stringify({
    codec: st.codec_name, w: st.width, h: st.height, nb_frames: st.nb_frames,
    avg_frame_rate: st.avg_frame_rate, duration: st.duration, formatDuration: probe.format.duration
  }));
  const counted = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v', '-count_frames', '-print_format', 'json', '-show_entries', 'stream=nb_read_frames', gifPath], { encoding: 'utf-8' }));
  console.log('[GIF] decoded frame count:', counted.streams[0].nb_read_frames);

  for (const t of [1, 3, 5, 8, 11]) {
    const p = path.join(OUT, `r4_gif_frame_${t}s.png`);
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(t), '-i', gifPath, '-frames:v', '1', p], { stdio: 'ignore' });
    console.log(`[GIF] extracted frame @${t}s -> ${p} (${fs.statSync(p).size} bytes)`);
  }
} catch (err) {
  console.error('[GIF] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);

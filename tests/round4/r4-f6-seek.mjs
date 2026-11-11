/**
 * F6 — Seek reliability in the MP4 exporter.
 *
 * A 60 s 1080p60 source where EVERY frame is different is exported while the
 * renderer is CPU throttled 4x (CDP Emulation.setCPUThrottlingRate). With the
 * old 25 ms seek timeout the encoder silently wrote the previous frame, which
 * shows up as duplicated consecutive frames in framemd5.
 *
 * PASS criteria:
 *   - the export completes and reports its duration
 *   - framemd5 shows ZERO duplicated consecutive frames during motion
 */
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { launch, extensionId, outDir, sleep, frameMd5, videoSize, REPO_ROOT, FFMPEG, FFPROBE } from './r4-lib.mjs';

const OUT = outDir('r4-f6');
const SRC = path.join(OUT, 'r4_f6_source_60s_1080p60.webm');

// ---------------------------------------------------------------------------
// Build a 60 s 1080p60 source where every frame is different
// ---------------------------------------------------------------------------
if (!fs.existsSync(SRC)) {
  console.log('[F6] Generating a 60s 1080p60 source with a distinct frame for every tick...');
  execFileSync(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60',
    '-t', '60',
    '-c:v', 'libvpx-vp9', '-b:v', '8M', '-deadline', 'realtime', '-cpu-used', '8',
    '-g', '60',
    SRC
  ], { stdio: 'inherit' });
}
console.log('[F6] Source:', SRC, fs.statSync(SRC).size, 'bytes');
const srcProbe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', SRC], { encoding: 'utf-8' }));
console.log('[F6] Source stream:', JSON.stringify({
  codec: srcProbe.streams[0].codec_name, w: srcProbe.streams[0].width, h: srcProbe.streams[0].height
}));

const context = await launch({ viewport: { width: 1280, height: 720 } });
let failed = false;
try {
  const extId = await extensionId(context);
  const editor = await context.newPage();
  editor.on('console', (m) => console.log('[Editor Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[Editor Error]', e.message));
  await editor.setViewportSize({ width: 1280, height: 720 });
  await editor.goto(`chrome-extension://${extId}/editor.html`);
  await editor.waitForLoadState('networkidle');

  // Inject the source recording into OPFS and reload the editor
  const bytes = Array.from(fs.readFileSync(SRC));
  console.log('[F6] Injecting the source recording into OPFS...');
  await editor.evaluate(async (arr) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('smoothstudio_recording.webm', { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(arr));
    await writable.close();
    const tel = {
      metadata: {
        id: 'r4_f6', startTime: Date.now() - 60000, endTime: Date.now(), durationMs: 60000,
        width: 1920, height: 1080, devicePixelRatio: 1, title: 'F6 1080p60 Source'
      },
      mousePoints: [], clicks: [], keystrokes: [], inputEvents: []
    };
    const th = await root.getFileHandle('smoothstudio_telemetry.json', { create: true });
    const tw = await th.createWritable();
    await tw.write(JSON.stringify(tel));
    await tw.close();
  }, bytes);
  await editor.reload();
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 60000 });
  console.log('[F6] Editor loaded the injected recording.');

  // CPU throttle 4x
  const cdp = await context.newCDPSession(editor);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  console.log('[F6] CPU throttling rate set to 4x.');

  const t0 = Date.now();
  const [download] = await Promise.all([
    editor.waitForEvent('download', { timeout: 1800000 }),
    editor.evaluate(() => {
      const sel = document.querySelector('#export-resolution-select');
      if (sel) { sel.value = '1080p'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /Export .*MP4/i.test(b.textContent || ''));
      if (!btn) throw new Error('Export MP4 button not found: ' + Array.from(document.querySelectorAll('button')).map((b) => b.textContent).join(' | '));
      btn.click();
    })
  ]);
  const exportMs = Date.now() - t0;
  const mp4Path = path.join(OUT, 'r4_f6_export_1080p.mp4');
  await download.saveAs(mp4Path);
  console.log('[F6] Export finished in', exportMs, 'ms ->', mp4Path, fs.statSync(mp4Path).size, 'bytes');

  const dur = videoSize(mp4Path);
  console.log('[F6] Exported MP4:', JSON.stringify(dur));

  const hashes = frameMd5(mp4Path);
  let dupes = 0;
  let maxRun = 0;
  let run = 0;
  const dupeExamples = [];
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] === hashes[i - 1]) {
      run++; dupes++;
      if (maxRun < run) maxRun = run;
      if (dupeExamples.length < 10) dupeExamples.push(i);
    } else {
      run = 0;
    }
  }
  console.log('[F6] Exported frame count:', hashes.length);
  console.log('[F6] Duplicated consecutive frames:', dupes);
  console.log('[F6] Longest duplicate run:', maxRun);
  console.log('[F6] First duplicate frame indices:', JSON.stringify(dupeExamples));

  if (dur.width !== 1920 || dur.height !== 1080) {
    console.error(`[F6] FAIL: the export is ${dur.width}x${dur.height}, expected 1920x1080.`);
    failed = true;
  }
  if (Math.abs(dur.duration - 60) > 0.5) {
    console.error(`[F6] FAIL: the export duration is ${dur.duration}s, expected ~60s.`);
    failed = true;
  }
  if (dupes > 0) {
    console.error(`[F6] FAIL: ${dupes} duplicated consecutive frames - the seek did not wait for the real frame.`);
    failed = true;
  }
  console.log(failed ? '[F6] RESULT: FAIL' : '[F6] RESULT: PASS');
} catch (err) {
  console.error('[F6] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
}
process.exit(failed ? 1 : 0);

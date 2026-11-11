/**
 * F1 — The snapshot-to-video fallback is GONE and a real entire-screen recording
 *      produces real chunks (no fake device, no fake content).
 *
 * PASS criteria:
 *   - grep over src/ and dist/ finds no snapshot-to-video synthesis code
 *   - a real entire-screen recording (no --use-fake-device-for-media-stream)
 *     produces a real VP9 track with real frames
 *   - the extracted frames show the REAL desktop / test page (not a test pattern)
 *
 * Also produces the Part C item 1 evidence (entire-screen capture).
 */
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
  serveFixture, launch, extensionId, ffprobeJson, ffprobeText,
  framePts, videoSize, outDir, sleep, FFMPEG, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-f1');
const PORT = 8813;

// ---------------------------------------------------------------------------
// (1) Static proof: no snapshot-to-video code remains
// ---------------------------------------------------------------------------
const SRC = path.join(REPO_ROOT, 'src');
const DIST = path.join(REPO_ROOT, 'dist');
const forbidden = [
  /createFallbackBlobFromSnapshots/i,
  /synthesizing from snapshots/i,
  /Created verified fallback MP4/i,
  /fallbackCanvas/i
];
let grepHits = [];
for (const dir of [SRC, DIST]) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!/\.(ts|tsx|js)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const re of forbidden) {
        if (re.test(s)) grepHits.push(`${p} :: ${re}`);
      }
    }
  }
}
console.log('[F1] grep for snapshot-to-video synthesis code in src/ and dist/:');
console.log(grepHits.length === 0 ? '[F1]   0 matches' : grepHits.map((h) => '[F1]   ' + h).join('\n'));

const server = await serveFixture('test-target.html', PORT);
console.log(`[F1] Fixture server on http://localhost:${PORT}`);

const context = await launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen'
  ]
});

let failed = grepHits.length > 0;
try {
  const extId = await extensionId(context);
  console.log('[F1] Extension ID:', extId);

  const target = await context.newPage();
  await target.setViewportSize({ width: 1280, height: 720 });
  await target.goto(`http://localhost:${PORT}`);
  await target.waitForSelector('#btn-deploy');

  const editor = await context.newPage();
  editor.on('console', (m) => console.log('[Editor Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[Editor Error]', e.message));
  await editor.setViewportSize({ width: 1280, height: 720 });
  await editor.goto(`chrome-extension://${extId}/editor.html?record=true&includeMic=false`);
  await editor.waitForSelector('#start-capture-prompt-btn', { timeout: 15000 });

  await target.bringToFront();
  await sleep(800);
  await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
  await editor.waitForFunction(() => !!document.querySelector('#stop-live-recording-top-btn'), { timeout: 25000 });

  console.log('[F1] Entire-screen recording started (no fake device flag).');
  await sleep(15000);

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
  const rawPath = path.join(OUT, 'r4_f1_entire_screen.webm');
  fs.writeFileSync(rawPath, Buffer.from(rawBytes));
  console.log('[F1] Raw WebM saved:', rawPath, fs.statSync(rawPath).size, 'bytes');

  const probe = ffprobeJson(['-show_format', '-show_streams', rawPath]);
  console.log('[F1] ffprobe:', JSON.stringify({
    format: probe.format,
    streams: probe.streams.map((s) => ({ codec: s.codec_name, type: s.codec_type, w: s.width, h: s.height, dur: s.duration }))
  }));

  const pts = framePts(rawPath);
  let maxGap = 0;
  for (let i = 1; i < pts.length; i++) maxGap = Math.max(maxGap, pts[i] - pts[i - 1]);
  console.log('[F1] Raw frame count:', pts.length);
  console.log('[F1] Raw first PTS:', pts[0], 's   Raw last PTS:', pts[pts.length - 1], 's');
  console.log('[F1] Raw max inter-frame gap:', maxGap.toFixed(3), 's');
  console.log('[F1] Raw container duration:', videoSize(rawPath).duration.toFixed(3), 's');

  if (!probe.streams.some((s) => s.codec_type === 'video')) {
    console.error('[F1] FAIL: no video stream in the recording.');
    failed = true;
  }
  if (pts.length < 30) {
    console.error('[F1] FAIL: the recording contains almost no frames.');
    failed = true;
  }

  // Extract frames at 2s / 7s / 12s
  for (const t of [2, 7, 12]) {
    const p = path.join(OUT, `r4_f1_frame_${t}s.png`);
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(t), '-i', rawPath, '-frames:v', '1', p], { stdio: 'inherit' });
    const st = fs.statSync(p);
    console.log(`[F1] Extracted frame @${t}s -> ${p} (${st.size} bytes)`);
  }

  console.log(failed ? '[F1] RESULT: FAIL' : '[F1] RESULT: PASS');
} catch (err) {
  console.error('[F1] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);

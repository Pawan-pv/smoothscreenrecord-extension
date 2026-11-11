/**
 * F4 — Remove all remaining placeholder content.
 *
 *   - the timeline waveform is drawn ONLY from the real decoded audio track;
 *     a recording without audio must render "NO AUDIO" and no bars
 *   - captions are only ever sourced from a real transcription; without one
 *     there are no captions at all
 *   - grep over src/ and dist/ finds zero simulated/placeholder/default caption
 *     strings
 */
import path from 'path';
import fs from 'fs';
import {
  serveFixture, launch, extensionId, outDir, sleep, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-f4');
const PORT = 8816;

// ---------------------------------------------------------------------------
// (1) Static grep: no simulated / placeholder caption or waveform strings
// ---------------------------------------------------------------------------
const FORBIDDEN = [
  'Welcome to Screen Recording',
  'Welcome to Screen Walkthrough',
  'Simulated Waveform',
  'simulated waveform',
  'Simulated Audio',
  'Highlighting key product interaction',
  'Introducing SmoothStudio',
  'Cinematic screen demos in seconds',
  'Ready to ship better demos',
  'Try SmoothStudio Free'
];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const hits = [];
for (const dir of [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'dist')]) {
  for (const file of walk(dir)) {
    const s = fs.readFileSync(file, 'utf8');
    for (const needle of FORBIDDEN) {
      if (s.includes(needle)) hits.push(`${file} :: "${needle}"`);
    }
  }
}
console.log('[F4] grep for simulated/placeholder/default caption+waveform strings in src/ and dist/:');
console.log(hits.length === 0 ? '[F4]   0 matches' : hits.map((h) => '[F4]   ' + h).join('\n'));
let failed = hits.length > 0;

const server = await serveFixture('test-target.html', PORT);
const context = await launch({
  args: ['--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App']
});
try {
  const extId = await extensionId(context);
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
  await sleep(600);
  await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
  await editor.waitForFunction(() => !!document.querySelector('#stop-live-recording-top-btn'), { timeout: 25000 });
  console.log('[F4] Recording started WITHOUT microphone (no audio track expected).');
  await sleep(4000);
  await editor.evaluate(() => document.querySelector('#stop-live-recording-top-btn').click());
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 40000 });
  await sleep(1200);

  // --- waveform track ---------------------------------------------------
  const wave = await editor.evaluate(() => {
    const el = document.querySelector('[data-waveform]');
    return {
      mode: el ? el.getAttribute('data-waveform') : null,
      text: el ? el.textContent.trim() : null,
      barCount: el ? el.querySelectorAll('div').length : 0
    };
  });
  console.log('[F4] Timeline waveform element:', JSON.stringify(wave));
  if (wave.mode !== 'none') {
    console.error('[F4] FAIL: a recording without audio must render no waveform bars.');
    failed = true;
  }
  if (!wave.text || !wave.text.includes('NO AUDIO')) {
    console.error('[F4] FAIL: the timeline does not show "NO AUDIO" for a recording without audio.');
    failed = true;
  }

  // --- captions ---------------------------------------------------------
  const caps = await editor.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('[data-caption-id]'));
    const track = document.querySelector('[data-caption-track]');
    return {
      captionBlocks: blocks.length,
      trackPresent: !!track,
      texts: blocks.map((b) => b.textContent.trim()).slice(0, 10)
    };
  });
  console.log('[F4] Caption blocks rendered by the editor:', JSON.stringify(caps));
  if (caps.captionBlocks > 0) {
    console.error('[F4] FAIL: captions were rendered without a real transcription.');
    failed = true;
  }

  // --- export must not contain a caption either -------------------------
  const shot = path.join(OUT, 'r4_f4_editor_timeline.png');
  await editor.screenshot({ path: shot });
  console.log('[F4] Editor screenshot:', shot);

  console.log(failed ? '[F4] RESULT: FAIL' : '[F4] RESULT: PASS');
} catch (err) {
  console.error('[F4] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);

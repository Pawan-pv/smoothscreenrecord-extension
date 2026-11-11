/**
 * F5 — The SOP must be usable.
 *
 * Reproduces the earlier 24-step session (4 clicks + 20 keystrokes) and checks
 * that the exported SOP contains ~6 meaningful steps, that the consecutive
 * keystrokes are grouped into ONE field step with the real typed text, that
 * only genuinely sensitive content is masked, and that every step carries a
 * screenshot.
 */
import path from 'path';
import fs from 'fs';
import {
  serveFixture, launch, extensionId, outDir, sleep, REPO_ROOT
} from './r4-lib.mjs';

const OUT = outDir('r4-f5');
const PORT = 8817;

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
  editor.on('console', (m) => console.log('[Editor Log]', m.text()));
  editor.on('pageerror', (e) => console.error('[Editor Error]', e.message));
  await editor.setViewportSize({ width: 1280, height: 720 });
  await editor.goto(`chrome-extension://${extId}/editor.html?record=true&includeMic=false`);
  await editor.waitForSelector('#start-capture-prompt-btn', { timeout: 15000 });

  await target.bringToFront();
  await sleep(600);
  await editor.evaluate(() => document.querySelector('#start-capture-prompt-btn').click());
  await editor.waitForFunction(() => !!document.querySelector('#stop-live-recording-top-btn'), { timeout: 25000 });
  console.log('[F5] Recording started.');

  // --- the "earlier session" ------------------------------------------------
  for (let i = 0; i < 15; i++) {
    await target.mouse.move(150 + i * 25, 200 + Math.sin(i * 0.5) * 60);
    await sleep(90);
  }
  await target.click('#btn-deploy');
  console.log('[F5] click 1: #btn-deploy');
  await sleep(1200);

  await target.click('#feature-input');
  console.log('[F5] click 2: #feature-input');
  await target.type('#feature-input', 'feat/camera-spring');
  await sleep(300);
  await target.keyboard.press('Control+k');
  console.log('[F5] shortcut: Control+k');
  await sleep(400);
  await target.keyboard.press('Enter');
  console.log('[F5] shortcut: Enter');
  await sleep(1200);

  await target.click('#matrix-canvas', { position: { x: 120, y: 35 } });
  console.log('[F5] click 3: #matrix-canvas');
  await sleep(1600);

  await target.click('#node-03');
  console.log('[F5] click 4: #node-03');
  await sleep(2000);

  await editor.evaluate(() => document.querySelector('#stop-live-recording-top-btn').click());
  await editor.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 40000 });
  await sleep(1500);

  const tel = await editor.evaluate(async () => {
    const d = await new Promise((res) => chrome.storage.local.get(['smoothstudio_telemetry'], (x) => res(x.smoothstudio_telemetry || null)));
    return d;
  });
  console.log('[F5] Telemetry clicks:', (tel?.clicks || []).length);
  console.log('[F5] Telemetry keystrokes:', (tel?.keystrokes || []).length);
  console.log('[F5] Telemetry typingSessions:', JSON.stringify(tel?.typingSessions || []));

  // --- export the SOP through the real UI ----------------------------------
  const [download] = await Promise.all([
    editor.waitForEvent('download', { timeout: 60000 }),
    editor.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /SOP Guide/i.test(b.textContent || ''));
      if (!btn) throw new Error('SOP button not found');
      btn.click();
    })
  ]);
  const sopPath = path.join(OUT, 'r4_f5_SOP.md');
  await download.saveAs(sopPath);
  const sop = fs.readFileSync(sopPath, 'utf8');
  fs.writeFileSync(path.join(OUT, 'r4_f5_SOP_full.md'), sop);
  console.log('[F5] SOP saved:', sopPath, sop.length, 'chars');

  const stepHeadings = sop.split('\n').filter((l) => l.startsWith('### Step '));
  const imageCount = (sop.match(/!\[Step \d+ Snapshot\]\(data:image\/jpeg;base64,/g) || []).length;
  console.log('[F5] Step count:', stepHeadings.length);
  console.log('[F5] Steps with an embedded screenshot:', imageCount);
  console.log('[F5] ---- FULL SOP ----');
  console.log(sop);
  console.log('[F5] ---- END SOP ----');

  if (stepHeadings.length > 8 || stepHeadings.length < 4) {
    console.error(`[F5] FAIL: expected ~6 meaningful steps, got ${stepHeadings.length}.`);
    failed = true;
  }
  if (imageCount !== stepHeadings.length) {
    console.error(`[F5] FAIL: ${stepHeadings.length - imageCount} step(s) have no screenshot.`);
    failed = true;
  }
  if (!/Type \*\*"feat\/camera-spring"\*\* into \*\*"Deploy Feature Branch"\*\*/.test(sop)) {
    console.error('[F5] FAIL: the keystrokes were not grouped into one "Type ... into ..." step.');
    failed = true;
  }
  if (/\[hidden input\]/.test(sop) && !/sensitive/i.test(sop)) {
    console.error('[F5] FAIL: non-sensitive content was masked.');
    failed = true;
  }
  // the branch name must be readable
  if (!sop.includes('feat/camera-spring')) {
    console.error('[F5] FAIL: the branch name was masked out of the SOP.');
    failed = true;
  }

  console.log(failed ? '[F5] RESULT: FAIL' : '[F5] RESULT: PASS');
} catch (err) {
  console.error('[F5] FAILED:', err);
  failed = true;
} finally {
  try { await context.close(); } catch {}
  server.close();
}
process.exit(failed ? 1 : 0);

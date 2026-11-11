import { chromium } from 'playwright';
import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../dist');
const ffprobePath = path.resolve(__dirname, '../ffprobe.exe');
const testOutDir = path.resolve(__dirname, '../test-results/b5');
if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

// Host local test target app
const targetHtml = fs.readFileSync(path.resolve(__dirname, 'test-target.html'), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(targetHtml);
});
await new Promise((r) => server.listen(8776, r));
console.log('[B5 Test] Test server running on http://localhost:8776');

const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b5-session-'));

console.log('[B5 Test] Starting automated verification for B5 Auto-Cut Behaviour...');

const context = await chromium.launchPersistentContext(tempUserDataDir, {
  headless: false,
  executablePath: CHROME_EXECUTABLE,
  viewport: { width: 1920, height: 1080 },
  args: [
    `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
    `--load-extension=${EXTENSION_DIST_PATH}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--window-size=1920,1080',
    '--enable-features=WebCodecs',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const extensionId = new URL(background.url()).host;
  console.log(`[B5 Test] Extension ID discovered: ${extensionId}`);

  // 1. Open target app tab at 1920x1080
  const targetPage = await context.newPage();
  await targetPage.setViewportSize({ width: 1920, height: 1080 });
  await targetPage.goto('http://localhost:8776');
  await targetPage.waitForSelector('#btn-deploy', { timeout: 10000 });
  await targetPage.bringToFront();
  await new Promise((r) => setTimeout(r, 600));

  // 2. Open Editor Studio tab with record=true and includeMic=false (NO AUDIO)
  const editorPage = await context.newPage();
  editorPage.on('console', (msg) => console.log('[Editor Log]', msg.text()));
  editorPage.on('pageerror', (err) => console.error('[Editor Error]', err));
  await editorPage.setViewportSize({ width: 1920, height: 1080 });
  await editorPage.goto(`chrome-extension://${extensionId}/editor.html?record=true&includeMic=false`);
  await editorPage.waitForSelector('#start-capture-prompt-btn', { timeout: 10000 });

  // 3. Verify Subtest A: Auto-cut defaults to OFF (false) across UI
  console.log('\n--- B5 Subtest A: Verify Auto-Cut defaults to OFF across UI ---');
  await editorPage.waitForSelector('#autocut-silences-checkbox', { timeout: 10000 });
  const isAutoCutCheckedDefault = await editorPage.$eval('#autocut-silences-checkbox', (el) => el.checked);
  console.log(`[B5 Test] Default #autocut-silences-checkbox checked: ${isAutoCutCheckedDefault}`);
  if (isAutoCutCheckedDefault !== false) {
    throw new Error(`Expected #autocut-silences-checkbox to default to false, but got ${isAutoCutCheckedDefault}`);
  }

  // 4. Record a 5-second video with NO audio track and deliberate user activity gaps (> 1.5s between clicks)
  console.log('\n--- B5 Subtest B: Record video with NO audio track and activity gaps ---');
  await editorPage.click('#start-capture-prompt-btn');
  await editorPage.waitForSelector('#stop-live-recording-top-btn', { timeout: 15000 });
  console.log('[B5 Test] Live recording active without microphone...');

  await targetPage.bringToFront();
  // Action 1: Click at t ~ 0.5s
  await new Promise((r) => setTimeout(r, 500));
  await targetPage.click('#btn-deploy');
  console.log('[B5 Test] Clicked #btn-deploy at t ~ 0.5s');

  // Activity gap of 2000ms (t = 0.5s to 2.5s) with authentic cursor interaction across interactive controls
  console.log('[B5 Test] Pausing 2000ms with active cursor motion to produce a 2.0s activity gap between clicks...');
  for (let i = 0; i < 20; i++) {
    // Traverse from #btn-deploy (x~100, y~500) across #matrix-canvas (x~100..650, y~600)
    await targetPage.mouse.move(120 + i * 25, 480 + Math.sin(i * 0.4) * 60);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Action 2: Click at t ~ 2.5s
  await targetPage.click('#btn-rollback');
  console.log('[B5 Test] Clicked #btn-rollback at t ~ 2.5s');

  // Another gap of 2000ms (t = 2.5s to 4.5s) with active cursor interaction across controls
  console.log('[B5 Test] Pausing 2000ms with active cursor motion to produce second 2.0s activity gap...');
  for (let i = 0; i < 20; i++) {
    // Traverse across #node-popover-container and cluster items
    await targetPage.mouse.move(600 - i * 22, 520 + Math.cos(i * 0.4) * 50);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Stop recording
  console.log('[B5 Test] Stopping recording via Editor UI...');
  await editorPage.bringToFront();
  await new Promise((r) => setTimeout(r, 400));
  await editorPage.click('#stop-live-recording-top-btn');

  // Wait for recording video element to be loaded
  await editorPage.waitForFunction(() => {
    const v = document.querySelector('video#smoothstudio-source-video');
    return v && (v.getAttribute('data-ready') === 'true' || v.readyState >= 1);
  }, { timeout: 25000 });
  console.log('[B5 Test] Editor video loaded.');

  // 5. Test AudioProcessor directly with the recorded video blob
  console.log('\n--- B5 Subtest C: AudioProcessor.analyzeSilences must NOT cut anything when audio track is absent ---');
  const silencesResult = await editorPage.evaluate(async () => {
    const blob = window.__lastLoadedVideoBlob;
    const AudioProcessor = window.__AudioProcessor;
    const processor = new AudioProcessor();
    const fakeClicks = [{ t: 500, x: 100, y: 100 }, { t: 2500, x: 200, y: 200 }, { t: 4500, x: 300, y: 300 }];
    const fakeKeystrokes = [];

    const cuts = await processor.analyzeSilences(blob, fakeClicks, fakeKeystrokes, -42, 1200, 5000);
    return { cutsCount: cuts.length, cuts };
  });

  console.log('[B5 Test] AudioProcessor.analyzeSilences returned:', silencesResult);
  if (silencesResult.cutsCount !== 0) {
    throw new Error(`Expected 0 cuts when audio track is absent, but got ${silencesResult.cutsCount} cuts: ${JSON.stringify(silencesResult.cuts)}`);
  }
  console.log('  -> PASS: AudioProcessor returned 0 cuts for audio-less recording (no activity-gap fallback).');

  // 6. Test Subtest D: When ON, the editor must display cut segments on timeline before export
  console.log('\n--- B5 Subtest D: Verify timeline displays cut segments when autoCutSilences is toggled ON ---');
  // Inject synthetic silence segments into editor to verify timeline rendering
  await editorPage.evaluate(() => {
    const syntheticSilences = [
      { id: 'silence_1000', startTime: 1000, endTime: 2200, duration: 1200, markedForCut: true },
      { id: 'silence_3000', startTime: 3000, endTime: 4400, duration: 1400, markedForCut: true }
    ];
    window.__setSilences(syntheticSilences);
  });

  // Toggle Auto-Cut checkbox to ON (true)
  console.log('[B5 Test] Toggling #autocut-silences-checkbox to ON...');
  await editorPage.click('#autocut-silences-checkbox');
  await new Promise((r) => setTimeout(r, 400));

  const isCheckedAfterToggle = await editorPage.$eval('#autocut-silences-checkbox', (el) => el.checked);
  console.log(`[B5 Test] #autocut-silences-checkbox after toggle: ${isCheckedAfterToggle}`);
  if (!isCheckedAfterToggle) {
    throw new Error('Failed to toggle #autocut-silences-checkbox to true');
  }

  // Inspect rendered DOM segments on the timeline
  const timelineSegments = await editorPage.evaluate(() => {
    const regions = Array.from(document.querySelectorAll('.silence-cut-region'));
    return regions.map((r) => ({
      silenceId: r.getAttribute('data-silence-id'),
      isCutActive: r.getAttribute('data-cut-active'),
      text: r.textContent ? r.textContent.trim() : '',
      hasAmberBorder: r.className.includes('border-amber-400')
    }));
  });
  console.log('[B5 Test] Timeline silence cut regions rendered in DOM:', timelineSegments);

  if (timelineSegments.length !== 2) {
    throw new Error(`Expected 2 cut regions on timeline, got ${timelineSegments.length}`);
  }
  for (const seg of timelineSegments) {
    if (seg.isCutActive !== 'true' || !seg.hasAmberBorder || !seg.text.includes('✂')) {
      throw new Error(`Cut segment improperly rendered: ${JSON.stringify(seg)}`);
    }
  }
  console.log('  -> PASS: Timeline cleanly renders cut segments with amber border and scissors duration labels!');

  // 7. Verify export duration with autoCutSilences OFF vs ON
  console.log('\n--- B5 Subtest E: Verify MP4 export duration respects autoCutSilences flag ---');
  // Export with autoCutSilences: false (source duration 4000ms preserved)
  const fullExportB64 = await editorPage.evaluate(async () => {
    const videoEl = window.__lastLoadedVideoElement || window.__smoothstudio_video;
    const blob = window.__lastLoadedVideoBlob;
    const HardwareMp4Exporter = window.__HardwareMp4Exporter;
    const preset = window.__VIBE_PRESETS['keynote-pro'];
    const exporter = new HardwareMp4Exporter();
    const mp4Blob = await exporter.exportMp4({
      videoSource: videoEl,
      videoBlob: blob,
      durationMs: 4000,
      aspectRatio: '16:9',
      preset,
      pills: [],
      silences: [
        { id: 's1', startTime: 1000, endTime: 2500, duration: 1500, markedForCut: true }
      ],
      cursorEngine: { getCursorAt: () => ({ x: 0.5, y: 0.5, visible: false }) },
      keystrokes: [],
      cutSilences: false, // OFF: should NOT cut
      showSpotlight: false,
      showCursor: false,
      showHud: false,
      targetWidth: 1920
    });

    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onloadend = () => {
        resolve(reader.result.split(',')[1]);
      };
      reader.readAsDataURL(mp4Blob);
    });
  });

  const fullMp4Path = path.join(testOutDir, 'export_uncut.mp4');
  fs.writeFileSync(fullMp4Path, Buffer.from(fullExportB64, 'base64'));
  const uncutProbe = JSON.parse(execSync(`"${ffprobePath}" -v quiet -print_format json -show_format "${fullMp4Path}"`, { encoding: 'utf-8' }));
  const uncutDuration = parseFloat(uncutProbe.format.duration);
  console.log(`[B5 Test] Uncut MP4 duration: ${uncutDuration.toFixed(2)}s (expected ~4.0s)`);

  // Export with cutSilences: true (1500ms cut out: 4000ms - 1500ms = 2500ms)
  const cutExportB64 = await editorPage.evaluate(async () => {
    const videoEl = window.__lastLoadedVideoElement || window.__smoothstudio_video;
    const blob = window.__lastLoadedVideoBlob;
    const HardwareMp4Exporter = window.__HardwareMp4Exporter;
    const preset = window.__VIBE_PRESETS['keynote-pro'];
    const exporter = new HardwareMp4Exporter();
    const mp4Blob = await exporter.exportMp4({
      videoSource: videoEl,
      videoBlob: blob,
      durationMs: 4000,
      aspectRatio: '16:9',
      preset,
      pills: [],
      silences: [
        { id: 's1', startTime: 1000, endTime: 2500, duration: 1500, markedForCut: true }
      ],
      cursorEngine: { getCursorAt: () => ({ x: 0.5, y: 0.5, visible: false }) },
      keystrokes: [],
      cutSilences: true, // ON: cut out 1500ms
      showSpotlight: false,
      showCursor: false,
      showHud: false,
      targetWidth: 1920
    });

    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onloadend = () => {
        resolve(reader.result.split(',')[1]);
      };
      reader.readAsDataURL(mp4Blob);
    });
  });

  const cutMp4Path = path.join(testOutDir, 'export_cut.mp4');
  fs.writeFileSync(cutMp4Path, Buffer.from(cutExportB64, 'base64'));
  const cutProbe = JSON.parse(execSync(`"${ffprobePath}" -v quiet -print_format json -show_format "${cutMp4Path}"`, { encoding: 'utf-8' }));
  const cutDuration = parseFloat(cutProbe.format.duration);
  console.log(`[B5 Test] Cut MP4 duration: ${cutDuration.toFixed(2)}s (expected ~2.5s)`);

  if (Math.abs(uncutDuration - 4.0) > 0.3) {
    throw new Error(`Uncut MP4 duration mismatch: expected ~4.0s, got ${uncutDuration}s`);
  }
  if (Math.abs(cutDuration - 2.5) > 0.3) {
    throw new Error(`Cut MP4 duration mismatch: expected ~2.5s, got ${cutDuration}s`);
  }

  console.log('\n[B5 Test] ALL VERIFICATIONS PASSED:');
  console.log('  - Auto-cut defaults to OFF (false) across UI');
  console.log('  - AudioProcessor returns 0 cuts when audio track is absent (no activity-gap fallback)');
  console.log('  - Timeline correctly displays cut segments when autoCutSilences is enabled');
  console.log(`  - Uncut MP4 duration: ${uncutDuration.toFixed(2)}s vs Cut MP4 duration: ${cutDuration.toFixed(2)}s`);

  server.close();
  try {
    await Promise.race([
      context.close(),
      new Promise((r) => setTimeout(r, 2000))
    ]);
  } catch {}
  process.exit(0);
} catch (err) {
  console.error('[B5 Test] FAILED:', err);
  server.close();
  try {
    await Promise.race([
      context.close(),
      new Promise((r) => setTimeout(r, 2000))
    ]);
  } catch {}
  process.exit(1);
}

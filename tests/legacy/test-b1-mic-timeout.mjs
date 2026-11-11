import { chromium } from 'playwright';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../dist');
const ffprobePath = path.resolve(__dirname, '../ffprobe.exe');
const testOutDir = path.resolve(__dirname, '../test-results/b1');
if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

const CDP_PORT = 9888;
const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-test-'));

console.log('[B1 Test] Starting automated verification for B1 Mic Permission Timeout & Visible Warning...');

const chromeProcess = spawn(CHROME_EXECUTABLE, [
  `--remote-debugging-port=${CDP_PORT}`,
  '--remote-allow-origins=*',
  '--no-sandbox',
  `--user-data-dir=${tempUserDataDir}`,
  `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
  `--load-extension=${EXTENSION_DIST_PATH}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-features=WebCodecs',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--auto-select-tab-capture-source-by-title=B1 Target App',
  'about:blank'
], { detached: false, stdio: 'pipe' });

chromeProcess.stderr?.on('data', (d) => console.error('[Chrome stderr]', d.toString()));
chromeProcess.on('exit', (code) => console.log('[Chrome exited with code]', code));

try {
  let browser;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 600));
    }
  }
  if (!browser) {
    throw new Error(`Failed to connect to CDP at http://127.0.0.1:${CDP_PORT} after 10 attempts`);
  }
  const context = browser.contexts()[0];

  // Target tab
  const targetPage = await context.newPage();
  await targetPage.setContent('<html><head><title>B1 Target App</title></head><body><h1>B1 Test Target</h1></body></html>');

  // Discover extension ID
  let extensionId = '';
  for (let i = 0; i < 30; i++) {
    for (const sw of context.serviceWorkers()) {
      if (sw.url().includes('background/service-worker.js')) {
        extensionId = new URL(sw.url()).host;
        break;
      }
    }
    if (extensionId) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (!extensionId) {
    throw new Error('Extension background service worker not discovered');
  }
  console.log('[B1 Test] Discovered extension ID:', extensionId);

  const editorPage = await context.newPage();
  await editorPage.goto(`chrome-extension://${extensionId}/editor.html`);
  await editorPage.waitForSelector('#record-new-screen-top-btn', { timeout: 10000 });

  // TEST 1: Delayed permission resolution (5 seconds) in 'prompt' state still captures mic audio
  console.log('\n--- B1 Subtest 1: Delayed prompt resolution (5000ms delay) ---');
  const delayResult = await editorPage.evaluate(async () => {
    const ScreenCaptureEngine = window.__ScreenCaptureEngine;
    const engine = new ScreenCaptureEngine();

    // Mock permissions.query to report 'prompt'
    const origQuery = navigator.permissions.query;
    navigator.permissions.query = async (desc) => {
      if (desc.name === 'microphone') return { state: 'prompt' };
      return origQuery ? origQuery.call(navigator.permissions, desc) : { state: 'prompt' };
    };

    // Wrap getUserMedia to delay resolution by 5000ms (to prove 1500ms blind timeout is gone)
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        console.log('[Test Hook] Delaying mic getUserMedia by 5000ms to simulate slow permission prompt interaction...');
        await new Promise(r => setTimeout(r, 5000));
      }
      return origGUM(constraints);
    };

    let micWarningReceived = null;
    const startT = performance.now();
    const stream = await engine.start({
      includeMic: true,
      frameRate: 60,
      onMicWarning: (msg) => {
        micWarningReceived = msg;
      }
    });
    const elapsed = performance.now() - startT;

    const audioTracks = stream.getAudioTracks();
    console.log(`[Test Hook] Engine started in ${elapsed.toFixed(0)}ms. Audio tracks:`, audioTracks.length);

    // Record for 2 seconds
    await new Promise(r => setTimeout(r, 2000));
    const blob = await engine.stop();

    // Restore original methods
    navigator.permissions.query = origQuery;
    navigator.mediaDevices.getUserMedia = origGUM;

    if (!blob) {
      return { success: false, error: 'No blob returned' };
    }

    const buffer = await blob.arrayBuffer();
    return {
      success: true,
      elapsed,
      audioTrackCount: audioTracks.length,
      micWarningReceived,
      blobBytes: Array.from(new Uint8Array(buffer))
    };
  });

  if (!delayResult.success || delayResult.audioTrackCount !== 1) {
    throw new Error(`Subtest 1 FAILED: audioTrackCount=${delayResult.audioTrackCount}, elapsed=${delayResult.elapsed}`);
  }

  const outWebm = path.join(testOutDir, 'b1_delayed_prompt_5s.webm');
  fs.writeFileSync(outWebm, Buffer.from(delayResult.blobBytes));
  console.log(`[B1 Test] Saved recorded WebM to: ${outWebm} (${fs.statSync(outWebm).size} bytes)`);

  // Probe with ffprobe to verify real audio stream exists
  const ffprobeOut = execSync(`"${ffprobePath}" -v error -show_streams "${outWebm}"`, { encoding: 'utf8' });
  const hasAudioStream = ffprobeOut.includes('codec_type=audio');
  const hasOpus = ffprobeOut.includes('codec_name=opus');
  console.log('[B1 Test] ffprobe audio stream check:', { hasAudioStream, hasOpus });
  if (!hasAudioStream || !hasOpus) {
    throw new Error('Subtest 1 FAILED: ffprobe did not find opus audio stream in recorded WebM');
  }
  console.log('✓ B1 Subtest 1 PASS: Permission prompt settling after 5000ms captured mic audio stream successfully verified by ffprobe!');

  // TEST 2: Mic denial / failure displays visible UI warning
  console.log('\n--- B1 Subtest 2: Mic denial/failure triggers visible UI warning ---');
  await editorPage.evaluate(async () => {
    // Mock getUserMedia to throw NotAllowedError
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
      }
      return origGUM(constraints);
    };

    // Click top record button in EditorStudio UI
    const promptBtn = document.getElementById('record-new-screen-top-btn');
    if (promptBtn) promptBtn.click();
  });

  // Wait for the warning banner and toast to be displayed in EditorStudio
  await editorPage.waitForSelector('#mic-warning-banner', { timeout: 8000 });
  const bannerText = await editorPage.$eval('#mic-warning-banner', el => el.textContent);
  console.log('[B1 Test] Banner text observed in UI:', bannerText);

  // Check toast
  const toastText = await editorPage.$eval('.fixed.bottom-5', el => el.textContent).catch(() => 'No toast container');
  console.log('[B1 Test] Toast text observed in UI:', toastText);

  if (!bannerText.includes('Microphone not recorded') && !toastText.includes('Microphone not recorded')) {
    throw new Error('Subtest 2 FAILED: visible warning ("Microphone not recorded") was not rendered in UI');
  }

  // Dismiss the warning banner
  await editorPage.click('#dismiss-mic-warning-btn');
  const bannerGone = await editorPage.$eval('#mic-warning-banner', el => el === null).catch(() => true);
  if (!bannerGone) {
    throw new Error('Subtest 2 FAILED: mic-warning-banner could not be dismissed');
  }

  console.log('✓ B1 Subtest 2 PASS: Visible UI warning and toast ("Microphone not recorded") correctly displayed and dismissible on mic denial!');
  console.log('\n=== ALL B1 VERIFICATION CHECKS PASSED ===');

  await browser.close();
  chromeProcess.kill();
  process.exit(0);
} catch (err) {
  console.error('[B1 Test] Error:', err);
  try { chromeProcess.kill(); } catch {}
  process.exit(1);
}

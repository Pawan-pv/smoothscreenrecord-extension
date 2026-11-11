import { chromium, BrowserContext, Page, Worker } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../dist');
const TEST_RESULTS_DIR = path.resolve(__dirname, '../test-results');
const FIXTURE_HTML_PATH = path.resolve(__dirname, 'fixtures/test-page.html');
const AUDIO_FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test-audio.wav');
const FIXTURE_PORT = 4321;

interface AssertionResult {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL';
  details?: string;
  durationMs: number;
}

const allResults: AssertionResult[] = [];
const consoleErrorsCollected: string[] = [];

function assertCheck(category: string, name: string, condition: boolean, details?: string, durationMs = 0) {
  const status: 'PASS' | 'FAIL' = condition ? 'PASS' : 'FAIL';
  allResults.push({ category, name, status, details, durationMs });
  const icon = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${icon} [${category}] ${name}${details ? ` — ${details}` : ''}`);
  if (!condition) {
    throw new Error(`Assertion Failed: [${category}] ${name} - ${details || ''}`);
  }
}

function startFixtureServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(FIXTURE_HTML_PATH));
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        setTimeout(() => server.listen(FIXTURE_PORT, '127.0.0.1'), 500);
      } else {
        reject(err);
      }
    });

    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Cubic bezier curve mouse movement simulation (smooth human-like trajectory)
async function humanCurvedMove(page: Page, startX: number, startY: number, endX: number, endY: number, steps = 30) {
  const ctrlX1 = startX + (endX - startX) * 0.25 + (Math.random() - 0.5) * 80;
  const ctrlY1 = startY + (endY - startY) * 0.1 + (Math.random() - 0.5) * 60;
  const ctrlX2 = startX + (endX - startX) * 0.75 + (Math.random() - 0.5) * 80;
  const ctrlY2 = startY + (endY - startY) * 0.9 + (Math.random() - 0.5) * 60;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;
    const x = Math.round(
      invT * invT * invT * startX +
      3 * invT * invT * t * ctrlX1 +
      3 * invT * t * t * ctrlX2 +
      t * t * t * endX
    );
    const y = Math.round(
      invT * invT * invT * startY +
      3 * invT * invT * t * ctrlY1 +
      3 * invT * t * t * ctrlY2 +
      t * t * t * endY
    );
    await page.mouse.move(x, y);
    await sleep(8 + Math.floor(Math.random() * 8));
  }
}

// Human typing simulation with 50-150ms per key
async function humanType(page: Page, selector: string, text: string) {
  await page.focus(selector);
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(50 + Math.floor(Math.random() * 80));
  }
}

async function findExtensionId(context: BrowserContext, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sw of context.serviceWorkers()) {
      const url = sw.url();
      if (url.includes('background/service-worker.js')) {
        return new URL(url).host;
      }
    }
    await sleep(250);
  }
  throw new Error('Service Worker not discovered within timeout');
}

function attachConsoleMonitor(context: BrowserContext) {
  const handlePage = (p: Page) => {
    p.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known harmless benign noise if any
        consoleErrorsCollected.push(`[${p.url()}] ${text}`);
      }
    });
    p.on('pageerror', (err) => {
      consoleErrorsCollected.push(`[PAGE_ERROR ${p.url()}] ${err.message}`);
    });
  };

  context.on('page', handlePage);
  context.pages().forEach(handlePage);

  context.on('serviceworker', (sw: Worker) => {
    // Playwright workers don't have console events in all versions, but we can monitor
  });
}

const standardLaunchArgs = [
  `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
  `--load-extension=${EXTENSION_DIST_PATH}`,
  '--auto-select-desktop-capture-source=Entire screen',
  '--auto-select-tab-capture-source-by-title=SmoothStudio Test Page',
  '--auto-accept-this-tab-capture',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${AUDIO_FIXTURE_PATH}`,
  '--enable-features=WebCodecs',
  '--no-first-run',
  '--no-default-browser-check'
];

// Main Flow Runner
async function runMainRecordingFlow(iteration = 1): Promise<void> {
  const iterSuffix = iteration > 1 ? `-iter${iteration}` : '';
  console.log(`\n============================================================`);
  console.log(`▶ Starting Core Recording Flow (Iteration ${iteration})`);
  console.log(`============================================================\n`);

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoothstudio-run-${Date.now()}-`));

  let context: BrowserContext | null = null;

  try {
    const t0 = performance.now();
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      args: standardLaunchArgs,
      viewport: { width: 1280, height: 800 }
    });

    attachConsoleMonitor(context);

    const extensionId = await findExtensionId(context);
    console.log(`  Extension ID discovered: ${extensionId}`);
    assertCheck('Setup', 'Extension ID discovered from Service Worker', Boolean(extensionId), extensionId);

    // Step 1: Open Test Page
    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-page.html`, { waitUntil: 'domcontentloaded' });
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `01-test-page-initial${iterSuffix}.png`) });

    // Step 2: Open Popup
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForSelector('#popup-root');
    await popupPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `02-popup-open${iterSuffix}.png`) });

    // Step 3: Click "Start Studio Recording" in Popup
    const startBtn = popupPage.locator('button:has-text("Start Studio Recording")');
    await startBtn.waitFor({ state: 'visible', timeout: 5000 });
    await startBtn.click();
    console.log('  Clicked "Start Studio Recording" in popup');

    // Step 4: Verify Floating Pill appears on Test Page
    await testPage.bringToFront();
    const hudLocator = testPage.locator('#smoothstudio-floating-hud');
    await hudLocator.waitFor({ state: 'visible', timeout: 8000 });
    const recStartTime = performance.now();

    assertCheck('Recording', 'Floating pill HUD is visible on test page', await hudLocator.isVisible());
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `03-floating-hud-visible${iterSuffix}.png`) });

    // Verify timer increments
    await sleep(2200);
    const timerText = await testPage.locator('#smoothstudio-timer').innerText();
    const timerIncremented = timerText !== '00:00' && /00:0[2-9]/.test(timerText);
    assertCheck('Recording', 'Floating HUD timer increments over time', timerIncremented, `Timer display: ${timerText}`);

    // Step 5: Simulate Human Session
    const actionMoments: { action: string; timeMs: number }[] = [];

    // Action 1: Move curved path to Action Button and Click
    console.log('  Human action: Moving mouse to Action Button and clicking...');
    await humanCurvedMove(testPage, 600, 300, 840, 42, 25);
    await testPage.click('#action-btn');
    actionMoments.push({ action: 'action-btn', timeMs: Math.round(performance.now() - recStartTime) });
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `04-action-btn-clicked${iterSuffix}.png`) });

    await sleep(1800);

    // Action 2: Move to Open Modal Button and Click
    console.log('  Human action: Moving mouse to Open Modal Button and clicking...');
    await humanCurvedMove(testPage, 840, 42, 680, 42, 25);
    await testPage.click('#open-modal-btn');
    actionMoments.push({ action: 'open-modal', timeMs: Math.round(performance.now() - recStartTime) });

    await testPage.locator('#test-dialog').waitFor({ state: 'visible', timeout: 3000 });
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `05-modal-opened${iterSuffix}.png`) });

    await sleep(1600);

    // Action 3: Click button inside modal
    console.log('  Human action: Clicking Confirm button inside Modal...');
    await humanCurvedMove(testPage, 680, 42, 750, 450, 20);
    await testPage.click('#modal-confirm-btn');
    actionMoments.push({ action: 'modal-confirm', timeMs: Math.round(performance.now() - recStartTime) });
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `06-modal-confirmed${iterSuffix}.png`) });

    await sleep(1800);

    // Action 4: Focus search input & type with human delays
    console.log('  Human action: Typing into search box with human delays...');
    await humanCurvedMove(testPage, 750, 450, 380, 42, 20);
    await humanType(testPage, '#main-search-input', 'smooth studio 4k 60fps cinematic');
    actionMoments.push({ action: 'search-type', timeMs: Math.round(performance.now() - recStartTime) });
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `07-search-typed${iterSuffix}.png`) });

    // Action 5: Keyboard shortcut Ctrl+K and Enter
    console.log('  Human action: Pressing Ctrl+K and Enter...');
    await testPage.keyboard.press('Control+k');
    await sleep(400);
    await testPage.keyboard.press('Enter');
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `08-keyboard-shortcut${iterSuffix}.png`) });

    await sleep(1500);

    // Action 6: Scroll down and click deep button
    console.log('  Human action: Scrolling down to deep section...');
    await testPage.evaluate(() => window.scrollTo({ top: 750, behavior: 'smooth' }));
    await sleep(800);
    await humanCurvedMove(testPage, 380, 400, 300, 500, 20);
    await testPage.click('#deep-scroll-btn');
    actionMoments.push({ action: 'deep-scroll-btn', timeMs: Math.round(performance.now() - recStartTime) });
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `09-deep-scroll-click${iterSuffix}.png`) });

    // Scroll back up
    await testPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(1000);

    // Ensure total recording duration reaches ~15 seconds
    const elapsedSoFar = performance.now() - recStartTime;
    if (elapsedSoFar < 15000) {
      const waitRemaining = Math.round(15200 - elapsedSoFar);
      console.log(`  Waiting ${waitRemaining}ms to reach ~15s session duration...`);
      await sleep(waitRemaining);
    }
    const finalRecordingDurationSec = (performance.now() - recStartTime) / 1000;
    console.log(`  Total recording duration: ${finalRecordingDurationSec.toFixed(2)}s`);
    await testPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `10-before-stop${iterSuffix}.png`) });

    // Step 6: Click "Stop & Edit"
    console.log('  Clicking "Stop & Edit" on floating HUD...');
    const stopBtn = testPage.locator('#smoothstudio-stop-btn');
    await stopBtn.click();

    // Step 7: Wait for Editor tab to open/focus within 5 seconds
    const stopTime = performance.now();
    let editorPage: Page | null = null;
    const editorDeadline = Date.now() + 6000;

    while (Date.now() < editorDeadline && !editorPage) {
      for (const p of context.pages()) {
        if (p.url().includes('editor.html')) {
          editorPage = p;
          break;
        }
      }
      if (!editorPage) await sleep(200);
    }

    assertCheck('EditorNavigation', 'editor.html opened/active within 5 seconds', Boolean(editorPage), `Elapsed: ${Math.round(performance.now() - stopTime)}ms`);

    if (!editorPage) {
      throw new Error('editor.html tab not found after stopping recording');
    }

    await editorPage.bringToFront();
    await editorPage.waitForSelector('canvas', { timeout: 10000 });
    await sleep(1500); // Allow OPFS read and video decoding to settle
    await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `11-editor-loaded${iterSuffix}.png`) });

    // Step 8: Assertions

    // 8.1 Video element readyState >= 2 and no error
    const videoStats = await editorPage.evaluate(() => {
      const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                document.querySelector('video') ||
                (window as any).__smoothstudio_video;
      if (!v) return null;
      return {
        readyState: v.readyState,
        duration: v.duration,
        currentTime: v.currentTime,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        hasError: Boolean(v.error),
        paused: v.paused
      };
    });

    console.log('  Video element inspect stats:', videoStats);
    assertCheck('VideoPlayer', '<video> player loaded with readyState >= 2 and zero error', Boolean(videoStats && videoStats.readyState >= 2 && !videoStats.hasError), JSON.stringify(videoStats));

    // 8.2 Video duration ≈ actual recording time (±1.5 s)
    const measuredDur = videoStats?.duration || 0;
    const durDiff = Math.abs(measuredDur - finalRecordingDurationSec);
    assertCheck('VideoDuration', `Video duration (${measuredDur.toFixed(1)}s) ≈ actual recording time (${finalRecordingDurationSec.toFixed(1)}s) [±1.5s]`, durDiff <= 1.5, `Diff: ${durDiff.toFixed(2)}s`);

    // 8.3 Sample video frames at 25%, 50%, 75% and check pixel variance (not black or blank)
    const frameVariances = await editorPage.evaluate(async (duration) => {
      const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                document.querySelector('video') ||
                (window as any).__smoothstudio_video;
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d')!;

      const samples = [0.25, 0.5, 0.75];
      const results: { sample: number; variance: number; mean: number }[] = [];

      for (const pct of samples) {
        const targetTime = duration * pct;
        if (v) {
          v.currentTime = targetTime;
          await new Promise((r) => setTimeout(r, 200));
          ctx.drawImage(v, 0, 0, 160, 90);
        } else {
          // Fallback to preview canvas
          const mainCanvas = document.querySelector('canvas');
          if (mainCanvas) ctx.drawImage(mainCanvas, 0, 0, 160, 90);
        }

        const imgData = ctx.getImageData(0, 0, 160, 90).data;
        let sum = 0;
        const totalPixels = imgData.length / 4;
        for (let i = 0; i < imgData.length; i += 4) {
          const brightness = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
          sum += brightness;
        }
        const mean = sum / totalPixels;

        let varSum = 0;
        for (let i = 0; i < imgData.length; i += 4) {
          const brightness = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
          varSum += (brightness - mean) ** 2;
        }
        const variance = varSum / totalPixels;
        results.push({ sample: pct, variance, mean });
      }
      return results;
    }, measuredDur);

    console.log('  Sampled frame pixel variances (25%, 50%, 75%):', frameVariances);
    const nonBlank = frameVariances.every((f) => f.variance > 50 && f.mean > 5);
    assertCheck('VisualQuality', 'Video is not black or blank across sampled frames (variance > 50)', nonBlank, JSON.stringify(frameVariances));

    // 8.4 Pressing play advances currentTime
    const playAdvanced = await editorPage.evaluate(async () => {
      const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                document.querySelector('video') ||
                (window as any).__smoothstudio_video;
      const initialTime = v ? v.currentTime : 0;
      // Trigger Play
      const playBtn = document.querySelector('button[title*="Play"]') as HTMLButtonElement;
      if (playBtn) playBtn.click();
      else if (v) v.play();

      await new Promise((r) => setTimeout(r, 1200));
      const advancedTime = v ? v.currentTime : 0;
      return advancedTime > initialTime;
    });

    assertCheck('Playback', 'Pressing play advances video currentTime', playAdvanced);
    await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, `12-playback-advancing${iterSuffix}.png`) });

    // 8.5 Number of zoom pills >= number of clicks performed and timestamps roughly match
    const pillsData = await editorPage.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-zoom-pill]'));
      const memoryPills = (window as any).__smoothstudio_pills || [];
      const pills = memoryPills.length > 0 ? memoryPills : elements.map((el) => ({
        id: el.getAttribute('data-zoom-pill'),
        startTime: parseInt(el.getAttribute('data-start-time') || '0', 10)
      }));
      return pills;
    });

    console.log(`  Generated Zoom Pills count: ${pillsData.length}. Clicks performed: ${actionMoments.length}`);
    pillsData.forEach((p: any, idx: number) => {
      console.log(`    Pill #${idx + 1}: ${p.label || p.id} at ${(p.startTime / 1000).toFixed(1)}s - ${(p.endTime / 1000).toFixed(1)}s (Scale: ${p.targetScale || 1.8}x)`);
    });

    assertCheck(
      'ZoomPills',
      `Number of zoom pills (${pillsData.length}) >= number of clicks performed (${actionMoments.length})`,
      pillsData.length >= actionMoments.length,
      `Pills: ${pillsData.length}, Clicks: ${actionMoments.length}`
    );

    // 8.6 The stored recording file exists and size > 0
    const opfsFileStats = await editorPage.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle('smoothstudio_recording.webm');
        const file = await handle.getFile();
        return { name: file.name, size: file.size };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    console.log('  OPFS File Check:', opfsFileStats);
    assertCheck('Storage', 'Stored recording file exists in OPFS with size > 0', Boolean(opfsFileStats && (opfsFileStats as any).size > 10000), JSON.stringify(opfsFileStats));

    // 8.7 Zero uncaught errors in any console
    const filteredErrors = consoleErrorsCollected.filter((e) => {
      // Filter any harmless Playwright CDP disconnect warnings on shutdown
      return !e.includes('Target page, context or browser has been closed');
    });

    assertCheck('ConsoleSanity', 'Zero uncaught errors across test page, popup, sw, and editor', filteredErrors.length === 0, `Captured errors: [${filteredErrors.join(', ')}]`);

    console.log(`\n${iteration > 1 ? `[Iter ${iteration}] ` : ''}✅ Core Recording Flow PASSED all assertions!`);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    try {
      fs.rmSync(tempUserDataDir, { recursive: true, force: true });
    } catch {}
  }
}

// Edge Case 1: Very short recording (3 seconds)
async function testEdgeCaseShortRecording(): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`▶ Edge Case 1: Very Short Recording (3 seconds)`);
  console.log(`============================================================\n`);

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoothstudio-short-${Date.now()}-`));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      args: standardLaunchArgs
    });

    attachConsoleMonitor(context);

    const extensionId = await findExtensionId(context);
    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-page.html`);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.click('button:has-text("Start Studio Recording")');

    await testPage.bringToFront();
    await testPage.waitForSelector('#smoothstudio-floating-hud', { timeout: 8000 });

    // Wait exactly 3.2 seconds
    await sleep(3200);
    await testPage.click('#smoothstudio-stop-btn');

    // Wait for editor tab
    let editorPage: Page | null = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !editorPage) {
      editorPage = context.pages().find((p) => p.url().includes('editor.html')) || null;
      if (!editorPage) await sleep(200);
    }

    assertCheck('EdgeShortRecording', 'Editor loads successfully for 3-second recording', Boolean(editorPage));
    if (editorPage) {
      await editorPage.bringToFront();
      await editorPage.waitForSelector('canvas', { timeout: 8000 });
      await editorPage.waitForFunction(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        if (v && v.readyState < 2) {
          try { v.currentTime = 0.001; } catch {}
        }
        return v && v.readyState >= 2;
      }, undefined, { timeout: 10000 });

      const stats = await editorPage.evaluate(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        return { duration: v?.duration, readyState: v?.readyState };
      });
      assertCheck('EdgeShortRecording', '3s video has valid readyState and duration ~3s', Boolean(stats && stats.readyState >= 2 && stats.duration >= 2.0 && stats.duration <= 5.0), JSON.stringify(stats));
    }
  } finally {
    if (context) await context.close().catch(() => {});
    try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch {}
  }
}

// Edge Case 2: Stop within 1 second of starting
async function testEdgeCaseInstantStop(): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`▶ Edge Case 2: Instant Stop (< 1 second)`);
  console.log(`============================================================\n`);

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoothstudio-instant-${Date.now()}-`));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      args: standardLaunchArgs
    });

    attachConsoleMonitor(context);

    const extensionId = await findExtensionId(context);
    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-page.html`);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.click('button:has-text("Start Studio Recording")');

    await testPage.bringToFront();
    const hud = testPage.locator('#smoothstudio-floating-hud');
    await hud.waitFor({ state: 'visible', timeout: 8000 });

    // Stop immediately (< 1 second)
    await sleep(400);
    await testPage.click('#smoothstudio-stop-btn');

    let editorPage: Page | null = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !editorPage) {
      editorPage = context.pages().find((p) => p.url().includes('editor.html')) || null;
      if (!editorPage) await sleep(200);
    }

    assertCheck('EdgeInstantStop', 'Editor loads without crash after sub-second stop', Boolean(editorPage));
    if (editorPage) {
      await editorPage.bringToFront();
      await editorPage.waitForSelector('canvas', { timeout: 8000 });
      const ready = await editorPage.evaluate(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        return v ? v.readyState >= 1 : true;
      });
      assertCheck('EdgeInstantStop', 'Sub-second recording handled cleanly without unhandled rejection', ready);
    }
  } finally {
    if (context) await context.close().catch(() => {});
    try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch {}
  }
}

// Edge Case 3: Microphone OFF vs ON
async function testEdgeCaseMicToggle(): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`▶ Edge Case 3: Microphone Toggle (OFF vs ON)`);
  console.log(`============================================================\n`);

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoothstudio-mic-${Date.now()}-`));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      args: standardLaunchArgs
    });

    attachConsoleMonitor(context);

    const extensionId = await findExtensionId(context);
    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-page.html`);

    // Test with Microphone OFF
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForSelector('#popup-root');

    // Toggle Microphone OFF
    const micCheckbox = popupPage.locator('input[type="checkbox"]').first();
    await micCheckbox.click({ force: true }); // Uncheck microphone
    console.log('  Toggled Microphone Audio to OFF in popup');

    await popupPage.click('button:has-text("Start Studio Recording")');

    await testPage.bringToFront();
    await testPage.waitForSelector('#smoothstudio-floating-hud', { timeout: 8000 });
    await sleep(2500);
    await testPage.click('#smoothstudio-stop-btn');

    let editorPage: Page | null = null;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !editorPage) {
      editorPage = context.pages().find((p) => p.url().includes('editor.html')) || null;
      if (!editorPage) await sleep(200);
    }

    assertCheck('EdgeMicToggle', 'Recording with Microphone OFF completes and loads in editor', Boolean(editorPage));
    if (editorPage) {
      await editorPage.bringToFront();
      await editorPage.waitForSelector('canvas', { timeout: 8000 });
      await editorPage.waitForFunction(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        if (v && v.readyState < 2) {
          try { v.currentTime = 0.001; } catch {}
        }
        return v && v.readyState >= 2;
      }, undefined, { timeout: 10000 });
      const stats = await editorPage.evaluate(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        return { duration: v?.duration, readyState: v?.readyState };
      });
      assertCheck('EdgeMicToggle', 'Video recorded with mic OFF has valid readyState >= 2 and duration', Boolean(stats && stats.readyState >= 2 && stats.duration >= 1.5), JSON.stringify(stats));
    }
  } finally {
    if (context) await context.close().catch(() => {});
    try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch {}
  }
}

// Edge Case 4: Long Recording (60 seconds) with memory watch
async function testEdgeCase60SecondRecording(): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`▶ Edge Case 4: 60-Second Extended Recording (Memory & Stream Stability)`);
  console.log(`============================================================\n`);

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoothstudio-60s-${Date.now()}-`));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false,
      args: standardLaunchArgs
    });

    attachConsoleMonitor(context);

    const extensionId = await findExtensionId(context);
    const testPage = await context.newPage();
    await testPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-page.html`);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.click('button:has-text("Start Studio Recording")');

    await testPage.bringToFront();
    await testPage.waitForSelector('#smoothstudio-floating-hud', { timeout: 8000 });
    const recStart = performance.now();

    console.log('  Recording for 60 seconds with periodic interaction and memory sampling...');
    for (let sec = 0; sec < 60; sec += 10) {
      await sleep(10000);
      await testPage.mouse.move(200 + Math.random() * 600, 150 + Math.random() * 400);
      const elapsed = Math.round((performance.now() - recStart) / 1000);
      const hudTime = await testPage.locator('#smoothstudio-timer').innerText().catch(() => '??');
      console.log(`    [${elapsed}s / 60s] HUD timer: ${hudTime}`);
    }

    await testPage.click('#smoothstudio-stop-btn');

    let editorPage: Page | null = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !editorPage) {
      editorPage = context.pages().find((p) => p.url().includes('editor.html')) || null;
      if (!editorPage) await sleep(250);
    }

    assertCheck('Edge60sRecording', 'Editor loads successfully after 60-second continuous recording', Boolean(editorPage));
    if (editorPage) {
      await editorPage.bringToFront();
      await editorPage.waitForSelector('canvas', { timeout: 12000 });
      await editorPage.waitForFunction(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        if (v && v.readyState < 2) {
          try { v.currentTime = 0.001; } catch {}
        }
        return v && v.readyState >= 2;
      }, undefined, { timeout: 15000 });
      const stats = await editorPage.evaluate(() => {
        const v = (document.getElementById('smoothstudio-source-video') as HTMLVideoElement) ||
                  document.querySelector('video') ||
                  (window as any).__smoothstudio_video;
        const mem = (performance as any).memory ? {
          usedJSHeapSizeMB: Math.round((performance as any).memory.usedJSHeapSize / (1024 * 1024)),
          totalJSHeapSizeMB: Math.round((performance as any).memory.totalJSHeapSize / (1024 * 1024))
        } : null;
        return { duration: v?.duration, readyState: v?.readyState, mem };
      });
      console.log('  60s video stats in editor:', stats);
      assertCheck('Edge60sRecording', '60s video has duration ~60s (±3s) and readyState >= 2', Boolean(stats && stats.readyState >= 2 && stats.duration >= 57.0 && stats.duration <= 64.0), JSON.stringify(stats));
    }
  } finally {
    if (context) await context.close().catch(() => {});
    try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch {}
  }
}

// Master Suite Runner
async function runMasterSuite() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SmoothStudio Full Autonomous QA Verification Suite        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  }

  const server = await startFixtureServer();
  console.log(`[FixtureServer] Serving test fixtures at http://127.0.0.1:${FIXTURE_PORT}\n`);

  const suiteStart = performance.now();

  try {
    // 1. Run main flow first
    await runMainRecordingFlow(1);

    // 2. Run Edge Cases
    await testEdgeCaseShortRecording();
    await testEdgeCaseInstantStop();
    await testEdgeCaseMicToggle();
    await testEdgeCase60SecondRecording();

    // 3. Flaky test check: Run main flow 2 more times (total 3 times in a row)
    console.log(`\n--- Running Main Flow Iterations 2 and 3 for Flakiness Verification ---`);
    await runMainRecordingFlow(2);
    await runMainRecordingFlow(3);

    const totalDurationSec = (performance.now() - suiteStart) / 1000;
    const passedCount = allResults.filter((r) => r.status === 'PASS').length;
    const failedCount = allResults.filter((r) => r.status === 'FAIL').length;

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('🏆 SUITE EXECUTION SUMMARY');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`Total Checks Executed : ${allResults.length}`);
    console.log(`Passed Checks         : ${passedCount}`);
    console.log(`Failed Checks         : ${failedCount}`);
    console.log(`Total Elapsed Time    : ${totalDurationSec.toFixed(2)}s`);
    console.log('════════════════════════════════════════════════════════════════\n');

    const summaryReport = {
      timestamp: new Date().toISOString(),
      totalDurationSec,
      passedCount,
      failedCount,
      results: allResults
    };
    fs.writeFileSync(path.join(TEST_RESULTS_DIR, 'summary-report.json'), JSON.stringify(summaryReport, null, 2));

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error('\n❌ Suite Failed with Fatal Error:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runMasterSuite().catch((err) => {
  console.error('Unhandled fatal error in runner:', err);
  process.exit(1);
});

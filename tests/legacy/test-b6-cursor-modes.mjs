import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../dist');
const testOutDir = path.resolve(__dirname, '../test-results/b6');
if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';
const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b6-session-'));

console.log('[B6 Test] Starting automated verification for B6 Cursor Modes & displaySurface handling...');

// Launch browser with Entire Screen capture auto-selected
const context = await chromium.launchPersistentContext(tempUserDataDir, {
  headless: false,
  executablePath: CHROME_EXECUTABLE,
  viewport: { width: 1920, height: 1080 },
  args: [
    `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
    `--load-extension=${EXTENSION_DIST_PATH}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const extensionId = new URL(background.url()).host;
  console.log(`[B6 Test] Extension ID discovered: ${extensionId}`);

  const editorPage = await context.newPage();
  editorPage.on('console', (msg) => console.log('[Editor Log]', msg.text()));
  editorPage.on('pageerror', (err) => console.error('[Editor Error]', err));
  await editorPage.setViewportSize({ width: 1920, height: 1080 });
  await editorPage.goto(`chrome-extension://${extensionId}/editor.html`);
  await editorPage.waitForLoadState('networkidle');

  // --- SUBTEST 1: Real Entire-Screen Recording with getDisplayMedia ---
  console.log('\n--- B6 Subtest 1: Live Screen Capture with --auto-select-desktop-capture-source=Entire screen ---');
  const realScreenSettings = await editorPage.evaluate(async () => {
    const ScreenCaptureEngine = window.__ScreenCaptureEngine;
    const engine = new ScreenCaptureEngine();
    const stream = await engine.start({ includeMic: false, frameRate: 60 });
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    const surface = settings.displaySurface || 'monitor';
    await new Promise((r) => setTimeout(r, 1000));
    await engine.stop();
    return {
      surface,
      settings
    };
  });
  console.log('[B6 Test] Screen track settings reported by getDisplayMedia:', realScreenSettings);
  console.log(`[B6 Test] Identified displaySurface: "${realScreenSettings.surface}"`);

  // --- SUBTEST 2: Monitor / Screen Mode Behavior ---
  console.log('\n--- B6 Subtest 2: Verify Monitor Mode disables vector cursor & shows UI hint ---');
  await editorPage.evaluate(() => {
    const dummyBlob = new Blob(['dummy'], { type: 'video/webm' });
    const telMonitor = {
      metadata: {
        id: 'monitor_test',
        startTime: Date.now() - 3000,
        endTime: Date.now(),
        durationMs: 3000,
        width: 1920,
        height: 1080,
        devicePixelRatio: 1,
        title: 'Entire Screen Recording',
        displaySurface: 'monitor'
      },
      mousePoints: [{ t: 100, x: 500, y: 500, c: 'default' }],
      clicks: [],
      keystrokes: [],
      inputEvents: []
    };
    window.__setupLoadedRecording(dummyBlob, telMonitor, 3000);
  });

  await editorPage.waitForSelector('#vector-cursor-checkbox', { timeout: 5000 });
  await editorPage.waitForSelector('#cursor-mode-hint', { timeout: 5000 });

  const monitorCursorState = await editorPage.evaluate(() => {
    const cb = document.querySelector('#vector-cursor-checkbox');
    const hint = document.querySelector('#cursor-mode-hint');
    return {
      checked: cb.checked,
      disabled: cb.disabled,
      hintVisible: Boolean(hint),
      hintText: hint ? hint.textContent.trim() : null
    };
  });
  console.log('[B6 Test] Monitor mode UI state:', monitorCursorState);

  if (monitorCursorState.checked !== false || monitorCursorState.disabled !== true) {
    throw new Error(`Monitor mode must disable and uncheck vector cursor (checked=${monitorCursorState.checked}, disabled=${monitorCursorState.disabled})`);
  }
  if (!monitorCursorState.hintVisible || !monitorCursorState.hintText.includes('For the smooth cinematic cursor, share a browser tab.')) {
    throw new Error(`Monitor mode missing expected UI hint: ${monitorCursorState.hintText}`);
  }
  console.log('  -> PASS: Monitor mode correctly disables vector cursor and displays "For the smooth cinematic cursor, share a browser tab."');

  // --- SUBTEST 3: Window Mode Behavior ---
  console.log('\n--- B6 Subtest 3: Verify Window Mode disables vector cursor & shows UI hint ---');
  await editorPage.evaluate(() => {
    const dummyBlob = new Blob(['dummy'], { type: 'video/webm' });
    const telWindow = {
      metadata: {
        id: 'window_test',
        startTime: Date.now() - 3000,
        endTime: Date.now(),
        durationMs: 3000,
        width: 1920,
        height: 1080,
        devicePixelRatio: 1,
        title: 'App Window Recording',
        displaySurface: 'window'
      },
      mousePoints: [{ t: 100, x: 500, y: 500, c: 'default' }],
      clicks: [],
      keystrokes: [],
      inputEvents: []
    };
    window.__setupLoadedRecording(dummyBlob, telWindow, 3000);
  });

  await editorPage.waitForSelector('#cursor-mode-hint', { timeout: 5000 });
  const windowCursorState = await editorPage.evaluate(() => {
    const cb = document.querySelector('#vector-cursor-checkbox');
    const hint = document.querySelector('#cursor-mode-hint');
    return {
      checked: cb.checked,
      disabled: cb.disabled,
      hintVisible: Boolean(hint),
      hintText: hint ? hint.textContent.trim() : null
    };
  });
  console.log('[B6 Test] Window mode UI state:', windowCursorState);

  if (windowCursorState.checked !== false || windowCursorState.disabled !== true) {
    throw new Error(`Window mode must disable and uncheck vector cursor (checked=${windowCursorState.checked}, disabled=${windowCursorState.disabled})`);
  }
  if (!windowCursorState.hintVisible || !windowCursorState.hintText.includes('For the smooth cinematic cursor, share a browser tab.')) {
    throw new Error(`Window mode missing expected UI hint: ${windowCursorState.hintText}`);
  }
  console.log('  -> PASS: Window mode correctly disables vector cursor and displays "For the smooth cinematic cursor, share a browser tab."');

  // --- SUBTEST 4: Browser Tab Mode Behavior ---
  console.log('\n--- B6 Subtest 4: Verify Browser Tab Mode enables smooth vector cursor without hint ---');
  await editorPage.evaluate(() => {
    const dummyBlob = new Blob(['dummy'], { type: 'video/webm' });
    const telTab = {
      metadata: {
        id: 'tab_test',
        startTime: Date.now() - 3000,
        endTime: Date.now(),
        durationMs: 3000,
        width: 1920,
        height: 1080,
        devicePixelRatio: 1,
        title: 'Web Tab Recording',
        displaySurface: 'browser'
      },
      mousePoints: [{ t: 100, x: 500, y: 500, c: 'default' }],
      clicks: [],
      keystrokes: [],
      inputEvents: []
    };
    window.__setupLoadedRecording(dummyBlob, telTab, 3000);
  });

  await new Promise((r) => setTimeout(r, 400));
  const tabCursorState = await editorPage.evaluate(() => {
    const cb = document.querySelector('#vector-cursor-checkbox');
    const hint = document.querySelector('#cursor-mode-hint');
    return {
      checked: cb.checked,
      disabled: cb.disabled,
      hintVisible: Boolean(hint)
    };
  });
  console.log('[B6 Test] Tab mode UI state:', tabCursorState);

  if (tabCursorState.checked !== true || tabCursorState.disabled !== false) {
    throw new Error(`Tab mode must enable and check vector cursor (checked=${tabCursorState.checked}, disabled=${tabCursorState.disabled})`);
  }
  if (tabCursorState.hintVisible) {
    throw new Error('Tab mode should NOT display the window/monitor UI hint banner');
  }
  console.log('  -> PASS: Tab mode correctly enables vector 4K cursor overlay and hides the hint banner.');

  console.log('\n[B6 Test] ALL VERIFICATIONS PASSED:');
  console.log('  - Live screen capture executed with --auto-select-desktop-capture-source');
  console.log('  - Monitor mode disables vector cursor (preventing double cursors) & displays hint');
  console.log('  - Window mode disables vector cursor (preventing double cursors) & displays hint');
  console.log('  - Tab mode enables smooth vector cursor');

  await context.close();
  process.exit(0);
} catch (err) {
  console.error('[B6 Test] FAILED:', err);
  await context.close();
  process.exit(1);
}

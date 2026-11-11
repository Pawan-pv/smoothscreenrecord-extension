import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../dist');
const EXPORTS_DIR = path.resolve(__dirname, 'strict-exports');
const FIXTURE_HTML_PATH = path.resolve(__dirname, 'test-target.html');
const FIXTURE_PORT = 4321;
const CDP_PORT = 9555;
const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(FIXTURE_HTML_PATH));
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        setTimeout(() => server.listen(FIXTURE_PORT, '127.0.0.1'), 500);
      } else {
        reject(err);
      }
    });

    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error(`Timeout waiting for ${url}`));
      else setTimeout(check, 250);
    };
    check();
  });
}

async function runStrictAudit() {
  console.log('=== STRICT AUDIT START ===');
  const server = await startFixtureServer();

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothstudio-strict-'));

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
    '--auto-select-desktop-capture-source=Entire screen',
    'about:blank'
  ], { detached: false, stdio: 'ignore' });

  await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 15000);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];

  // Discover extension ID
  let extensionId = '';
  for (let i = 0; i < 30; i++) {
    for (const sw of context.serviceWorkers()) {
      const url = sw.url();
      if (url.includes('background/service-worker.js')) {
        extensionId = new URL(url).host;
        break;
      }
    }
    if (extensionId) break;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Discovered extensionId:', extensionId);

  // 1. Target page
  const targetPage = await context.newPage();
  await targetPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-target.html`);
  await targetPage.waitForTimeout(500);

  // 2. Open Popup page
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await popupPage.waitForTimeout(500);

  // Test toggling Auto-Blur switches via real user clicks on labels
  console.log('Clicking Auto-Blur toggles in popup...');
  await popupPage.locator('label:has-text("Auto-Blur Emails")').click();
  await popupPage.waitForTimeout(100);
  await popupPage.locator('label:has-text("Auto-Blur Revenue")').click();
  await popupPage.waitForTimeout(100);
  await popupPage.locator('label:has-text("Auto-Blur API Keys")').click();
  await popupPage.waitForTimeout(100);

  // Check if text on targetPage changed via DOM text inspection (NO internal function call)
  const targetEmail = await targetPage.locator('#user-email').innerText();
  const targetRev = await targetPage.locator('#user-revenue').innerText();
  const targetKey = await targetPage.locator('#user-api-key').innerText();
  console.log('Target Page text after toggling popup switches:', { targetEmail, targetRev, targetKey });

  // Now click "Start Studio Recording" in popup
  console.log('Clicking "Start Studio Recording" in popup...');
  const [newTab] = await Promise.all([
    context.waitForEvent('page', { timeout: 10000 }).catch(() => [null]),
    popupPage.locator('button:has-text("Start Studio Recording")').click().catch(() => null)
  ]);

  console.log('New tab opened by popup click:', newTab?.url() || 'NONE');

  // Let's see all open pages
  console.log('Open pages in context:');
  for (const p of context.pages()) {
    console.log(' - Page URL:', p.url());
  }

  // Let's find editor.html
  const editorPage = context.pages().find(p => p.url().includes('editor.html'));
  if (!editorPage) {
    console.log('FAILURE: editor.html was not opened after clicking Start Studio Recording.');
  } else {
    console.log('Found editor page:', editorPage.url());
    await editorPage.bringToFront();
    await editorPage.waitForTimeout(2000);

    // Check if editor is recording or loaded demo workspace
    const editorState = await editorPage.evaluate(() => {
      const isRecordingBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Stop Live Recording'));
      const recordNewBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Record New Screen'));
      const bodyText = document.body.innerText;
      return {
        hasStopLiveBtn: !!isRecordingBtn,
        hasRecordNewBtn: !!recordNewBtn,
        bodySnippet: bodyText.slice(0, 300)
      };
    });
    console.log('Editor State on arrival:', editorState);

    // If recording is active or can be triggered via "Record New Screen"
    if (!editorState.hasStopLiveBtn) {
      console.log('Attempting real user click on "Record New Screen" inside editor...');
      const recordNewBtn = editorPage.locator('button:has-text("Record New Screen")');
      if (await recordNewBtn.isVisible()) {
        await recordNewBtn.click();
        await editorPage.waitForTimeout(2000);
      }
    }

    const afterClickState = await editorPage.evaluate(() => {
      const stopBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Stop Live Recording'));
      return {
        isRecordingNow: !!stopBtn,
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean)
      };
    });
    console.log('After Record New Screen click:', afterClickState);

    // If live recording started:
    if (afterClickState.isRecordingNow) {
      console.log('Live recording is active! Recording for 3 seconds...');
      await new Promise(r => setTimeout(r, 3000));
      console.log('Clicking "Stop Live Recording" button...');
      await editorPage.locator('button:has-text("Stop Live Recording")').click();
      console.log('Waiting for recording to finalize...');
      await editorPage.waitForTimeout(3000);
    } else {
      console.log('STOPPING: getDisplayMedia did not start recording or was blocked.');
    }

    // Now check if editor loaded real video or demo
    const finalVideoState = await editorPage.evaluate(() => {
      const video = document.querySelector('video');
      const canvas = document.querySelector('canvas');
      const titleEl = document.querySelector('header p');
      return {
        hasVideoElement: !!video,
        videoSrc: video?.src || null,
        duration: video?.duration || null,
        canvasW: canvas?.width,
        canvasH: canvas?.height,
        headerDesc: titleEl?.innerText || ''
      };
    });
    console.log('Final Video State in Editor:', finalVideoState);

    // Now let's try real exports and wait for actual download events to save to disk!
    console.log('Attempting real export downloads...');

    // 1. SOP Guide
    const sopBtn = editorPage.locator('button:has-text("SOP Guide (.md)")');
    if (await sopBtn.isVisible()) {
      try {
        const [download] = await Promise.all([
          editorPage.waitForEvent('download', { timeout: 8000 }),
          sopBtn.click()
        ]);
        const sopPath = path.join(EXPORTS_DIR, 'Exported_SOP_Guide.md');
        await download.saveAs(sopPath);
        const stats = fs.statSync(sopPath);
        console.log(`[PASS] SOP Guide saved to disk: ${sopPath} (${stats.size} bytes)`);
      } catch (e) {
        console.log('[FAIL] SOP Guide download failed:', e.message);
      }
    }

    // 2. HTML Widget
    const widgetBtn = editorPage.locator('button:has-text("HTML Widget")');
    if (await widgetBtn.isVisible()) {
      try {
        const [download] = await Promise.all([
          editorPage.waitForEvent('download', { timeout: 8000 }),
          widgetBtn.click()
        ]);
        const widgetPath = path.join(EXPORTS_DIR, 'Exported_Interactive_Widget.html');
        await download.saveAs(widgetPath);
        const stats = fs.statSync(widgetPath);
        console.log(`[PASS] HTML Widget saved to disk: ${widgetPath} (${stats.size} bytes)`);
      } catch (e) {
        console.log('[FAIL] HTML Widget download failed:', e.message);
      }
    }

    // 3. GIF
    const gifBtn = editorPage.locator('button:has-text("Export GIF")');
    if (await gifBtn.isVisible()) {
      try {
        console.log('Triggering GIF export and waiting for download...');
        const [download] = await Promise.all([
          editorPage.waitForEvent('download', { timeout: 45000 }),
          gifBtn.click()
        ]);
        const gifPath = path.join(EXPORTS_DIR, 'Exported_Loop.gif');
        await download.saveAs(gifPath);
        const stats = fs.statSync(gifPath);
        console.log(`[PASS] GIF saved to disk: ${gifPath} (${stats.size} bytes)`);
      } catch (e) {
        console.log('[FAIL] GIF download failed:', e.message);
      }
    }

    // 4. MP4
    const mp4Btn = editorPage.locator('button:has-text("Export 4K"), button:has-text("Export MP4"), button:has-text("Encoding")').first();
    if (await mp4Btn.isVisible()) {
      try {
        console.log('Triggering MP4 export and waiting for download...');
        const [download] = await Promise.all([
          editorPage.waitForEvent('download', { timeout: 60000 }),
          mp4Btn.click()
        ]);
        const mp4Path = path.join(EXPORTS_DIR, 'Exported_Cinematic.mp4');
        await download.saveAs(mp4Path);
        const stats = fs.statSync(mp4Path);
        console.log(`[PASS] MP4 saved to disk: ${mp4Path} (${stats.size} bytes)`);
      } catch (e) {
        console.log('[FAIL] MP4 download failed:', e.message);
      }
    }
  }

  await browser.close();
  chromeProcess.kill();
  server.close();
  console.log('=== STRICT AUDIT FINISHED ===');
}

runStrictAudit().catch(err => {
  console.error('STRICT AUDIT ERROR:', err);
  process.exit(1);
});

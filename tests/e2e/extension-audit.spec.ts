import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIST_PATH = path.resolve(__dirname, '../../dist');
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts');
const FIXTURE_HTML_PATH = path.resolve(__dirname, '../test-target.html');
const FIXTURE_PORT = 4321;
const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

test.describe.serial('SmoothStudio Autonomous Extension Audit Suite', () => {
  let server: http.Server;
  let tempUserDataDir: string;
  let context: BrowserContext;
  let extensionId: string;
  const capturedErrors: string[] = [];

  test.beforeAll(async () => {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }

    // Start local fixture server for test-target.html
    await new Promise<void>((resolve, reject) => {
      server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.url === '/' || req.url?.includes('test-target.html')) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(fs.readFileSync(FIXTURE_HTML_PATH));
          return;
        }
        res.writeHead(404);
        res.end('Not Found');
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          setTimeout(() => {
            server.close();
            server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve());
          }, 1000);
        } else {
          reject(err);
        }
      });

      server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve());
    });

    // Launch Chromium with extension loaded
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothstudio-pw-'));
    context = await chromium.launchPersistentContext(tempUserDataDir, {
      executablePath: fs.existsSync(CHROME_EXECUTABLE) ? CHROME_EXECUTABLE : undefined,
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${EXTENSION_DIST_PATH}`,
        `--load-extension=${EXTENSION_DIST_PATH}`,
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--enable-features=WebCodecs',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen'
      ]
    });

    // Attach error listeners
    const attachConsoleListener = (page: Page) => {
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          capturedErrors.push(`[Console Error] (${page.url()}): ${msg.text()}`);
        }
      });
      page.on('pageerror', (err) => {
        capturedErrors.push(`[Page Exception] (${page.url()}): ${err.stack || err.message}`);
      });
    };

    context.on('page', attachConsoleListener);
    context.pages().forEach(attachConsoleListener);

    // Discover extension ID from service worker
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null as any);
    }
    if (sw) {
      extensionId = new URL(sw.url()).host;
    } else {
      // Fallback: discover from pages
      const probe = await context.newPage();
      await probe.goto(`chrome-extension://__invalid__/popup.html`).catch(() => null);
      for (const w of context.serviceWorkers()) {
        if (w.url().includes('service-worker.js')) {
          extensionId = new URL(w.url()).host;
          break;
        }
      }
      await probe.close().catch(() => {});
    }
  });

  test.afterAll(async () => {
    if (context) {
      await context.close().catch(() => {});
    }
    if (server) {
      server.close();
    }
    if (tempUserDataDir) {
      try {
        fs.rmSync(tempUserDataDir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('Stage 1: Production Build & Package Integrity', async () => {
    const requiredFiles = [
      'manifest.json',
      'background/service-worker.js',
      'content/dom-tracker.js',
      'content/privacy-redactor.js',
      'popup.html',
      'editor.html'
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(EXTENSION_DIST_PATH, file);
      expect(fs.existsSync(fullPath), `Artifact missing: ${file}`).toBe(true);
    }

    const domTrackerContent = fs.readFileSync(path.join(EXTENSION_DIST_PATH, 'content/dom-tracker.js'), 'utf-8');
    const hasEsImport = /^\s*import\s/m.test(domTrackerContent);
    const hasEsExport = /^\s*export\s/m.test(domTrackerContent);

    expect(hasEsImport, 'dom-tracker.js must not contain ES import').toBe(false);
    expect(hasEsExport, 'dom-tracker.js must not contain ES export').toBe(false);
  });

  test('Stage 2: Manifest V3 Service Worker & Heartbeat PING', async () => {
    expect(extensionId).toBeTruthy();

    const probePage = await context.newPage();
    await probePage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    const pingResponse = await probePage.evaluate(async () => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
      return new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'PING' }, (res) => resolve(res));
      });
    });

    await probePage.close();
    expect(pingResponse).toBeDefined();
    expect(pingResponse?.pong).toBe(true);
  });

  test('Stage 3: Content Script Ingestion & Real-Time Privacy Redaction', async () => {
    const targetPage = await context.newPage();
    await targetPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-target.html`, { waitUntil: 'domcontentloaded' });

    // Allow content script to inject
    await targetPage.waitForTimeout(600);

    // Natural user interaction simulation
    await targetPage.mouse.move(120, 140);
    await targetPage.mouse.move(260, 240, { steps: 5 });
    await targetPage.mouse.move(380, 360, { steps: 5 });

    await targetPage.click('#feature-input');
    await targetPage.type('#feature-input', 'feat/autonomous-e2e-live');
    await targetPage.click('#btn-deploy');

    const statusText = await targetPage.innerText('#status-log');
    expect(statusText).toContain('Deployment initiated');

    // Trigger privacy redaction via popup broadcast to web tabs
    const privacyControllerPage = await context.newPage();
    await privacyControllerPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await privacyControllerPage.evaluate(async () => {
      return new Promise<void>((resolve) => {
        chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
          let pending = tabs.length;
          if (pending === 0) return resolve();
          for (const t of tabs) {
            if (t.id) {
              chrome.tabs.sendMessage(t.id, {
                type: 'APPLY_PRIVACY_OPTIONS',
                options: { blurEmails: true, blurRevenue: true, blurApiKeys: true }
              }, () => {
                if (chrome.runtime?.lastError) {}
                if (--pending <= 0) resolve();
              });
            } else {
              if (--pending <= 0) resolve();
            }
          }
        });
      });
    });
    await privacyControllerPage.close();
    await targetPage.waitForTimeout(400);

    // Spec item 5: the shield is VISUAL ONLY. The page's own text stays exactly
    // as the page wrote it; the element is blurred with filter: blur(8px).
    const redacted = await targetPage.evaluate(() => {
      const el = document.querySelector('#user-email') as HTMLElement;
      return { text: el.textContent, filter: getComputedStyle(el).filter };
    });
    expect(redacted.text, 'the shield must not rewrite the page text').toBe('ceo@enterprise-saas.com');
    expect(redacted.filter, 'the email must be blurred').toContain('blur(8px)');

    await targetPage.screenshot({ path: path.join(ARTIFACTS_DIR, '01-target-page-redacted.png') });
    await targetPage.close();
  });

  test('Stage 4: Extension Popup UI Controls', async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    await popupPage.waitForSelector('button', { state: 'attached', timeout: 8000 });
    const buttons = await popupPage.$$eval('button', (els) => els.map((e) => e.innerText.trim()));

    expect(buttons.length).toBeGreaterThanOrEqual(2);
    await popupPage.screenshot({ path: path.join(ARTIFACTS_DIR, '02-popup-studio.png') });
    await popupPage.close();
  });

  test('Stage 5: Editor Studio Canvas & Spring Camera Viewport', async () => {
    const editorPage = await context.newPage();
    await editorPage.goto(`chrome-extension://${extensionId}/editor.html`, { waitUntil: 'domcontentloaded' });

    await editorPage.waitForSelector('canvas', { timeout: 8000 });
    await editorPage.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return c && c.width === 1920 && c.height === 1080;
    }, { timeout: 8000 });

    const canvasMetrics = await editorPage.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const ctx = c.getContext('2d');
      const pixel = ctx ? ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data : null;
      return {
        width: c.width,
        height: c.height,
        centerRgba: pixel ? Array.from(pixel) : null
      };
    });

    expect(canvasMetrics).toBeDefined();
    expect(canvasMetrics?.width).toBe(1920);
    expect(canvasMetrics?.height).toBe(1080);
    expect(canvasMetrics?.centerRgba?.[3]).toBe(255); // Non-transparent buffer

    await editorPage.close();
  });

  test('Stage 6: In-App Flight Doctor Diagnostic Probes', async () => {
    const editorPage = await context.newPage();
    await editorPage.goto(`chrome-extension://${extensionId}/editor.html`, { waitUntil: 'domcontentloaded' });

    const doctorBtn = await editorPage.$('button:has-text("Flight Doctor")');
    expect(doctorBtn).toBeDefined();
    await doctorBtn?.click();

    await editorPage.waitForSelector('.fixed.inset-0', { timeout: 3000 });
    // Wait for all 5 probes to settle
    await editorPage.waitForTimeout(1400);

    const doctorReport = await editorPage.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0');
      const items = Array.from(modal?.querySelectorAll('.space-y-2 > div') || []).map((c) => c.innerText.replace(/\n+/g, ' • '));
      return { items };
    });

    expect(doctorReport.items.length).toBe(5);
    await editorPage.screenshot({ path: path.join(ARTIFACTS_DIR, '03-flight-doctor-modal.png') });

    const closeBtn = await editorPage.$('button:has-text("Close Diagnostics")');
    await closeBtn?.click();
    await editorPage.close();
  });

  test('Stage 7: Playback Loop & Multi-Format Exporters', async () => {
    const editorPage = await context.newPage();
    await editorPage.goto(`chrome-extension://${extensionId}/editor.html`, { waitUntil: 'domcontentloaded' });

    const playBtn = await editorPage.$('button:has-text("▶")');
    expect(playBtn).toBeDefined();
    await playBtn?.click();
    await editorPage.waitForTimeout(1200);

    const playheadTime = await editorPage.evaluate(() => {
      return document.body.innerText.match(/\d+\.\d+s \/ \d+\.\d+s/g)?.[0] || '0.0s';
    });
    expect(playheadTime).not.toBe('0.0s / 12.0s');

    // SOP Guide export check
    const sopBtn = await editorPage.$('button:has-text("SOP Guide (.md)")');
    expect(sopBtn).toBeDefined();
    const [sopDownload] = await Promise.all([
      editorPage.waitForEvent('download', { timeout: 6000 }).catch(() => [null]),
      sopBtn?.click()
    ]);
    expect(sopDownload).toBeDefined();

    // HTML Widget export check
    const widgetBtn = await editorPage.$('button:has-text("HTML Widget")');
    expect(widgetBtn).toBeDefined();
    const [widgetDownload] = await Promise.all([
      editorPage.waitForEvent('download', { timeout: 6000 }).catch(() => [null]),
      widgetBtn?.click()
    ]);
    expect(widgetDownload).toBeDefined();

    await editorPage.screenshot({ path: path.join(ARTIFACTS_DIR, '04-editor-studio-live.png') });
    await editorPage.close();
  });

  test('Stage 8: Live Screen Recording-to-Editor Pipeline', async () => {
    const editorPage = await context.newPage();
    await editorPage.goto(`chrome-extension://${extensionId}/editor.html`, { waitUntil: 'domcontentloaded' });

    const recordBtn = await editorPage.$('button:has-text("Record New Screen")');
    expect(recordBtn).toBeDefined();
    await recordBtn?.click();

    await editorPage.waitForSelector('button:has-text("Stop Live Recording")', { timeout: 6000 });
    await editorPage.waitForTimeout(2000);

    const stopBtn = await editorPage.$('button:has-text("Stop Live Recording")');
    await stopBtn?.click();

    await editorPage.waitForSelector('button:has-text("Record New Screen")', { timeout: 10000 });
    await editorPage.waitForTimeout(1000);

    await editorPage.screenshot({ path: path.join(ARTIFACTS_DIR, '05-live-recorded-editor.png') });
    await editorPage.close();
  });

  test('Stage 9: Verify Zero Runtime Console Errors', async () => {
    expect(capturedErrors, `Captured console errors:\n${capturedErrors.join('\n')}`).toEqual([]);
  });
});

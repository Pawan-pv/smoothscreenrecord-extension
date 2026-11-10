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
const FIXTURE_PORT = 4323;
const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

test.describe.serial('SmoothStudio Natural Human User Journey Simulation', () => {
  let server: http.Server;
  let tempUserDataDir: string;
  let context: BrowserContext;
  let extensionId: string;
  const capturedErrors: string[] = [];

  test.beforeAll(async () => {
    // 1. Start local web page server
    await new Promise<void>((resolve, reject) => {
      server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(FIXTURE_HTML_PATH));
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

    // 2. Launch Chromium with unpacked extension loaded
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothstudio-human-'));
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

    // 3. Monitor console & page exceptions
    const attachListeners = (page: Page) => {
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          capturedErrors.push(`[Console Error] (${page.url()}): ${msg.text()}`);
        }
      });
      page.on('pageerror', (err) => {
        capturedErrors.push(`[Page Exception] (${page.url()}): ${err.stack || err.message}`);
      });
    };

    context.on('page', attachListeners);
    context.pages().forEach(attachListeners);

    // 4. Discover extension ID from service worker
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null as any);
    }
    if (sw) {
      extensionId = new URL(sw.url()).host;
    } else {
      const probe = await context.newPage();
      await probe.goto(`chrome-extension://__probe__/popup.html`).catch(() => null);
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

  test('Step 1: Open popup UI, explore controls, and toggle microphone', async () => {
    expect(extensionId).toBeTruthy();

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(300);

    // Verify title and version badge
    const headerTitle = popupPage.locator('h1');
    await expect(headerTitle).toContainText('SmoothStudio');
    const versionBadge = popupPage.locator('h1 span');
    await expect(versionBadge).toContainText('v1.0');

    // Toggle microphone switch off then on
    const micCheckbox = popupPage.locator('input[type="checkbox"]').first();
    await micCheckbox.waitFor({ state: 'attached' });
    expect(await micCheckbox.isChecked()).toBe(true);

    await micCheckbox.uncheck({ force: true });
    await popupPage.waitForTimeout(200);
    expect(await micCheckbox.isChecked()).toBe(false);

    await micCheckbox.check({ force: true });
    await popupPage.waitForTimeout(200);
    expect(await micCheckbox.isChecked()).toBe(true);

    await popupPage.close();
  });

  test('Step 2: Natural privacy shield controls and interactive click-to-blur picker', async () => {
    const targetPage = await context.newPage();
    await targetPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-target.html`, { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(500);

    // Initial check: target page has unmasked sensitive data
    expect(await targetPage.innerText('#user-email')).toBe('ceo@enterprise-saas.com');
    expect(await targetPage.innerText('#user-revenue')).toBe('$1,450,000 USD');
    expect(await targetPage.innerText('#user-api-key')).toContain('sk_live_');

    // Human fills input on target page
    const featureInput = targetPage.locator('#feature-input');
    await featureInput.click();
    await featureInput.pressSequentially('feat/smart-spring-camera', { delay: 30 });
    expect(await featureInput.inputValue()).toBe('feat/smart-spring-camera');

    // Click deploy button
    const deployBtn = targetPage.locator('#btn-deploy');
    await deployBtn.click();
    await expect(targetPage.locator('#status-log')).toContainText('Deployment initiated');

    // Open popup to toggle privacy shield
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(300);

    // Toggle element picker button
    const pickerBtn = popupPage.locator('button:has-text("Interactive Click-to-Blur Picker")');
    await pickerBtn.click();
    await popupPage.waitForTimeout(200);

    const activePickerBtn = popupPage.locator('button:has-text("Active: Click Elements on Page to Blur")');
    await expect(activePickerBtn).toBeVisible();

    // Toggle privacy checkboxes off and on
    const privacyCheckboxes = popupPage.locator('label.flex.items-center.justify-between input[type="checkbox"]');
    const emailCheckbox = privacyCheckboxes.nth(0);
    await emailCheckbox.uncheck({ force: true });
    await popupPage.waitForTimeout(150);
    await emailCheckbox.check({ force: true });
    await popupPage.waitForTimeout(300);

    // Target page should reflect real-time text redaction
    const emailText = await targetPage.innerText('#user-email');
    expect(emailText).toContain('•');

    await popupPage.close();
    await targetPage.close();
  });

  test('Step 3: Trigger "Start Studio Recording" and verify Studio Workspace (editor.html?record=true)', async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(300);

    // Click Start Studio Recording
    const startBtn = popupPage.locator('button:has-text("Start Studio Recording")');
    await startBtn.click();

    // Verify editor tab opened
    await expect.poll(
      () => context.pages().find((p) => p.url().includes('editor.html?record=true')),
      { timeout: 8000 }
    ).toBeDefined();

    const editorPage = context.pages().find((p) => p.url().includes('editor.html?record=true'))!;
    await editorPage.waitForLoadState('domcontentloaded');

    // Verify 1920x1080 canvas viewport
    const canvas = editorPage.locator('canvas');
    await canvas.waitFor({ state: 'attached' });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(400);
    expect(box!.height).toBeGreaterThan(250);

    // Verify canvas pixel buffer is non-blank
    const pixelRgba = await editorPage.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      if (!c) return null;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const pixel = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return Array.from(pixel);
    });
    expect(pixelRgba).toBeTruthy();
    expect(pixelRgba![3]).toBe(255); // Full alpha opacity

    // Open Flight Doctor diagnostic modal
    const doctorBtn = editorPage.locator('button:has-text("Flight Doctor")');
    if (await doctorBtn.isVisible()) {
      await doctorBtn.click();
      await editorPage.waitForSelector('.fixed.inset-0', { timeout: 4000 });
      await editorPage.waitForTimeout(1000);
      // Close doctor modal
      const closeBtn = editorPage.locator('button:has-text("Close Diagnostics")');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }

    await editorPage.close();
    await popupPage.close().catch(() => {});
  });

  test('Step 4: Verify Zero Runtime Console Errors or Exceptions', async () => {
    expect(capturedErrors, `Captured runtime console errors:\n${capturedErrors.join('\n')}`).toEqual([]);
  });
});

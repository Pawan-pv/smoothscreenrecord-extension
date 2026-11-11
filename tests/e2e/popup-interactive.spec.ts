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
const FIXTURE_PORT = 4322;
const CHROME_EXECUTABLE = 'C:\\Users\\pawan\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe';

test.describe.serial('SmoothStudio Popup & Service Worker Interactive Suite', () => {
  let server: http.Server;
  let tempUserDataDir: string;
  let context: BrowserContext;
  let extensionId: string;
  const capturedErrors: string[] = [];

  test.beforeAll(async () => {
    // Start local test target fixture server
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

    // Launch Chromium with unpacked extension loaded
    tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothstudio-interactive-'));
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

    // Capture all console errors
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

    // Discover extension ID from service worker
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

  test('1. Service Worker: Startup Lifecycle & Default Schema Persistence', async () => {
    expect(extensionId).toBeTruthy();

    const probePage = await context.newPage();
    await probePage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // Verify initial session state in storage.session
    const sessionState = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        const area = (chrome.storage as any)?.session || chrome.storage.local;
        area.get(['isRecording', 'activeRecordingTabId', 'activeEditorTabId'], (data: any) => {
          resolve(data);
        });
      });
    });

    expect(sessionState).toBeDefined();
    expect(sessionState.isRecording).toBe(false);

    await probePage.close();
  });

  test('2. Service Worker: Keepalive Port Ping-Pong Heartbeat', async () => {
    const probePage = await context.newPage();
    await probePage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    const pongResult = await probePage.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'smoothstudio-keepalive' });
        const timeout = setTimeout(() => {
          port.disconnect();
          reject(new Error('Keepalive pong timeout'));
        }, 3000);

        port.onMessage.addListener((msg) => {
          clearTimeout(timeout);
          port.disconnect();
          resolve(msg);
        });

        port.postMessage('ping');
      });
    });

    expect(pongResult).toBe('pong');
    await probePage.close();
  });

  test('3. Service Worker: Stream Port Disconnect Crash Recovery Marker', async () => {
    const probePage = await context.newPage();
    await probePage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // Connect and immediately disconnect a stream port
    await probePage.evaluate(async () => {
      return new Promise<void>((resolve) => {
        const port = chrome.runtime.connect({ name: 'smoothstudio-stream' });
        setTimeout(() => {
          port.disconnect();
          resolve();
        }, 100);
      });
    });

    // Allow service worker to write crash recovery marker into storage.local
    await probePage.waitForTimeout(400);

    const marker = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        chrome.storage.local.get(['crashRecoveryMarker'], (data) => {
          resolve(data.crashRecoveryMarker);
        });
      });
    });

    expect(marker).toBeDefined();
    expect(marker.portName).toBe('smoothstudio-stream');
    expect(marker.reason).toBe('client_stream_disconnected');
    expect(marker.recovered).toBe(false);

    await probePage.close();
  });

  test('4. Service Worker: START & STOP Studio Recording State Machine', async () => {
    const probePage = await context.newPage();
    await probePage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // Trigger START_STUDIO_RECORDING message
    const startRes = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_STUDIO_RECORDING',
          tabId: 9999,
          focusTarget: false
        }, (res) => resolve(res));
      });
    });

    expect(startRes?.status).toBe('recording_started');

    // Check status via GET_RECORDING_STATUS
    const statusRes = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => resolve(res));
      });
    });

    expect(statusRes?.isRecording).toBe(true);

    // Trigger STOP_STUDIO_RECORDING message
    const stopRes = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'STOP_STUDIO_RECORDING' }, (res) => resolve(res));
      });
    });

    expect(stopRes?.status).toBe('recording_stopped');

    // Wait and verify status reset
    await probePage.waitForTimeout(300);
    const postStatusRes = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => resolve(res));
      });
    });

    expect(postStatusRes?.isRecording).toBe(false);
    await probePage.close();
  });

  test('5. Popup UI: Interactive Audio & Privacy Shield Toggle Controls', async () => {
    // Open target page so privacy messages have a recipient
    const targetPage = await context.newPage();
    await targetPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/`, { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(500);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // 1. Microphone Toggle Checkbox
    const micCheckbox = popupPage.locator('input[type="checkbox"]').first();
    await micCheckbox.waitFor({ state: 'attached' });
    expect(await micCheckbox.isChecked()).toBe(true);

    // Toggle Mic off
    await micCheckbox.uncheck({ force: true });
    expect(await micCheckbox.isChecked()).toBe(false);

    // Toggle Mic on
    await micCheckbox.check({ force: true });
    expect(await micCheckbox.isChecked()).toBe(true);

    // 2. Privacy Checkboxes: Emails, Revenue, Keys
    const privacyCheckboxes = popupPage.locator('label.flex.items-center.justify-between input[type="checkbox"]');
    const count = await privacyCheckboxes.count();
    expect(count).toBe(3);

    // Toggle Email privacy off then on
    const emailCheckbox = privacyCheckboxes.nth(0);
    expect(await emailCheckbox.isChecked()).toBe(true);
    await emailCheckbox.uncheck({ force: true });
    expect(await emailCheckbox.isChecked()).toBe(false);
    await emailCheckbox.check({ force: true });
    expect(await emailCheckbox.isChecked()).toBe(true);

    // Toggle Revenue privacy off then on
    const revCheckbox = privacyCheckboxes.nth(1);
    expect(await revCheckbox.isChecked()).toBe(true);
    await revCheckbox.uncheck({ force: true });
    expect(await revCheckbox.isChecked()).toBe(false);
    await revCheckbox.check({ force: true });
    expect(await revCheckbox.isChecked()).toBe(true);

    // Toggle Keys privacy off then on
    const keyCheckbox = privacyCheckboxes.nth(2);
    expect(await keyCheckbox.isChecked()).toBe(true);
    await keyCheckbox.uncheck({ force: true });
    expect(await keyCheckbox.isChecked()).toBe(false);
    await keyCheckbox.check({ force: true });
    expect(await keyCheckbox.isChecked()).toBe(true);

    // Screenshot of configured popup
    await popupPage.screenshot({ path: path.join(ARTIFACTS_DIR, '06-popup-interactive-toggles.png') });

    await popupPage.close();
    await targetPage.close();
  });

  test('6. Popup UI: Interactive Element Picker Toggle', async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // Locate Interactive Click-to-Blur Picker button
    const pickerBtn = popupPage.locator('button:has-text("Interactive Click-to-Blur Picker")');
    await pickerBtn.waitFor({ state: 'attached' });

    // Click to activate picker
    await pickerBtn.click();
    await popupPage.waitForTimeout(200);

    // Verify text updates to Active state
    const activePickerBtn = popupPage.locator('button:has-text("Active: Click Elements on Page to Blur")');
    await activePickerBtn.waitFor({ state: 'attached' });
    expect(await activePickerBtn.isVisible()).toBe(true);

    // Click again to deactivate
    await activePickerBtn.click();
    await popupPage.waitForTimeout(200);

    // Verify text returns to inactive state
    await pickerBtn.waitFor({ state: 'attached' });
    expect(await pickerBtn.isVisible()).toBe(true);

    await popupPage.close();
  });

  test('7. Popup UI: Studio Workspace Navigation Links', async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // Click header external link icon
    const headerStudioBtn = popupPage.locator('button[title="Open Studio Workspace"]');
    await headerStudioBtn.waitFor({ state: 'attached' });
    await headerStudioBtn.click();

    // Verify editor.html tab appears in browser context
    await expect.poll(
      () => context.pages().find((p) => p.url().includes('editor.html')),
      { timeout: 8000 }
    ).toBeDefined();

    // Close the opened editor page to keep context clean
    const openedEditorPage = context.pages().find((p) => p.url().includes('editor.html'));
    if (openedEditorPage) {
      await openedEditorPage.close();
    }

    // Click footer "Open Studio Workspace →" button
    const footerStudioBtn = popupPage.locator('button:has-text("Open Studio Workspace →")');
    await footerStudioBtn.waitFor({ state: 'attached' });
    await footerStudioBtn.click();

    // Verify editor.html tab appears again
    await expect.poll(
      () => context.pages().find((p) => p.url().includes('editor.html')),
      { timeout: 8000 }
    ).toBeDefined();

    const secondEditorPage = context.pages().find((p) => p.url().includes('editor.html'));
    if (secondEditorPage) {
      await secondEditorPage.close();
    }

    await popupPage.close();
  });

  test('8. Popup UI: Start Studio Recording Button Integration', async () => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    const startRecordingBtn = popupPage.locator('button:has-text("Start Studio Recording")');
    await startRecordingBtn.waitFor({ state: 'attached' });
    await startRecordingBtn.click();

    // Verify editor.html?record=true opens in context
    await expect.poll(
      () => context.pages().find((p) => p.url().includes('editor.html?record=true')),
      { timeout: 8000 }
    ).toBeDefined();

    const recordEditorPage = context.pages().find((p) => p.url().includes('editor.html?record=true'));
    if (recordEditorPage) {
      await recordEditorPage.close();
    }

    await popupPage.close().catch(() => {});
  });

  test('9. Popup UI: Stop Recording State & State Machine Transition', async () => {
    const probePage = await context.newPage();
    await probePage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    // Set service worker to recording state
    await probePage.evaluate(async () => {
      return new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: 'START_STUDIO_RECORDING' }, () => resolve());
      });
    });

    // Reopen popup to reflect recording state
    await probePage.reload({ waitUntil: 'domcontentloaded' });
    await probePage.waitForTimeout(300);

    // Verify Stop button is active and visible
    const stopBtn = probePage.locator('button:has-text("Stop Recording & Open Studio")');
    await stopBtn.waitFor({ state: 'attached' });
    expect(await stopBtn.isVisible()).toBe(true);

    // Click Stop Recording
    await stopBtn.click();
    await probePage.waitForTimeout(400);

    // Verify service worker state transitioned back to isRecording: false
    const statusRes = await probePage.evaluate(async () => {
      return new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => resolve(res));
      });
    });
    expect(statusRes?.isRecording).toBe(false);

    await probePage.close();
  });

  test('10. Real-time message passing: Popup Privacy Toggle broadcasts to live content script', async () => {
    const targetPage = await context.newPage();
    await targetPage.goto(`http://127.0.0.1:${FIXTURE_PORT}/test-target.html`, { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(600);

    // Ensure content script is running and target text is initially unredacted
    const originalEmail = await targetPage.innerText('#user-email');
    expect(originalEmail).toBe('ceo@enterprise-saas.com');

    // Open popup in parallel and toggle email privacy
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });

    const emailCheckbox = popupPage.locator('label.flex.items-center.justify-between input[type="checkbox"]').first();
    await emailCheckbox.uncheck({ force: true });
    await popupPage.waitForTimeout(200);
    await emailCheckbox.check({ force: true });
    await popupPage.waitForTimeout(400);

    // Target page DOM should be redacted via real-time message forwarding
    // Spec item 5: visual-only blur, the page's text is never rewritten.
    const redacted = await targetPage.evaluate(() => {
      const el = document.querySelector('#user-email') as HTMLElement;
      return { text: el.textContent, filter: getComputedStyle(el).filter };
    });
    expect(redacted.text, 'the shield must not rewrite the page text').toBe('ceo@enterprise-saas.com');
    expect(redacted.filter, 'the email must be blurred').toContain('blur(8px)');

    await popupPage.close();
    await targetPage.close();
  });

  test('11. Verify Zero Runtime Console Errors Across All Interactive Flows', async () => {
    expect(capturedErrors, `Captured runtime console errors:\n${capturedErrors.join('\n')}`).toEqual([]);
  });
});

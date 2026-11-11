import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../dist');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoothstudio-clean-'));

const context = await chromium.launchPersistentContext(tempDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--disable-gpu-sandbox'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const extensionId = new URL(background.url()).host;
  console.log('[Test Fix 3] Extension ID:', extensionId);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/editor.html`);
  await page.waitForTimeout(2000);

  const state = await page.evaluate(async () => {
    const emptyStateHeading = document.querySelector('h2');
    const recordBtn = document.querySelector('#record-new-screen-empty-btn');
    const video = document.querySelector('video#smoothstudio-source-video');
    const demoActive = Boolean(window.__smoothstudio_demo_active);

    return {
      emptyStateHeadingText: emptyStateHeading?.textContent,
      hasRecordButton: Boolean(recordBtn),
      videoElementPresent: Boolean(video),
      isDemoWorkspaceActive: demoActive,
      bodyTextSnippet: document.body.innerText.slice(0, 300)
    };
  });

  console.log('\n=== FIX 3 RAW VERIFICATION EVIDENCE ===');
  console.log(JSON.stringify(state, null, 2));

  if (
    state.emptyStateHeadingText?.includes('No Screen Recording Found') &&
    state.hasRecordButton &&
    !state.isDemoWorkspaceActive &&
    !state.videoElementPresent
  ) {
    console.log('\n>>> FIX 3 RESULT: PASS <<<');
  } else {
    console.log('\n>>> FIX 3 RESULT: FAIL <<<');
  }

} catch (err) {
  console.error('[Test Fix 3 Error]', err);
} finally {
  await context.close();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
}

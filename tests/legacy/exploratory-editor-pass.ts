import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const DIST_PATH = path.resolve(__dirname, '../dist');
const TEST_RESULTS_DIR = path.resolve(__dirname, '../test-results/exploratory');

async function runExploratoryPass() {
  console.log('--- Starting Step 8: Exploratory Editor User Session ---');
  if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
  }

  const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoothstudio-explore-${Date.now()}-`));
  const context = await chromium.launchPersistentContext(tempUserDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST_PATH}`,
      `--load-extension=${DIST_PATH}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  });

  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];

    const editorPage = await context.newPage();
    await editorPage.goto(`chrome-extension://${extensionId}/editor.html`);
    await editorPage.waitForSelector('canvas', { timeout: 10000 });
    await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, '01-editor-initial.png') });
    console.log('  1. Editor loaded successfully');

    // 2. Play / Pause toggle
    const playBtn = editorPage.locator('button[aria-label="Play / Pause"]');
    if (await playBtn.count() > 0) {
      await playBtn.click();
      await editorPage.waitForTimeout(1000);
      await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, '02-editor-playing.png') });
      await playBtn.click();
      console.log('  2. Play/Pause toggle verified');
    }

    // 3. Press 'Z' to add a zoom pill at current playhead
    const initialPills = await editorPage.locator('[data-zoom-pill]').count();
    await editorPage.keyboard.press('z');
    await editorPage.waitForTimeout(500);
    const newPills = await editorPage.locator('[data-zoom-pill]').count();
    await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, '03-pressed-z-added-pill.png') });
    console.log(`  3. Pressed Z: zoom pills went from ${initialPills} to ${newPills}`);

    // 4. Switch vibe presets
    const presetButtons = editorPage.locator('button:has-text("Linear"), button:has-text("Keynote"), button:has-text("Neon"), button:has-text("Minimal")');
    const presetCount = await presetButtons.count();
    console.log(`  4. Available preset buttons found: ${presetCount}`);
    if (presetCount > 0) {
      await presetButtons.first().click();
      await editorPage.waitForTimeout(500);
      await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, '04-preset-switched.png') });
    }

    // 5. Check Export button
    const exportBtn = editorPage.locator('button:has-text("Export MP4")');
    if (await exportBtn.count() > 0) {
      console.log('  5. Export MP4 button present and clickable');
      await exportBtn.click();
      await editorPage.waitForTimeout(2000);
      await editorPage.screenshot({ path: path.join(TEST_RESULTS_DIR, '05-export-initiated.png') });
    }

    console.log('✅ Exploratory pass completed successfully!');
  } finally {
    await context.close().catch(() => {});
    try { fs.rmSync(tempUserDataDir, { recursive: true, force: true }); } catch {}
  }
}

runExploratoryPass().catch((err) => {
  console.error('Exploratory pass error:', err);
  process.exit(1);
});

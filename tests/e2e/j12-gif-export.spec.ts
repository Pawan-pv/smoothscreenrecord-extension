/**
 * J12 - GIF export.
 *
 * Correct means:
 *   - 5 frames extracted from the exported GIF show increasing clock values
 *   - no repeated clock values (the GIF really animates)
 *   - the file size is reported for every quality preset
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  launchApp, serveFixtures, recordPage, outDir, saveRawRecording, extractFrame,
  decodeEpochBits, mediaInfo
} from './helpers/harness';

test.describe.serial('J12 GIF export', () => {
  test.setTimeout(420000);

  test('J12: the exported GIF animates with increasing clock values and every preset reports its size', async () => {
    const dir = outDir('j12');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/clock.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);

      const session = await recordPage(app.context, app.extensionId, `${site.base}/clock.html`, {
        seconds: 10,
        includeMic: false,
        target
      });
      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath).toBeTruthy();

      // ---- export every quality preset ------------------------------------
      const sizes: { preset: string; file: string; bytes: number; durationSec: number | null }[] = [];
      for (const preset of ['compact', 'web', 'high']) {
        await session.editor.locator('#gif-preset-select').selectOption(preset);
        await session.editor.waitForTimeout(300);
        const downloadPromise = session.editor.waitForEvent('download', { timeout: 300000 });
        await session.editor.locator('button[title="Export animated lightweight GIF"]').click();
        const download = await downloadPromise;
        const file = path.join(dir, `export_${preset}.gif`);
        await download.saveAs(file);
        const info = mediaInfo(file);
        sizes.push({ preset, file, bytes: info.sizeBytes || 0, durationSec: info.durationSec });
        console.log(`J12 GIF preset ${preset}: ${info.sizeBytes} bytes, ${info.durationSec}s -> ${file}`);
        expect(info.sizeBytes, 'the GIF must not be empty').toBeGreaterThan(1000);
      }

      // ---- the GIF must animate: 5 frames, increasing clock, no repeats ----
      const gif = path.join(dir, 'export_compact.gif');
      const epochs: { at: number; epoch: number | null; file: string }[] = [];
      for (const [i, at] of [0.5, 2.0, 3.5, 5.0, 6.5].entries()) {
        const f = path.join(dir, `gif_frame_${i + 1}.png`);
        extractFrame(gif, at, f);
        epochs.push({ at, epoch: decodeEpochBits(f), file: f });
      }
      console.log('J12 GIF frame clocks:', JSON.stringify(epochs));

      const decoded = epochs.filter((e) => e.epoch !== null);
      expect(decoded.length, 'every extracted GIF frame must carry a readable clock').toBe(epochs.length);
      for (let i = 1; i < decoded.length; i++) {
        expect(decoded[i].epoch!, `frame ${i + 1} clock must be later than frame ${i}`)
          .toBeGreaterThan(decoded[i - 1].epoch!);
      }
      const unique = new Set(decoded.map((e) => e.epoch)).size;
      expect(unique, 'the extracted frames must not repeat the same clock').toBe(decoded.length);

      fs.writeFileSync(path.join(dir, 'j12-summary.json'), JSON.stringify({ sizes, epochs }, null, 2));
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});

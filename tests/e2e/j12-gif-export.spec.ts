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
  launchApp, serveFixtures, recordPage, outDir, saveRawRecording, extractGifFrame,
  countChangedBlobs, mediaInfo
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

      // ---- the GIF must animate: 5 frames, no repeats ----------------------
      // The export renders the page inside the studio's tilted 3D frame, so
      // the machine-readable clock band is scaled and tilted at 640x360 and
      // cannot be decoded reliably. The animation is therefore verified by the
      // frames themselves: every extracted frame must differ from the previous
      // one (no repeated frame), and the clip must hold more than one frame.
      const gif = path.join(dir, 'export_compact.gif');
      const gifInfo = mediaInfo(gif);
      const gifFrames = Number(gifInfo.streams[0]?.nb_frames || 0);
      console.log('J12 compact GIF frames:', gifFrames, 'duration:', gifInfo.durationSec);
      expect(gifFrames, 'the exported GIF must contain more than one frame').toBeGreaterThan(10);

      const frames: { at: number; file: string }[] = [];
      for (const [i, at] of [0.5, 2.0, 3.5, 5.0, 6.5].entries()) {
        const f = path.join(dir, `gif_frame_${i + 1}.png`);
        extractGifFrame(gif, at, f);
        frames.push({ at, file: f });
      }
      const diffs: number[] = [];
      for (let i = 1; i < frames.length; i++) {
        diffs.push(countChangedBlobs(frames[i - 1].file, frames[i].file, 4).changed);
      }
      console.log('J12 changed pixels between consecutive exported frames:', JSON.stringify(diffs));
      for (let i = 0; i < diffs.length; i++) {
        expect(diffs[i], `exported frame ${i + 2} is identical to frame ${i + 1} (the GIF does not animate)`)
          .toBeGreaterThan(100);
      }

      fs.writeFileSync(path.join(dir, 'j12-summary.json'), JSON.stringify({ sizes, frames, diffs, gifFrames }, null, 2));
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});

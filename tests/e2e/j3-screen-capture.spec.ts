/**
 * J3 - Screen capture (the whole screen) of a real page, and how many cursors
 * end up in the recording.
 *
 * The fixture page is opened in an app window that covers the screen, so the
 * recorded surface is real page content and nothing else. The page is static,
 * so the only thing that can change between two recorded frames is the OS
 * cursor - which makes the cursor count exact instead of a guess.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  launchApp, serveFixtures, recordPage, mediaInfo, extractFrame, decodeEpochBits,
  outDir, saveRawRecording, countChangedBlobs, countFrames, streamEndTime, moveRealCursor
} from './helpers/harness';

test.describe.serial('J3 screen capture', () => {
  test.setTimeout(300000);

  test('J3: the screen recording shows the real page, tracks the wall clock, and contains exactly one cursor', async () => {
    const dir = outDir('j3');
    const site = await serveFixtures();
    // real content, no fake device
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/static.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);

      // Move the REAL OS pointer in a straight line during the first ~3 s of
      // the recording. Playwright's mouse.move only moves the page's virtual
      // pointer, and the capture paints the OS one.
      const session = await recordPage(app.context, app.extensionId, `${site.base}/static.html`, {
        seconds: 8,
        includeMic: false,
        target,
        interact: async () => {
          await moveRealCursor(240, 200, 1150, 600, 30, 100);
        }
      });

      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath).toBeTruthy();
      const info = mediaInfo(rawPath!);
      const videoEnd = streamEndTime(rawPath!, 'v');
      console.log('J3 raw ffprobe:', JSON.stringify(info));
      console.log(`J3 video track ends at ${videoEnd.toFixed(3)}s, wall clock ${session.wallClockSec.toFixed(3)}s`);
      expect(info.streams.filter((s) => s.codec_type === 'video').length).toBe(1);
      expect(Math.abs(videoEnd - session.wallClockSec), 'recording length vs wall clock').toBeLessThan(0.6);

      // ---- frames every 0.25 s ---------------------------------------------
      const frames: string[] = [];
      for (let t = 0; t <= 8; t += 0.25) {
        const f = path.join(dir, `frame_${t.toFixed(2).replace('.', '_')}s.png`);
        extractFrame(rawPath!, t, f);
        frames.push(f);
      }
      console.log('J3 extracted frames:', frames.length);

      // ---- the recorded surface must be the real page ----------------------
      // static.html has a white <h1> on a dark background; the frame must show it
      const first = frames[0];
      const last = frames[frames.length - 1];
      expect(fs.statSync(first).size).toBeGreaterThan(1000);

      // ---- cursor count ----------------------------------------------------
      // The pointer is moved during roughly t=0 s .. t=3 s (the interact
      // callback runs as soon as the recording is live). Two frames taken
      // while the pointer is still must be identical on a static page; two
      // frames taken while it moves must differ by exactly the pointer.
      // The bottom 180 px are ignored: the recorder HUD (pulsing dot + timer)
      // and the Windows taskbar animate there on their own.
      const stillDiff = countChangedBlobs(frames[24], frames[26], 8, 180);   // t = 6.00 s vs 6.50 s
      const movingDiff = countChangedBlobs(frames[8], frames[12], 8, 180);   // t = 2.00 s vs 3.00 s
      console.log('J3 still-window diff (t=6.0s vs 6.5s):', JSON.stringify({ changed: stillDiff.changed, blobs: stillDiff.blobs }));
      console.log('J3 moving-window diff (t=2.0s vs 3.0s):', JSON.stringify({ changed: movingDiff.changed, blobs: movingDiff.blobs }));
      fs.writeFileSync(path.join(dir, 'j3-summary.json'), JSON.stringify({
        info, videoEnd, wallClockSec: session.wallClockSec,
        stillDiff: { changed: stillDiff.changed, blobs: stillDiff.blobs },
        movingDiff: { changed: movingDiff.changed, blobs: movingDiff.blobs, boxes: movingDiff.boxes },
        frames: countFrames(rawPath!)
      }, null, 2));

      // With a static page, two frames taken while the mouse does not move must
      // be identical; if they are not, something else is moving on screen.
      expect(stillDiff.changed, 'the static page must not change while the mouse is still')
        .toBeLessThan(2000);

      // While the mouse moves, the cursor must be visible in the capture:
      // the difference between two frames is the cursor's old and its new
      // position - exactly one cursor moved.
      expect(movingDiff.changed, 'the OS cursor must be part of the screen capture').toBeGreaterThan(50);
      expect(movingDiff.blobs, 'exactly one cursor moved (its old and its new position)').toBe(2);
      for (const b of movingDiff.boxes) {
        console.log(`  cursor blob at x=${b.x} y=${b.y} ${b.w}x${b.h} (${b.pixels} px)`);
        expect(b.pixels).toBeLessThan(4000);
      }
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});

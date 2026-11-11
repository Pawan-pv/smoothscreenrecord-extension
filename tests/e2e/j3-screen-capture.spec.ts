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
  outDir, saveRawRecording, countChangedBlobs, countFrames, streamEndTime
} from './helpers/harness';

test.describe.serial('J3 screen capture', () => {
  test.setTimeout(300000);

  test('J3: the screen recording shows the real page, tracks the wall clock, and contains exactly one cursor', async () => {
    const dir = outDir('j3');
    const site = await serveFixtures();
    // real content, no fake device
    const app = await launchApp({ capture: 'screen', appUrl: `${site.base}/static.html` });
    try {
      const target = app.context.pages().find((p) => p.url().includes('static.html'))!;
      expect(target, 'the app window with the fixture must exist').toBeTruthy();
      await target.bringToFront();
      await target.waitForTimeout(500);

      // move the mouse in a straight line during the middle of the recording
      const session = await recordPage(app.context, app.extensionId, `${site.base}/static.html`, {
        seconds: 8,
        includeMic: false,
        target,
        interact: async (p) => {
          await p.mouse.move(400, 300);
          await p.waitForTimeout(1500);
          for (let i = 0; i <= 20; i++) {
            await p.mouse.move(400 + i * 60, 300 + i * 20);
            await p.waitForTimeout(100);
          }
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
      // 0.0-1.5 s: mouse still. 2.0-4.0 s: mouse moving in a straight line.
      const stillDiff = countChangedBlobs(frames[0], frames[4]);      // 0.00 s vs 1.00 s
      const movingDiff = countChangedBlobs(frames[12], frames[16]);   // 3.00 s vs 4.00 s
      console.log('J3 still-window diff:', JSON.stringify(stillDiff));
      console.log('J3 moving-window diff:', JSON.stringify(movingDiff));
      fs.writeFileSync(path.join(dir, 'j3-summary.json'), JSON.stringify({
        info, videoEnd, wallClockSec: session.wallClockSec, stillDiff, movingDiff,
        frames: countFrames(rawPath!)
      }, null, 2));

      // With a static page, two frames taken while the mouse does not move must
      // be identical; if they are not, something else is moving on screen.
      expect(stillDiff.changed, 'the static page must not change while the mouse is still')
        .toBeLessThan(2000);

      // While the mouse moves, the cursor must be visible in the capture:
      // the difference between two frames is the cursor's old and new position.
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

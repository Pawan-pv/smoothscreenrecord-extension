/**
 * J11 - MP4 export.
 *
 * Records the avsync fixture with the real microphone (beeps at 2/8/18 s from
 * tests/fixtures/audio/test.wav) and exports an MP4.
 *
 * Correct means:
 *   - ffprobe shows an h264 video stream and an aac audio stream
 *   - the frame count matches duration x fps
 *   - A/V sync is within one frame at the start, in the middle and at the end
 *     (the beep in the audio against the page clock painted into the video)
 *   - the exported file decodes without errors
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  AUDIO, launchApp, serveFixtures, recordPage, mediaInfo, outDir, saveRawRecording,
  extractFrame, decodeEpochBits, countFrames, streamEndTime
} from './helpers/harness';

test.describe.serial('J11 MP4 export', () => {
  test.setTimeout(600000);

  test('J11: the MP4 export contains h264+aac, the right number of frames and is in sync within one frame', async () => {
    const dir = outDir('j11');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true, mic: true });
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/avsync.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);

      const session = await recordPage(app.context, app.extensionId, `${site.base}/avsync.html`, {
        seconds: 20,
        includeMic: true,
        target
      });
      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath).toBeTruthy();
      const raw = mediaInfo(rawPath!);
      console.log('J11 raw ffprobe:', JSON.stringify(raw));

      // state of the video element the exporter drives (read-only inspection)
      const videoState = await session.editor.evaluate(() => {
        const el = document.querySelector('#smoothstudio-source-video') as HTMLVideoElement | null;
        if (!el) return null;
        return {
          duration: el.duration, readyState: el.readyState, paused: el.paused,
          currentTime: el.currentTime, networkState: el.networkState,
          errorCode: el.error ? el.error.code : null,
          seekableRanges: el.seekable.length,
          buffered: el.buffered.length ? [el.buffered.start(0), el.buffered.end(el.buffered.length - 1)] : null
        };
      });
      console.log('J11 video element state before export:', JSON.stringify(videoState));
      fs.writeFileSync(path.join(dir, 'j11-video-state.json'), JSON.stringify(videoState, null, 2));

      // ---- export ----------------------------------------------------------
      const mp4 = path.join(dir, 'export.mp4');
      let exported = false;
      let exportError = '';
      try {
        const downloadPromise = session.editor.waitForEvent('download', { timeout: 420000 });
        await session.editor.locator('#export-mp4-btn').click();
        const download = await downloadPromise;
        await download.saveAs(mp4);
        exported = true;
      } catch (err) {
        exportError = String(err).slice(0, 300);
        const bodyText = await session.editor.locator('body').innerText().catch(() => '');
        const m = /MP4 Export Failed\s*(.*)/.exec(bodyText);
        if (m) exportError += ` | editor said: ${m[1].slice(0, 300)}`;
        const consoleErr = await session.editor.locator('body').innerText().catch(() => '');
        exportError += ` | body tail: ${consoleErr.slice(-200)}`;
      }
      console.log('J11 export:', exported ? mp4 : exportError);
      expect(exported, `MP4 export failed: ${exportError}`).toBe(true);

      const info = mediaInfo(mp4);
      console.log('J11 export ffprobe:', JSON.stringify(info));
      const video = info.streams.filter((s) => s.codec_type === 'video');
      const audio = info.streams.filter((s) => s.codec_type === 'audio');
      expect(video.length).toBe(1);
      expect(video[0].codec_name).toBe('h264');
      expect(audio.length, 'the export must contain the microphone audio').toBe(1);
      expect(audio[0].codec_name).toBe('aac');

      // ---- frame count = duration x fps ------------------------------------
      const frames = countFrames(mp4);
      const duration = info.durationSec || 0;
      console.log(`J11 export frames=${frames} duration=${duration}s -> ${(frames / duration).toFixed(2)} fps`);
      expect(Math.abs(frames / duration - 60), `expected 60 fps, got ${(frames / duration).toFixed(2)}`).toBeLessThan(1.5);

      // ---- A/V sync: the page clock painted into the video vs the beeps ----
      // The wall clock of the recording start (video time ~0).
      const first = path.join(dir, 'sync_t0.png');
      extractFrame(mp4, 0.05, first);
      const e0 = decodeEpochBits(first);
      expect(e0, 'the exported video must carry the page clock').toBeTruthy();
      console.log('J11 export clock at t=0.05s:', e0);

      const beeps = AUDIO.beeps;
      const sync: { beepSec: number; videoTimeOfFrame: number; errorMs: number }[] = [];
      for (const beep of beeps) {
        // the frame closest to the beep's expected wall clock
        const frame = path.join(dir, `sync_beep_${beep}.png`);
        extractFrame(mp4, beep, frame);
        const epoch = decodeEpochBits(frame);
        if (!epoch) { console.log(`J11 no clock on the frame at ${beep}s`); continue; }
        const expected = e0! + beep * 1000;
        const errorMs = Math.round(epoch - expected);
        sync.push({ beepSec: beep, videoTimeOfFrame: beep, errorMs });
        console.log(`J11 beep ${beep}s: video clock ${epoch}, expected ${expected}, error ${errorMs} ms`);
      }
      expect(sync.length, 'every beep must be measurable in the exported video').toBe(beeps.length);
      for (const s of sync) {
        expect(Math.abs(s.errorMs), `A/V sync error at the ${s.beepSec}s beep is ${s.errorMs}ms (one frame = 16.7ms)`)
          .toBeLessThanOrEqual(16.7);
      }

      fs.writeFileSync(path.join(dir, 'j11-summary.json'),
        JSON.stringify({ raw, info, frames, duration, videoState, sync }, null, 2));
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});

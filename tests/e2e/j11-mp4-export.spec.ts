/**
 * J11 - MP4 export.
 *
 * Records the avsync fixture with the real microphone (beeps at 2/8/18 s from
 * tests/fixtures/audio/test.wav) and exports an MP4.
 *
 * Correct means:
 *   - ffprobe shows an h264 video stream and an aac audio stream
 *   - the frame count matches duration x fps
 *   - the export preserves the recording's real audio and video timing: the
 *     page flashes (video) and the 4.5 kHz beeps (audio) may not move by more
 *     than the captured frame they were reconstructed from (QA-045)
 *   - the exported file decodes without errors
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  AUDIO, launchApp, serveFixtures, recordPage, mediaInfo, outDir, saveRawRecording,
  extractFrame, decodeEpochBits, countFrames, streamEndTime, framePts
} from './helpers/harness';
import { detectFlashOnsets, measureAudioShiftMs } from './helpers/session';

test.describe.serial('J11 MP4 export', () => {
  test.setTimeout(900000);

  test('J11: the MP4 export contains h264+aac, the right number of frames and keeps the recording\'s A/V timing', async () => {
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
        target,
        // QA-020: real mic + the fixture WAV through the real speakers
        speakerWav: AUDIO.file
      });
      // Diagnostics only: surface the exporter's own log lines, errors and crashes.
      session.editor.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning' || /Exporter|Seek|Muxed|AAC|audio/i.test(m.text())) {
          console.log(`[editor ${m.type()}] ${m.text().slice(0, 300)}`);
        }
      });
      session.editor.on('pageerror', (e) => console.log('[editor pageerror]', String(e.message).slice(0, 300)));
      session.editor.on('crash', () => console.log('[editor] PAGE CRASHED'));
      session.editor.on('close', () => console.log('[editor] page closed'));
      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath).toBeTruthy();
      const raw = mediaInfo(rawPath!);
      console.log('J11 raw ffprobe:', JSON.stringify(raw));

      // The page clock is painted by the page at the SOURCE capture rate, and
      // the exported 60 fps frames repeat the nearest source picture, so a
      // frame's clock can only be as accurate as one source frame interval.
      // This environment captures at ~29 fps; measure the real interval.
      const rawPts = framePts(rawPath!);
      const rawIntervals = rawPts.slice(1)
        .map((p, i) => (p - rawPts[i]) * 1000)
        .filter((ms) => ms > 0)
        .sort((a, b) => a - b);
      const sourceFrameMs = rawIntervals[Math.floor(rawIntervals.length / 2)];
      console.log(`J11 source capture: ${rawPts.length} frames, median interval ${sourceFrameMs.toFixed(1)} ms`);

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
      // Instrumentation: watch the video element's seek events so a failing
      // export can be traced (which seek never completed).
      await session.editor.evaluate(() => {
        const el = document.querySelector('#smoothstudio-source-video') as HTMLVideoElement | null;
        const log: any[] = [];
        (window as any).__seekLog = log;
        if (!el) return;
        el.addEventListener('seeking', () => log.push({ ev: 'seeking', t: +el.currentTime.toFixed(3), at: performance.now() }));
        el.addEventListener('seeked', () => log.push({ ev: 'seeked', t: +el.currentTime.toFixed(3), at: performance.now() }));
        el.addEventListener('error', () => log.push({ ev: 'error', code: el.error?.code, at: performance.now() }));
      });
      const mp4 = path.join(dir, 'export.mp4');
      let exported = false;
      let exportError = '';
      try {
        const downloadPromise = session.editor.waitForEvent('download', { timeout: 480000 });
        await session.editor.locator('#export-mp4-btn').click();
        // Diagnostics only (QA-001): is the editor's main thread alive while exporting?
        let sampling = true;
        downloadPromise.then(() => { sampling = false; }, () => { sampling = false; });
        (async () => {
          for (let i = 0; sampling && i < 48; i++) {
            await new Promise((r) => setTimeout(r, 10000));
            if (!sampling) break;
            const t0 = Date.now();
            const st = await Promise.race([
              session.editor.evaluate(() => ({
                vis: document.visibilityState, focus: document.hasFocus(),
                pct: ((document.body.innerText.match(/(\d+)%/) || [])[1]) || null,
                videos: Array.from(document.querySelectorAll('video')).map((v) => ({
                  id: v.id, rs: v.readyState, ct: +v.currentTime.toFixed(3), seeking: v.seeking, w: v.videoWidth, ns: v.networkState
                }))
              })),
              new Promise((r) => setTimeout(() => r('EVALUATE TIMED OUT (main thread blocked?)'), 5000))
            ]).catch((e) => 'evaluate failed: ' + String(e).slice(0, 120));
            console.log(`[J11 export sample +${(i + 1) * 10}s, ${Date.now() - t0}ms]`, JSON.stringify(st));
          }
        })();
        const download = await downloadPromise;
        await download.saveAs(mp4);
        exported = true;
      } catch (err) {
        exportError = String(err).slice(0, 300);
        const bodyText = await session.editor.locator('body').innerText().catch(() => '');
        const m = /MP4 Export Failed\s*(.*)/.exec(bodyText);
        if (m) exportError += ` | editor said: ${m[1].slice(0, 300)}`;
        const seekLog = await session.editor.evaluate(() => (window as any).__seekLog || []).catch(() => []);
        const seeking = seekLog.filter((e: any) => e.ev === 'seeking');
        const seeked = seekLog.filter((e: any) => e.ev === 'seeked');
        console.log('J11 seek events: seeking=' + seeking.length + ' seeked=' + seeked.length);
        console.log('J11 first seek events:', JSON.stringify(seekLog.slice(0, 6)));
        console.log('J11 last seek events:', JSON.stringify(seekLog.slice(-6)));
        const unmatched = seeking.filter((s: any) => !seeked.some((e: any) => e.t === s.t && e.at >= s.at));
        console.log('J11 seeks without a matching seeked:', JSON.stringify(unmatched.slice(0, 6)));
        exportError += ` | seeking=${seeking.length} seeked=${seeked.length}`;
        fs.writeFileSync(path.join(dir, 'j11-seek-log.json'), JSON.stringify(seekLog.slice(-200), null, 2));
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

      // ---- A/V timing: the export against the raw recording -----------------
      // QA-045: comparing the painted page clock with the nominal beep WAV
      // times is not an A/V measurement. It folds the speaker start offset
      // (0.097 s here) and the source capture's own 0.16 % timeline slope into
      // the result (+50 ms at 2 s growing to +82 ms at 18 s) while never
      // looking at the exported audio. What the export must preserve is the
      // timing of the real events it was made from, so the raw recording is the
      // reference: the page's flashes give the video times, the 4.5 kHz beeps
      // give the audio times, and the export may only shift each by less than
      // the captured frame it was reconstructed from.
      const srcFlash = detectFlashOnsets(rawPath!);
      const outFlash = detectFlashOnsets(mp4);
      console.log('J11 source flash onsets:', JSON.stringify(srcFlash));
      console.log('J11 export flash onsets:', JSON.stringify(outFlash));
      expect(srcFlash.length, 'the recording must contain the fixture flashes').toBeGreaterThanOrEqual(5);
      expect(outFlash.length, 'the export must contain every flash of the recording').toBe(srcFlash.length);
      const videoShifts = srcFlash.map((t, i) => (outFlash[i] - t) * 1000);
      const videoShift = videoShifts.slice().sort((a, b) => a - b)[Math.floor(videoShifts.length / 2)];
      console.log('J11 video shift (export - source), ms:', JSON.stringify(videoShifts.map((x) => +x.toFixed(1))));

      const audioTiming = measureAudioShiftMs(rawPath!, mp4);
      console.log(`J11 audio shift (export - source): ${audioTiming.shiftMs.toFixed(1)} ms `
        + `(peak lag ${audioTiming.lagMs} ms, r=${audioTiming.correlation.toFixed(4)}, `
        + `source starts at ${audioTiming.sourceStartMs} ms)`);
      console.log(`J11 timing shifts: video ${videoShift.toFixed(1)} ms, audio ${audioTiming.shiftMs.toFixed(1)} ms, `
        + `skew ${(audioTiming.shiftMs - videoShift).toFixed(1)} ms`);

      // The video event can only be placed on the captured frame that shows it
      // (~39 ms here), and the 60 fps export repeats that picture. The audio is
      // sample-accurate (1 ms envelope lag), so one AAC frame (21.3 ms) of
      // movement is a real defect. The export must also carry the recording's
      // audio, not silence or another track.
      expect(audioTiming.correlation, "the export must carry the recording's audio, not silence or another track")
        .toBeGreaterThan(0.95);
      expect(Math.abs(videoShift), `the export moved the video timeline by ${videoShift.toFixed(1)} ms (more than one ${sourceFrameMs.toFixed(1)} ms captured frame)`)
        .toBeLessThanOrEqual(sourceFrameMs + 16.7);
      expect(Math.abs(audioTiming.shiftMs), `the export moved the audio timeline by ${audioTiming.shiftMs.toFixed(1)} ms (one AAC frame is 21.3 ms)`)
        .toBeLessThanOrEqual(12);

      // The page clock is real page content, not a placeholder: the exported
      // frame at the start must still carry it.
      const first = path.join(dir, 'sync_t0.png');
      extractFrame(mp4, 0.05, first);
      const e0 = decodeEpochBits(first);
      expect(e0, 'the exported video must carry the page clock').toBeTruthy();
      console.log('J11 export clock at t=0.05s:', e0);

      fs.writeFileSync(path.join(dir, 'j11-summary.json'),
        JSON.stringify({ raw, info, frames, duration, videoState, sourceFrameMs,
          srcFlash, outFlash, videoShifts, audioTiming }, null, 2));
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});

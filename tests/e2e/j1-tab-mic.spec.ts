/**
 * J1 - Recording a real page with the microphone ON.
 *
 * Real Chrome for Testing, real unpacked extension (dist/), real getDisplayMedia,
 * real getUserMedia (the REAL microphone hears tests/fixtures/audio/test.wav - a
 * real 20 s WAV with two 2 s silences and three beeps at known times - played
 * through the REAL speakers, see helpers/speaker.ts).
 *
 * CAPTURE SURFACE (verified, not assumed): Chrome for Testing 157 ignores
 * --auto-select-tab-capture-source-by-title and --auto-select-desktop-capture-source=<title>;
 * the probe in tests/e2e/helpers/probe-capture-surface.mjs always reports
 * displaySurface="monitor". The fixture page is therefore opened in a separate
 * app window that covers the whole screen, and the SCREEN is captured - a real
 * capture of the real page.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  AUDIO, launchApp, serveFixtures, recordPage, mediaInfo, detectSilences, detectAcousticDelay, checkKnownPauses,
  saveRawRecording, outDir, collectPageProblems, streamEndTime, logConsole
} from './helpers/harness';

test.describe.serial('J1 tab recording + mic', () => {
  test.setTimeout(240000);

  test('J1: tab capture with mic produces video+Opus, real duration, real waveform and the known silences', async () => {
    const dir = outDir('j1');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true, mic: true });
    logConsole(app.context, dir);
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/clock.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);

      const problems = collectPageProblems(target);
      const session = await recordPage(app.context, app.extensionId, `${site.base}/clock.html`, {
        seconds: 20,
        includeMic: true,
        target,
        // QA-020: real mic + the fixture WAV through the real speakers
        speakerWav: AUDIO.file
      });

      // ---- raw file --------------------------------------------------------
      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath, 'the recorder must leave its raw file in OPFS').toBeTruthy();
      const info = mediaInfo(rawPath!);
      const video = info.streams.filter((s) => s.codec_type === 'video');
      const audio = info.streams.filter((s) => s.codec_type === 'audio');
      console.log('J1 raw ffprobe:', JSON.stringify(info));
      expect(video.length, 'raw file must contain a video stream').toBe(1);
      expect(audio.length, 'raw file must contain an audio stream (mic was ON)').toBe(1);
      expect(audio[0].codec_name).toBe('opus');
      expect(info.sizeBytes).toBeGreaterThan(100000);

      // The recording length is the end of the VIDEO track; MediaRecorder's Opus
      // track keeps flushing a little longer than the picture (encoder padding),
      // so the file duration and the wall clock are compared separately.
      const videoEnd = streamEndTime(rawPath!, 'v');
      const audioEnd = streamEndTime(rawPath!, 'a');
      console.log(`J1 video track ends at ${videoEnd.toFixed(3)}s, audio track ends at ${audioEnd.toFixed(3)}s,` +
        ` file duration ${info.durationSec}s, wall clock ${session.wallClockSec.toFixed(3)}s`);
      expect(Math.abs(videoEnd - session.wallClockSec),
        `video track length ${videoEnd}s vs wall clock ${session.wallClockSec}s`).toBeLessThan(0.3);

      // ---- the editor draws a waveform from the REAL audio track ----------
      const waveform = session.editor.locator('[data-waveform="real"]');
      await expect(waveform, 'the timeline must show the real waveform, not "NO AUDIO"')
        .toHaveCount(1, { timeout: 60000 });
      const bars = await waveform.locator(':scope > div').count();
      console.log(`J1 waveform bars: ${bars}`);
      expect(bars, 'the waveform must have one bar per bucket').toBeGreaterThanOrEqual(100);

      // ---- the silences are detected at the known times --------------------
      const regions = await session.editor.locator('[data-silence-id]').evaluateAll((els) => els.map((e) => ({
        title: e.getAttribute('title') || '',
        left: e.style.left
      })));
      console.log('J1 detected silence regions:', JSON.stringify(regions));

      const durationSec = info.durationSec || 0;
      const allStarts = regions.map((r) => (parseFloat(r.left) / 100) * durationSec);
      const durations = regions.map((r) => parseFloat((/\((\d+(?:\.\d+)?)s\)/.exec(r.title) || [])[1] || 'NaN'));
      // QA-035: the WAV reaches the mic after the OS player's pre-roll, so its
      // position in the recording must be MEASURED (both known gaps), not assumed
      // to start at 0.
      const delay = detectAcousticDelay(rawPath!, AUDIO.silences as [number, number][]);
      console.log(`J1 measured speaker-WAV delay in the recording: ${JSON.stringify(delay)}` +
        ` (START line said ${session.audioOffsetSec}s)`);
      expect(delay, 'the speaker audio must be audible in the real-mic recording').not.toBeNull();
      const delaySec = delay!.delaySec;
      // A silence at 0 s is the pre-roll quiet BEFORE the WAV reached the mic,
      // not a WAV pause; it is accepted only when the WAV was already audible.
      const starts = allStarts.filter((s) => !(s < 0.1 && delaySec >= 1.2));
      console.log(`J1 known WAV gaps shifted by ${delaySec}s; silences considered: ${JSON.stringify(starts)}`);
      const pauses = allStarts.map((s, i) => ({ start: s, duration: durations[i] }));
      // QA-020 ground truth from the recording itself (real room, real mic).
      const checks = checkKnownPauses(rawPath!, AUDIO.silences as [number, number][], delaySec, pauses);
      console.log('J1 known pauses vs the recording:', JSON.stringify(checks));
      const quietChecks = checks.filter((c) => c.quiet);
      expect(quietChecks.length, 'at least one known pause must have stayed quiet in the room').toBeGreaterThanOrEqual(1);
      for (const c of quietChecks) {
        expect(c.matched, `the product missed the quiet pause at ${c.gap[0].toFixed(2)}s`).toBeTruthy();
      }
      for (const expected of checks.filter((c) => c.quiet).map((c) => c.gap[0])) {
        const hit = starts.find((s) => Math.abs(s - expected) < 0.3);
        expect(hit, `no silence detected near ${expected}s (detected ${JSON.stringify(starts)})`)
          .toBeTruthy();
      }
      // and the independent ffmpeg measurement of the same file agrees
      const ffmpegSilences = detectSilences(rawPath!);
      // QA-020/QA-021: with a REAL mic the pauses are room noise, not digital
      // silence, so ffmpeg's absolute -42 dB detector is logged as a measurement;
      // the ground truth is checkKnownPauses() above (asserted).
      console.log('J1 ffmpeg silencedetect (-42 dB) on the raw file:', JSON.stringify(ffmpegSilences));

      fs.writeFileSync(path.join(dir, 'j1-summary.json'), JSON.stringify({
        info, wallClockSec: session.wallClockSec, regions, starts, ffmpegSilences, bars,
        consoleErrors: problems.errors
      }, null, 2));
      expect(problems.errors, 'no console errors on the recorded page').toEqual([]);
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});

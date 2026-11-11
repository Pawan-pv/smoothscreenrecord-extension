/**
 * J2 - Recording REAL page content (no fake device anywhere).
 *
 * The captured surface must show the real page. The page paints a 48-bit
 * millisecond epoch as a row of black/white cells across the top, so the
 * wall-clock time of every recorded frame can be read straight out of the
 * video - that is what "the page clock advances 1:1 with video time" is
 * measured against.
 *
 * CAPTURE SURFACE (verified, not assumed): Chrome for Testing 157 ignores
 * --auto-select-tab-capture-source-by-title / --auto-select-desktop-capture-source=<title>
 * (tests/e2e/helpers/probe-capture-surface.mjs always reports displaySurface="monitor").
 * The fixture page is therefore opened in an app window that covers the whole
 * screen and the SCREEN is captured - a real capture of the real page.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  launchApp, serveFixtures, recordPage, mediaInfo, extractFrame, decodeEpochBits,
  rawPixels, outDir, saveRawRecording, countFrames
} from './helpers/harness';

function frameDiffPixels(a: string, b: string): number {
  const A = rawPixels(a);
  const B = rawPixels(b);
  let diff = 0;
  const n = Math.min(A.buf.length, B.buf.length);
  for (let i = 0; i < n; i += 3) {
    if (Math.abs(A.buf[i] - B.buf[i]) > 24 || Math.abs(A.buf[i + 1] - B.buf[i + 1]) > 24 ||
        Math.abs(A.buf[i + 2] - B.buf[i + 2]) > 24) diff++;
  }
  return diff;
}

test.describe.serial('J2 tab recording with real content', () => {
  test.setTimeout(300000);

  test('J2: the recorded tab shows the real page and its clock tracks the video timeline 1:1', async () => {
    const dir = outDir('j2');
    const site = await serveFixtures();
    // NOTE: no --use-fake-device-for-media-stream here - the video must be real.
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/clock.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(500);

      const session = await recordPage(app.context, app.extensionId, `${site.base}/clock.html`, {
        seconds: 20,
        includeMic: false,
        target
      });

      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath).toBeTruthy();
      const info = mediaInfo(rawPath!);
      console.log('J2 raw ffprobe:', JSON.stringify(info));
      console.log('J2 wall clock:', session.wallClockSec.toFixed(3), 's');
      expect(info.streams.filter((s) => s.codec_type === 'audio').length,
        'no mic was requested, so there must be no audio stream').toBe(0);

      // ---- one frame per second, 0 s .. 20 s -------------------------------
      const samples: { t: number; epoch: number | null; file: string; diffPrev: number }[] = [];
      let prevFile = '';
      for (let t = 0; t <= 20; t += 1) {
        const f = path.join(dir, `frame_${String(t).padStart(2, '0')}s.png`);
        extractFrame(rawPath!, t, f);
        const epoch = decodeEpochBits(f);
        const diffPrev = prevFile ? frameDiffPixels(prevFile, f) : -1;
        samples.push({ t, epoch, file: f, diffPrev });
        prevFile = f;
      }
      console.log('J2 epoch samples:', JSON.stringify(samples.map((s) => [s.t, s.epoch, s.diffPrev])));

      // every frame must show the real page (the epoch band must be readable)
      const unreadable = samples.filter((s) => s.epoch === null);
      expect(unreadable.length, `frames without a readable epoch band: ${JSON.stringify(unreadable.map((s) => s.t))}`)
        .toBe(0);

      // the page clock must advance 1:1 with the video timeline (+-100 ms).
      // A least-squares fit over the inliers is used (reference = median, then
      // keep everything within 2 s of it) so that a single mis-decoded frame
      // cannot skew the result.
      const decodedValues = samples.filter((s) => s.epoch !== null).map((s) => s.epoch!).sort((a, b) => a - b);
      const median = decodedValues[Math.floor(decodedValues.length / 2)];
      const points = samples.filter((s) => s.epoch !== null && Math.abs(s.epoch! - median) < 2000);
      console.log(`J2 decoded ${decodedValues.length}/${samples.length} frames, ${points.length} inliers around the median`);
      expect(points.length, 'at least 80 % of the frames must decode a clock').toBeGreaterThan(samples.length * 0.8);
      const n = points.length;
      const sumT = points.reduce((a, s) => a + s.t, 0);
      const sumE = points.reduce((a, s) => a + s.epoch!, 0);
      const sumTT = points.reduce((a, s) => a + s.t * s.t, 0);
      const sumTE = points.reduce((a, s) => a + s.t * s.epoch!, 0);
      const slope = (n * sumTE - sumT * sumE) / (n * sumTT - sumT * sumT);   // ms per video second
      const intercept = (sumE - slope * sumT) / n;
      const residuals = points.map((s) => ({
        t: s.t,
        residualMs: Math.round((s.epoch! - (intercept + slope * s.t)))
      }));
      const worst = residuals.reduce((m, r) => Math.abs(r.residualMs) > Math.abs(m.residualMs) ? r : m, residuals[0]);
      console.log('J2 fitted clock rate:', slope.toFixed(2), 'ms per video second');
      console.log('J2 residuals vs the fit (ms):', JSON.stringify(residuals));
      expect(Math.abs(slope - 1000), `the page clock must advance 1:1 with the video time (got ${slope.toFixed(1)} ms/s)`)
        .toBeLessThan(100);
      expect(Math.abs(worst.residualMs), `worst residual ${worst.residualMs}ms at t=${worst.t}s`).toBeLessThan(100);

      // no frozen start: the first three frames must already differ from each other
      for (let i = 1; i < 3; i++) {
        expect(samples[i].diffPrev, `frame at ${samples[i].t}s is identical to the previous frame (frozen start)`)
          .toBeGreaterThan(0);
      }
      // no duplicate frames while the page is moving
      const duplicates = samples.filter((s, i) => i > 0 && s.diffPrev === 0).map((s) => s.t);
      expect(duplicates.length, `duplicate frames at ${JSON.stringify(duplicates)}s`).toBe(0);

      // the raw file must really contain a frame stream
      const frames = countFrames(rawPath!);
      console.log('J2 counted frames in the raw file:', frames);
      expect(frames).toBeGreaterThan(100);

      fs.writeFileSync(path.join(dir, 'j2-summary.json'),
        JSON.stringify({ info, samples, slope, intercept, residuals, frames }, null, 2));
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});
